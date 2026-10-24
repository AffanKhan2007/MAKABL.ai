// Terminal walk-through of the pitch (working model section 16, steps 3, 4, 6, 8).
// The build calls are simulated; no provider is contacted and nothing is charged.
// `npm run demo` keeps state in memory; `npm run demo -- --pg` uses DATABASE_URL.

import pg from 'pg';
import { PgEventLog } from '../src/db/pg-event-log.ts';
import { PgGateStore } from '../src/db/pg-gate-store.ts';
import { fmtUsd, usd, type Range } from '../src/domain/types.ts';
import { estimate } from '../src/estimator/estimator.ts';
import { MemoryEventLog, type EventLog } from '../src/events/event-store.ts';
import { BudgetBlockedError, BudgetGate } from '../src/gate/budget-gate.ts';
import { MemoryGateStore } from '../src/gate/memory-store.ts';
import { observedLlmCost, worstCaseLlmCost } from '../src/gate/llm-cost.ts';
import { PricingRegistry } from '../src/registry/pricing.ts';
import { seedPrices } from '../src/registry/seed.ts';

const registry = new PricingRegistry(seedPrices);
const MODEL = 'anthropic/claude-opus-5-5';
const range = (r: Range) => `${fmtUsd(r.low)} / ${fmtUsd(r.expected)} / ${fmtUsd(r.high)}`;

// --- Step 3: cost plan ---------------------------------------------------------------
const features = [
  { type: 'auth', name: 'Shop owner sign-in' },
  { type: 'migration', name: 'Items and stock schema' },
  { type: 'crud_endpoint', name: 'Items API' },
  { type: 'form_page', name: 'Add / edit item' },
  { type: 'page', name: 'Low-stock dashboard' },
] as const;

const plan = estimate(
  { features: [...features], commercialUse: true, buildModel: MODEL, horizon: 'first_month', unpricedItems: ['Custom domain'] },
  registry, [], '2026-10-24',
);

console.log('\n=== Cost plan: "inventory tracker for a small shop" (client work) ===');
console.log(plan.assumptions.map((a) => `  - ${a}`).join('\n'));
console.log(`  - Calibration runs: ${plan.calibration.runs} (calibrated: ${plan.calibration.calibrated})`);
for (const p of plan.paths) {
  console.log(`\n[${p.path.toUpperCase()} PATH] ${p.eligible ? 'eligible' : 'NOT ELIGIBLE'}  low / expected / high = ${range(p.totals)}`);
  for (const r of p.ineligibleReasons) console.log(`  ! ${r}`);
  for (const l of p.lines) {
    const flag = l.priceIsAssumption ? ' (price unverified)' : '';
    console.log(`  ${l.label.padEnd(36)} ${range(l.range!).padEnd(26)} ${l.lineClass}/${l.confidence}${flag}`);
  }
  for (const u of p.unpriced) console.log(`  ${u.label.padEnd(36)} UNPRICED (not in total)`);
  for (const c of p.upgradeCliffs) console.log(`  cliff: ${c}`);
}
console.log('\n' + plan.disclosures.map((d) => `  * ${d}`).join('\n'));

// --- Step 4: user sets a deliberately low cap -----------------------------------------
const usePg = process.argv.includes('--pg');
let pool: pg.Pool | undefined;
let events: EventLog;
let gate: BudgetGate;
let PROJECT: string;
if (usePg) {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:makabl@localhost:5433/makabl' });
  const owner = await pool.query<{ id: string }>(
    'insert into users (email) values ($1) returning id', [`demo-${Date.now()}@example.test`]);
  const project = await pool.query<{ id: string }>(
    `insert into projects (owner_id, name) values ($1, 'Inventory tracker') returning id`, [owner.rows[0]!.id]);
  PROJECT = project.rows[0]!.id;
  events = new PgEventLog(pool);
  gate = new BudgetGate(new PgGateStore(pool));
} else {
  const log = new MemoryEventLog();
  events = log;
  gate = new BudgetGate(new MemoryGateStore(log));
  PROJECT = 'proj_inventory';
}
const unsubscribe = await events.subscribe(
  (e) => console.log(`  [feed #${e.seq}] ${e.type} ${e.taskId ?? ''} ${JSON.stringify(e.payload)}`),
  { projectId: PROJECT },
);
await gate.setBudget(PROJECT, { projectCap: usd(2), monthlyCap: usd(2) });
// LISTEN delivers asynchronously; pause so feed lines print next to the step that caused them.
const settleFeed = () => new Promise((r) => setTimeout(r, usePg ? 100 : 0));
console.log(`\n=== Build with a $2.00 cap (${usePg ? `Postgres, project ${PROJECT}` : 'in memory'}) ===`);

// --- Step 6: simulated build until the Gate pauses it ---------------------------------
const price = registry.get(MODEL);
async function runTask(taskId: string, attempt: number) {
  const prompt = 60_000;
  const maxOut = 16_000;
  return gate.execute(
    {
      projectId: PROJECT, taskId, taskCeiling: usd(1.5), idempotencyKey: `${taskId}:${attempt}`,
      worstCase: worstCaseLlmCost(price, prompt, maxOut), description: `${taskId} attempt ${attempt}`,
    },
    async () => {
      const usage = { input_tokens: prompt, output_tokens: 9_000 + attempt * 1_000 };
      return { result: `${taskId} files`, observed: observedLlmCost(price, usage) };
    },
  );
}

const tasks = ['t_auth', 't_schema', 't_items_api', 't_item_form', 't_dashboard'];
let pausedAt = -1;
for (let i = 0; i < tasks.length; i++) {
  try {
    await runTask(tasks[i]!, 1);
    await settleFeed();
  } catch (err) {
    if (!(err instanceof BudgetBlockedError)) throw err;
    await settleFeed();
    pausedAt = i;
    const a = err.approval;
    console.log('\n=== PAUSED: approval needed ===');
    console.log(`  Reason:      ${a.reason}`);
    console.log(`  Blocked:     ${a.blockedTaskId}`);
    console.log(`  Cost range:  ${fmtUsd(a.costRange.low)} to ${fmtUsd(a.costRange.high)}`);
    console.log(`  Who bills:   ${a.whoBills}`);
    console.log(`  Cancellable: ${a.cancellable}`);
    console.log(`  If declined: ${a.consequenceOfDeclining}`);
    console.log(`  Options:     ${a.alternatives.join(' | ')}`);
    console.log('\n=== User approves a $1.50 raise ===');
    await gate.decide(PROJECT, a.id, 'approved', usd(1.5));
    await settleFeed();
    break;
  }
}

// Resume, including a deliberate replay of an already-settled step: it must not be paid twice.
if (pausedAt >= 0) {
  await runTask(tasks[pausedAt - 1]!, 1);
  for (let i = pausedAt; i < tasks.length; i++) await runTask(tasks[i]!, 1);
  await settleFeed();
}
await unsubscribe();

// --- Step 8: estimate vs actual ---------------------------------------------------------
const paid = plan.paths.find((p) => p.path === 'paid')!;
const buildEst = paid.lines.filter((l) => l.unit === 'tokens');
const estTotal = buildEst.reduce<Range>((a, l) => ({
  low: a.low + l.range!.low, expected: a.expected + l.range!.expected, high: a.high + l.range!.high,
}), { low: 0, expected: 0, high: 0 });
const actual = await gate.spent(PROJECT);
const ledger = await gate.ledgerFor(PROJECT);
console.log('\n=== Estimate vs actual (build only) ===');
console.log(`  Estimated: ${range(estTotal)}`);
console.log(`  Actual:    ${fmtUsd(actual)} (usage_observed, ${ledger.length} ledger entries)`);
console.log(`  In range:  ${actual >= estTotal.low && actual <= estTotal.high ? 'yes' : 'no'}`);
await pool?.end();

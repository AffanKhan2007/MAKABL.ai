import type { Micros } from '../domain/types.ts';
import type { LlmUsage } from '../gate/llm-cost.ts';

// Logged build runs: the data the Estimator calibrates from (working model 7.3 step 2).
// One run is one feature built to completion or abandonment, retries included.

export type FeatureType =
  | 'crud_endpoint' | 'auth' | 'form_page' | 'page' | 'migration' | 'integration';

/** Token totals for a run, split the way they are billed. */
export interface TokenTotals {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

export interface CalibrationRun {
  featureType: FeatureType;
  /** Registry id of the model that did the work, e.g. anthropic/claude-opus-5-5. */
  model: string;
  /** Number of model calls (agent-loop turns) across all attempts. */
  calls: number;
  attempts: number;
  tokens: TokenTotals;
  /** What the Budget Gate actually booked for the run. */
  cost: Micros;
  /** Whether the feature passed its verification gates. */
  verified: boolean;
  /** Cost of the cheap probe run made on the same task before quoting, if any. */
  probeCost?: Micros;
  /** The range quoted for this feature before it was built, for coverage reporting. */
  quoted?: { low: Micros; high: Micros };
}

export interface RunLog {
  record(run: CalibrationRun): Promise<void>;
  list(filter?: { featureTypes?: FeatureType[] }): Promise<CalibrationRun[]>;
}

export class MemoryRunLog implements RunLog {
  private readonly runs: CalibrationRun[] = [];

  async record(run: CalibrationRun): Promise<void> {
    this.runs.push(structuredClone(run));
  }

  async list(filter: { featureTypes?: FeatureType[] } = {}): Promise<CalibrationRun[]> {
    const types = filter.featureTypes;
    return this.runs.filter((r) => !types || types.includes(r.featureType)).map((r) => structuredClone(r));
  }
}

/** Collects the calls made while building one feature, then produces its run record. */
export class RunAccumulator {
  private calls = 0;
  private cost = 0;
  private readonly tokens: TokenTotals = { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };
  private readonly costByModel = new Map<string, Micros>();

  /** Add one model call. `model` is the registry id that billed it. */
  add(model: string, usage: LlmUsage, cost: Micros): void {
    this.calls++;
    this.cost += cost;
    this.costByModel.set(model, (this.costByModel.get(model) ?? 0) + cost);
    const written = usage.cache_creation_input_tokens ?? 0;
    const w5m = usage.cache_creation?.ephemeral_5m_input_tokens ?? 0;
    this.tokens.input += usage.input_tokens;
    this.tokens.output += usage.output_tokens;
    this.tokens.cacheRead += usage.cache_read_input_tokens ?? 0;
    this.tokens.cacheWrite5m += w5m;
    // Writes without a lifetime breakdown are counted as 1h, matching how they were priced.
    this.tokens.cacheWrite1h += written - w5m;
  }

  /** A call that failed with unknown usage, booked at its worst case. Adds cost, no tokens. */
  addCharge(model: string, cost: Micros): void {
    this.calls++;
    this.cost += cost;
    this.costByModel.set(model, (this.costByModel.get(model) ?? 0) + cost);
  }

  get totalCost(): Micros {
    return this.cost;
  }

  finish(run: Omit<CalibrationRun, 'model' | 'calls' | 'tokens' | 'cost'>): CalibrationRun {
    if (this.calls === 0) throw new Error('no calls recorded for this run');
    // The model that cost the most is the one the run is filed under.
    const [model] = [...this.costByModel.entries()].sort((a, b) => b[1] - a[1])[0]!;
    return { ...run, model, calls: this.calls, tokens: { ...this.tokens }, cost: this.cost };
  }
}

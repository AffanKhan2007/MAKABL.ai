import type { ClaudeMessage, ModelCaller } from '../adapters/claude.ts';
import type { Micros } from '../domain/types.ts';
import type { ProjectSpec } from '../server/projects.ts';
import { textOf, tokensOf } from '../relay/relay.ts';

// Design mockups: before any code is written, a model draws a low-fidelity mockup of the
// app's main screens as one HTML page. The user looks at it, says what to change, and asks
// for another version. Each version is one model call through the Budget Gate (task
// DESIGN_TASK), recorded as a `design_render` event with its tokens and cost.
//
// Model output is untrusted. It is stripped of scripts, handlers, embeds and external
// resources here, and the page shows it in a sandboxed iframe with a no-network CSP, so a
// missed tag still cannot run code or call home.

export const DESIGN_TASK = 'design:mockup';
/**
 * Each click is its own logical step: a failed attempt must not block the next one (the Gate
 * refuses to replay a failed key), so the key carries a per-click nonce as well as the version.
 */
export const designKey = (version: number, nonce: string) => `design:v${version}:${nonce}`;

/** Cheapest first; the first one whose vendor has a key draws the mockup. */
export const DESIGN_MODELS = [
  'qwen/qwen3.8-flash',
  'google/gemini-3.5-flash-lite',
  'openai/gpt-6-luna',
  'anthropic/claude-haiku-5-5',
] as const;

/** Keys that let a vendor draw a mockup. Only a key: no generated code runs on this machine. */
const KEYS: Record<string, readonly string[]> = {
  qwen: ['DASHSCOPE_API_KEY'],
  google: ['GEMINI_API_KEY'],
  openai: ['OPENAI_API_KEY', 'OPENROUTER_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
};

export function designModel(env: Readonly<Record<string, string | undefined>>): string | null {
  return DESIGN_MODELS.find((id) => (KEYS[id.split('/')[0]!] ?? []).some((k) => env[k])) ?? null;
}

export const MAX_OUTPUT_TOKENS = 8_000;
/** Most of the previous version a revision sends back, so a long page cannot blow the budget. */
const PREVIOUS_CHARS = 14_000;
export const MAX_FEEDBACK_CHARS = 600;

export const DESIGN_SYSTEM = [
  'You draw low-fidelity website mockups as a single HTML document.',
  'Rules:',
  '- Output only the HTML document, starting with <!DOCTYPE html>. No explanation, no markdown fences.',
  '- Inline CSS in one <style> tag. No JavaScript, no external fonts, images, links or URLs of any kind.',
  '- Draw every image, chart or map as a grey box with a short label, e.g. [Photo of dish].',
  '- Use realistic sample text from the brief, not lorem ipsum.',
  '- Show each main screen as its own section, stacked vertically, with a small caption "Screen: <name>".',
  '- Each screen is drawn 390px wide (a phone), centred, with a thin border. Keep it under about 300 lines.',
  '- Neutral greys plus one accent colour. Clear hierarchy: header, primary action, content.',
].join('\n');

export interface Revision {
  feedback: string;
  previousHtml: string;
}

export function designPrompt(spec: Pick<ProjectSpec, 'idea' | 'features'>, revision?: Revision): string {
  const features = spec.features
    .map((f) => `- ${f.name} (${f.type})${f.acceptance.length ? `: ${f.acceptance.join('; ')}` : ''}`)
    .join('\n');
  const brief = `The app: ${spec.idea}\n\nFeatures and what each must do:\n${features}`;
  if (!revision) return `${brief}\n\nDraw the mockup.`;
  return [
    brief,
    `The previous mockup:\n${revision.previousHtml.slice(0, PREVIOUS_CHARS)}`,
    `The owner wants this changed: ${revision.feedback}`,
    'Draw the whole mockup again with that change. Keep what they did not ask to change.',
  ].join('\n\n');
}

/** The HTML document in a model reply, without markdown fences or chatter around it. */
export function extractHtml(text: string): string {
  const unfenced = text.replace(/```(?:html)?\s*([\s\S]*?)```/i, '$1');
  const start = unfenced.search(/<!doctype html|<html[\s>]/i);
  const end = unfenced.toLowerCase().lastIndexOf('</html>');
  if (start >= 0 && end > start) return unfenced.slice(start, end + '</html>'.length);
  return unfenced.trim();
}

/**
 * Removes what could run code or load anything: script/style-loading/embedding tags, event
 * handlers, javascript: and external URLs, CSS imports and url() loads. Defence in depth: the
 * iframe sandbox and CSP are the real boundary.
 */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<\s*(script|iframe|object|embed|frame|frameset|applet|noscript|template|svg)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    // Unclosed or self-closing leftovers of the above, plus tags that load or redirect.
    .replace(/<\s*\/?\s*(script|iframe|object|embed|frame|frameset|applet|base|link|meta|noscript|template|svg|form)\b[^>]*>/gi, '')
    .replace(/\s(formaction|form)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(href|src|srcset|action|poster|background|xlink:href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\s*\([^)]*\)/gi, 'none')
    .replace(/javascript:/gi, '');
}

/** What the iframe gets: the sanitised page behind a policy that blocks every load. */
export function framedDocument(html: string): string {
  // Ours, added after sanitising: the policy, and a scale-down so 390px screens fit a phone.
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`
    + '<style>@media (max-width: 460px) { html { zoom: 0.8; } } @media (max-width: 360px) { html { zoom: 0.68; } }</style>';
  const clean = sanitizeHtml(html);
  return /<head[^>]*>/i.test(clean) ? clean.replace(/<head[^>]*>/i, (h) => `${h}${csp}`) : `${csp}${clean}`;
}

export interface DesignRender {
  version: number;
  model: string;
  feedback: string | null;
  html: string;
  tokens: { input: number; output: number };
  cost: Micros;
}

/** One mockup version: a single model call, through whatever caller enforces the budget. */
export async function drawMockup(opts: {
  caller: ModelCaller;
  projectId: string;
  spec: Pick<ProjectSpec, 'idea' | 'features'>;
  model: string;
  version: number;
  nonce: string;
  revision?: Revision;
  taskCeiling: Micros;
  costOf(msg: ClaudeMessage): Micros;
}): Promise<DesignRender> {
  const msg = await opts.caller.call({
    projectId: opts.projectId,
    taskId: DESIGN_TASK,
    taskCeiling: opts.taskCeiling,
    idempotencyKey: designKey(opts.version, opts.nonce),
    description: `design mockup v${opts.version}`,
    model: opts.model,
    system: DESIGN_SYSTEM,
    messages: [{ role: 'user', content: designPrompt(opts.spec, opts.revision) }],
    maxTokens: MAX_OUTPUT_TOKENS,
    cache: 'none',
  });
  const html = sanitizeHtml(extractHtml(textOf(msg)));
  if (!/<[a-z]/i.test(html)) throw new Error('The model did not return a page. Try again, or describe the change differently.');
  return {
    version: opts.version,
    model: opts.model,
    feedback: opts.revision?.feedback ?? null,
    html,
    tokens: tokensOf(msg),
    cost: opts.costOf(msg),
  };
}

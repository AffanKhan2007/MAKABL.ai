// Renders: a visual mockup of what a page of the app will look like, drawn by a model as one
// self-contained HTML page. The user can look at it before anything is built and ask for
// another version in words. Because the HTML is model-written, it is cleaned here (no
// scripts, no outside resources) and the page that shows it also sandboxes it.

export const RENDER_SYSTEM = [
  'You are a UI designer. Draw a mockup of ONE page of a small web app as a single HTML document.',
  'Rules: a complete HTML document with one inline <style> block; no <script>, no external fonts,',
  'images, icons or links (use CSS shapes, gradients and emoji instead); realistic placeholder content',
  'for the app described, not lorem ipsum; a clean modern look with a clear visual hierarchy; works at',
  'phone and desktop widths. Show the page a user would actually see.',
  'If a wireframe is given, follow its layout. If feedback on a previous version is given, change what',
  'the feedback asks and keep the rest as it was.',
  'Reply with the HTML only: no explanation, no markdown fence. Keep it under 14,000 characters.',
].join('\n');

export interface RenderPromptInput {
  idea: string;
  page: string;
  features: Array<{ name: string; type: string }>;
  /** The architect's wireframe section, when a build has produced one. */
  wireframe?: string;
  /** The previous version of this page, and what the user wants changed. */
  previous?: string;
  feedback?: string;
}

export function renderPrompt(i: RenderPromptInput): string {
  return [
    `App: ${i.idea}`,
    `Page to draw: ${i.page}`,
    `Features of the app: ${i.features.map((f) => f.name).join('; ')}`,
    ...(i.wireframe ? ['', 'Wireframe from the architect:', i.wireframe] : []),
    ...(i.previous ? ['', 'Previous version of this page (HTML):', i.previous.slice(0, 14_000)] : []),
    ...(i.feedback ? ['', `The user asked for this change: ${i.feedback}`] : []),
  ].join('\n');
}

/** The wireframe section of an architect brief, if it has one. */
export function wireframeOf(brief: string): string | undefined {
  const m = /##\s*Wireframe[\s\S]*?(?=\n##\s|$)/i.exec(brief);
  return m ? m[0].trim().slice(0, 3_000) : undefined;
}

/** The HTML document in a model reply, with or without a markdown fence. */
export function extractHtml(reply: string): string | null {
  const fenced = /```(?:html)?\s*([\s\S]*?)```/i.exec(reply);
  const body = (fenced ? fenced[1]! : reply).trim();
  const start = body.search(/<!doctype html|<html[\s>]/i);
  if (start < 0) return null;
  const end = body.toLowerCase().lastIndexOf('</html>');
  const html = end >= 0 ? body.slice(start, end + 7) : body.slice(start);
  return html.length > 40 ? html : null;
}

export const MAX_RENDER_CHARS = 60_000;

/**
 * Remove everything that could run or load from outside: scripts, frames, embeds, links,
 * base and refresh tags, event-handler attributes, javascript: and remote URLs. What is
 * left is markup and inline CSS.
 */
export function sanitizeHtml(html: string): string {
  let out = html.slice(0, MAX_RENDER_CHARS);
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  // Whole paired elements first (their contents go too), then any stray opening or void tag.
  out = out.replace(/<(script|iframe|object|embed|frame|frameset|applet|form|audio|video)\b[\s\S]*?<\/\1\s*>/gi, '');
  out = out.replace(/<\/?(script|iframe|object|embed|frame|frameset|applet|form|audio|video|source|link|base)\b[^>]*>/gi, '');
  out = out.replace(/<meta\b[^>]*http-equiv[^>]*>/gi, '');
  out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  out = out.replace(/\s(href|src|action|formaction|poster|srcset|xlink:href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (m, _a, v: string) => {
    const value = v.replace(/^["']|["']$/g, '').trim();
    return /^(#|data:image\/(png|jpeg|gif|webp|svg\+xml))/i.test(value) ? m : '';
  });
  out = out.replace(/@import[^;]*;?/gi, '');
  out = out.replace(/url\(\s*(['"]?)\s*(?!data:image\/)[^)]*\1\s*\)/gi, 'none');
  out = out.replace(/expression\s*\(/gi, '(');
  return out;
}

/** The final document for a sandboxed iframe: sanitised, with a policy that forbids everything but inline style and data images. */
export function renderDocument(html: string): string {
  const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:">';
  const clean = sanitizeHtml(html);
  return /<head[^>]*>/i.test(clean)
    ? clean.replace(/<head[^>]*>/i, (m) => `${m}${csp}<meta name="viewport" content="width=device-width, initial-scale=1">`)
    : `<!doctype html><html><head>${csp}<meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${clean}</body></html>`;
}

// ---- building to a chosen render ---------------------------------------------------------

/** The page the owner chose as the target: the latest "chosen" mark, and that version's HTML. */
export function chosenDesign(events: Array<{ type: string; payload: Record<string, unknown> }>): { n: number; page: string; html: string } | null {
  const mark = [...events].reverse().find((e) => e.type === 'relay_render_chosen');
  if (!mark) return null;
  const n = Number(mark.payload.n);
  const render = events.find((e) => e.type === 'relay_render' && Number(e.payload.n) === n);
  return render ? { n, page: String(render.payload.page), html: String(render.payload.html) } : null;
}

/** What the builder and the reviewer are told about the chosen render. */
export function designReference(d: { n: number; page: string; html: string }): string {
  return [
    `Design reference: the owner chose version ${d.n} of the "${d.page}" page as the look to build. Match its layout, section order,`,
    'colour palette, typography, spacing, corner radii and tone, and keep its content and wording where they fit the feature. Rebuild it',
    'with React and CSS in the project (the reference is plain HTML, not code to paste). Use no external fonts, images or links.',
    designChecklist(d),
    'Reference HTML:',
    d.html.slice(0, 12_000),
  ].join('\n');
}

/** Standing design rules for everything the builder writes, with or without a render. */
export const DESIGN_GUIDE = [
  'Design standard: build pages that look professionally designed, not like a default template.',
  'Define colours, spacing and type sizes once as CSS variables in app/globals.css and reuse them; pick a small palette with real',
  'contrast (text at least 4.5:1). Use a clear type scale, generous spacing, a visible hierarchy, consistent corner radii, hover and',
  'focus states, and layouts that work at phone and desktop widths. Write realistic content, never lorem ipsum. Handle empty,',
  'loading and error states. Use semantic HTML and accessible labels. Subtle motion only (transform and opacity, and respect',
  'prefers-reduced-motion). No external fonts, images or scripts: use inline SVG, CSS gradients and shapes.',
].join(' ');

// ---- holding the build to the render -----------------------------------------------------

export interface Design { n: number; page: string; html: string }

/**
 * The look for each page: the one the owner chose for that page, else its newest render.
 * Without this a build with no explicit choice ignored every render, and a choice on one page
 * was used as the reference for all of them.
 */
export function designTargets(events: Array<{ type: string; payload: Record<string, unknown> }>): Design[] {
  const renders = events.filter((e) => e.type === 'relay_render')
    .map((e) => ({ n: Number(e.payload.n), page: String(e.payload.page), html: String(e.payload.html) }));
  const chosen = new Set(events.filter((e) => e.type === 'relay_render_chosen').map((e) => Number(e.payload.n)));
  const byPage = new Map<string, Design>();
  for (const r of renders) {
    const had = byPage.get(r.page);
    // Later renders win, except that a chosen version is not displaced by an unchosen later one.
    if (!had || chosen.has(r.n) || !chosen.has(had.n)) byPage.set(r.page, r);
  }
  return [...byPage.values()];
}

/** The design for a feature: the page it names, else Home, else the first one. */
export function designFor(designs: Design[], feature: string): Design | undefined {
  const f = feature.toLowerCase();
  return designs.find((d) => f.includes(d.page.toLowerCase()) || d.page.toLowerCase().includes(f))
    ?? designs.find((d) => d.page.toLowerCase() === 'home') ?? designs[0];
}

const HEX = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi;
const norm = (c: string) => (c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c).toLowerCase();

/** What a render commits to, literally: its colours, its visible headings and its font stack. */
export function designFacts(html: string): { colours: string[]; texts: string[]; fonts: string | null } {
  const counts = new Map<string, number>();
  for (const m of html.matchAll(HEX)) counts.set(norm(m[0]), (counts.get(norm(m[0])) ?? 0) + 1);
  // Near-white and near-black are everywhere and prove nothing; keep the palette that gives it character.
  const colours = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)
    .filter((c) => !['#ffffff', '#000000'].includes(c)).slice(0, 6);
  const body = html.replace(/<style[\s\S]*?<\/style>/gi, '');
  const texts = [...body.matchAll(/<(h1|h2|h3|button|a|title)\b[^>]*>([^<]{3,60})</gi)]
    .map((m) => m[2]!.replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()).filter((t) => /[a-z]/i.test(t));
  const fonts = /font-family\s*:\s*([^;}"]+)/i.exec(html)?.[1]?.trim() ?? null;
  return { colours, texts: [...new Set(texts)].slice(0, 10), fonts };
}

/** The literal must-match list that goes into the builder's brief next to the reference HTML. */
export function designChecklist(d: Design): string {
  const f = designFacts(d.html);
  return [
    `Must-match checklist for the "${d.page}" page (checked after the build; misses are sent back to you):`,
    f.colours.length ? `- Use exactly these colours, as CSS variables in app/globals.css: ${f.colours.join(', ')}` : '',
    f.fonts ? `- Font stack: ${f.fonts}` : '',
    f.texts.length ? `- Show this exact wording: ${f.texts.map((t) => `"${t}"`).join(', ')}` : '',
    '- Keep the same section order as the reference, top to bottom.',
  ].filter(Boolean).join('\n');
}

/** How much of the render's checklist the built files carry. */
export function fidelity(d: Design, files: string[]): { score: number; missingColours: string[]; missingTexts: string[]; checked: number } {
  const f = designFacts(d.html);
  const all = files.join('\n');
  const lower = all.toLowerCase();
  const missingColours = f.colours.filter((c) => !lower.includes(c) && !lower.includes(c.replace(/^#(.)\1(.)\2(.)\3$/, '#$1$2$3')));
  const missingTexts = f.texts.filter((t) => !all.includes(t) && !all.includes(t.replace(/&/g, '&amp;')));
  const checked = f.colours.length + f.texts.length;
  return { score: checked ? 1 - (missingColours.length + missingTexts.length) / checked : 1, missingColours, missingTexts, checked };
}

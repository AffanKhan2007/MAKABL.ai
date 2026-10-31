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

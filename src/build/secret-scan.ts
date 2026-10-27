import type { Workspace } from './workspace.ts';

// G4 secret scan: credentials committed into the generated project (research section:
// exposed secrets are among the most common real failures of AI-built apps). Findings
// name the file, line and kind, never the matched text, so the report cannot leak them.

export interface SecretFinding {
  file: string;
  line: number;
  kind: string;
}

const PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: 'Anthropic API key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { kind: 'OpenAI-style API key', re: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/ },
  { kind: 'Stripe live secret key', re: /\b[rs]k_live_[A-Za-z0-9]{20,}/ },
  { kind: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}/ },
  { kind: 'Private key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/ },
  { kind: 'JSON Web Token (may be a service key)', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { kind: 'Hard-coded credential', re: /\b(?:api[_-]?key|secret|password|passwd|access[_-]?token)\b["']?\s*[:=]\s*["'][^"'\s]{12,}["']/i },
];

const SKIP_FILES = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/;
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|woff2?|ttf|otf|mp4|mp3)$/i;

/** Scan one file's text. Exported for tests. */
export function scanText(file: string, text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const p of PATTERNS) {
      if (p.re.test(line)) {
        findings.push({ file, line: i + 1, kind: p.kind });
        break;
      }
    }
  });
  return findings;
}

export async function scanWorkspace(ws: Workspace): Promise<SecretFinding[]> {
  const findings: SecretFinding[] = [];
  for (const file of await ws.list('.')) {
    const name = file.split('/').pop() ?? file;
    if (/^\.env(\..+)?$/.test(name) && name !== '.env.example') {
      findings.push({ file, line: 0, kind: 'Environment file in the project (keep secrets out of the code)' });
      continue;
    }
    if (SKIP_FILES.test(file) || BINARY.test(file)) continue;
    const text = await ws.read(file).catch(() => null);
    if (text !== null) findings.push(...scanText(file, text));
  }
  return findings;
}

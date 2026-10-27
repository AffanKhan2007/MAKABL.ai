import type { CheckSpec } from './verifier.ts';
import type { Workspace } from './workspace.ts';

// The starting project for live builds (decision D3: Next.js + TypeScript). The build
// loop's features are written into this. Versions are pinned: the same audited Next.js
// and React releases the platform itself runs on.
//
// Tests run on Node's own test runner with type stripping, so test files import other
// modules with explicit .ts extensions; tsconfig allows that for the app code too.

const PACKAGE_JSON = {
  name: 'app',
  private: true,
  type: 'module',
  engines: { node: '>=23.6' },
  scripts: {
    dev: 'next dev',
    build: 'next build',
    start: 'next start',
    typecheck: 'tsc --noEmit',
    test: 'node --test "tests/**/*.test.ts"',
  },
  dependencies: { next: '16.4.3', react: '19.2.9', 'react-dom': '19.2.9' },
  devDependencies: {
    typescript: '5.9.3',
    '@types/node': '24.0.0',
    '@types/react': '19.3.0',
    '@types/react-dom': '19.2.3',
  },
};

const TSCONFIG = {
  compilerOptions: {
    target: 'ES2023',
    lib: ['ES2023', 'DOM', 'DOM.Iterable'],
    module: 'ESNext',
    moduleResolution: 'bundler',
    jsx: 'react-jsx',
    strict: true,
    noEmit: true,
    allowImportingTsExtensions: true,
    isolatedModules: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    skipLibCheck: true,
    incremental: true,
    plugins: [{ name: 'next' }],
  },
  include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
  exclude: ['node_modules'],
};

export const NEXTJS_TEMPLATE: Readonly<Record<string, string>> = {
  'package.json': `${JSON.stringify(PACKAGE_JSON, null, 2)}\n`,
  'tsconfig.json': `${JSON.stringify(TSCONFIG, null, 2)}\n`,
  '.gitignore': 'node_modules/\n.next/\nnext-env.d.ts\n*.tsbuildinfo\n.env*\n',
  'next.config.ts': `import type { NextConfig } from 'next';\n\nconst nextConfig: NextConfig = {};\n\nexport default nextConfig;\n`,
  'app/layout.tsx': `import type { ReactNode } from 'react';

export const metadata = { title: 'App' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
  'app/page.tsx': `export default function Home() {
  return <main><h1>App</h1></main>;
}
`,
  'lib/health.ts': `/** Used by the smoke test so the test setup itself is checked from the start. */
export const health = (): 'ok' => 'ok';
`,
  'tests/smoke.test.ts': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { health } from '../lib/health.ts';

test('the test setup runs', () => {
  assert.equal(health(), 'ok');
});
`,
};

/** Write the template into an empty workspace. Existing files are never overwritten. */
export async function writeTemplate(ws: Workspace): Promise<boolean> {
  if ((await ws.list('.')).length > 0) return false;
  for (const [path, content] of Object.entries(NEXTJS_TEMPLATE)) await ws.write(path, content);
  return true;
}

/** One-off platform step before any feature: install the template's dependencies. */
export const INSTALL_COMMAND = ['npm', 'install', '--no-audit', '--no-fund'] as const;

/** Per-feature checks for live builds on the template (gates G2/G3). */
export const LIVE_CHECKS: readonly CheckSpec[] = [
  { name: 'type check', gate: 'G3', command: ['npm', 'run', 'typecheck'], timeoutMs: 180_000, testsAuthoredBy: 'none' },
  { name: 'tests', gate: 'G2', command: ['npm', 'test'], timeoutMs: 300_000, testsAuthoredBy: 'agent' },
  { name: 'production build', gate: 'G3', command: ['npm', 'run', 'build'], timeoutMs: 600_000, testsAuthoredBy: 'none' },
];

/** Builder instructions for the template's conventions. */
export const TEMPLATE_GUIDE = [
  'The project is a Next.js App Router app in TypeScript (app/ for routes, lib/ for logic).',
  'Write tests for your feature in tests/<name>.test.ts using node:test and node:assert/strict.',
  'Tests run on Node directly, so import modules with explicit .ts extensions (e.g. ../lib/items.ts).',
  'Put logic you test in lib/; keep React components thin. Do not add dependencies.',
].join('\n');

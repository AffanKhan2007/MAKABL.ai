// Whether this server may run live builds. Live builds spend real money on the
// operator's Claude API key and run model-written code (npm install, tests, next build)
// on this machine with no sandbox, so both have to be switched on deliberately in the
// server's environment, and the user confirms again per project.

export interface LiveModeStatus {
  available: boolean;
  /** What is missing, in words safe to show (never the key itself). */
  missing: string[];
}

export function liveModeStatus(env: Readonly<Record<string, string | undefined>> = process.env): LiveModeStatus {
  const missing: string[] = [];
  if (!env.ANTHROPIC_API_KEY) {
    missing.push('ANTHROPIC_API_KEY is not set in .env.local');
  }
  if (env.MAKABL_ALLOW_UNSANDBOXED_BUILDS !== '1') {
    missing.push('MAKABL_ALLOW_UNSANDBOXED_BUILDS=1 is not set in .env.local (generated code runs on this computer without a sandbox)');
  }
  return { available: missing.length === 0, missing };
}

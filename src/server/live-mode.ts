// Whether this server may run live builds. Live builds spend real money on the
// operator's model API key and run model-written code (npm install, tests, next build)
// on this machine with no sandbox, so both have to be switched on deliberately in the
// server's environment, and the user confirms again per project.

export interface LiveModeStatus {
  available: boolean;
  /** What is missing, in words safe to show (never the key itself). */
  missing: string[];
}

/** The environment variable holding each provider's key, for providers that can build live. */
export const LIVE_KEYS: Readonly<Record<string, string>> = {
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GEMINI_API_KEY',
};

/**
 * With a provider: whether a build on that provider's model can run live. Without one:
 * whether any live build can run on this server.
 */
export function liveModeStatus(
  env: Readonly<Record<string, string | undefined>> = process.env, provider?: string,
): LiveModeStatus {
  const missing: string[] = [];
  const keys = provider ? [LIVE_KEYS[provider]].filter((k): k is string => k !== undefined) : Object.values(LIVE_KEYS);
  if (!keys.some((k) => env[k])) {
    missing.push(`${keys.join(' or ')} is not set in .env.local`);
  }
  if (env.MAKABL_ALLOW_UNSANDBOXED_BUILDS !== '1') {
    missing.push('MAKABL_ALLOW_UNSANDBOXED_BUILDS=1 is not set in .env.local (generated code runs on this computer without a sandbox)');
  }
  return { available: missing.length === 0, missing };
}

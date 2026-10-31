// Whether this server may run live builds. Live builds use the configured provider key
// and run model-written code (npm install, tests, next build)
// on this machine with no sandbox, so both have to be switched on deliberately in the
// server's environment, and the user confirms again per project.

export interface LiveModeStatus {
  available: boolean;
  /** What is missing, in words safe to show (never the key itself). */
  missing: string[];
}

export function liveModeStatus(env: Readonly<Record<string, string | undefined>> = process.env, provider = 'anthropic'): LiveModeStatus {
  const missing: string[] = [];
  if (provider === 'openai') {
    // Either key reaches OpenAI models: directly, or through OpenRouter.
    if (!env.OPENAI_API_KEY && !env.OPENROUTER_API_KEY) missing.push('OPENAI_API_KEY or OPENROUTER_API_KEY is not set in .env.local');
  } else {
    const keyName = provider === 'google' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY';
    if (!env[keyName]) missing.push(`${keyName} is not set in .env.local`);
  }
  if (env.MAKABL_ALLOW_UNSANDBOXED_BUILDS !== '1') {
    missing.push('MAKABL_ALLOW_UNSANDBOXED_BUILDS=1 is not set in .env.local (generated code runs on this computer without a sandbox)');
  }
  return { available: missing.length === 0, missing };
}

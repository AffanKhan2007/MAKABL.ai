// Whether this server may run live builds. Live builds spend real money on the
// operator's model API keys and run model-written code (npm install, tests, next build)
// on this machine with no sandbox, so both have to be switched on deliberately in the
// server's environment, and the user confirms again per project.

export interface LiveModeStatus {
  available: boolean;
  /** What is missing, in words safe to show (never the key itself). */
  missing: string[];
}

/**
 * The environment variables that can hold each provider's key, for providers that can run
 * live. OpenAI models are reachable directly or through OpenRouter.
 */
export const LIVE_KEYS: Readonly<Record<string, readonly string[]>> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  google: ['GEMINI_API_KEY'],
  openai: ['OPENAI_API_KEY', 'OPENROUTER_API_KEY'],
  groq: ['GROQ_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  qwen: ['DASHSCOPE_API_KEY'],
};

/**
 * With a provider: whether a call on that provider's model can run live. Without one:
 * whether any live build can run on this server.
 */
export function liveModeStatus(
  env: Readonly<Record<string, string | undefined>> = process.env, provider?: string,
): LiveModeStatus {
  const missing: string[] = [];
  const keys = provider ? [...(LIVE_KEYS[provider] ?? [])] : Object.values(LIVE_KEYS).flat();
  if (!keys.some((k) => env[k])) {
    missing.push(keys.length ? `${keys.join(' or ')} is not set in .env.local` : `No live adapter for ${provider}`);
  }
  if (env.MAKABL_ALLOW_UNSANDBOXED_BUILDS !== '1') {
    missing.push('MAKABL_ALLOW_UNSANDBOXED_BUILDS=1 is not set in .env.local (generated code runs on this computer without a sandbox)');
  }
  return { available: missing.length === 0, missing };
}

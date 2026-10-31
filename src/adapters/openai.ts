import type Anthropic from '@anthropic-ai/sdk';
import { NotChargedError } from '../gate/budget-gate.ts';
import { providerFetch } from './net.ts';
import { ProviderLimitError, type ClaudeMessage, type ClaudeTransport } from './claude.ts';

// OpenAI-compatible transport: Chat Completions on OpenAI directly, or on OpenRouter, which
// speaks the same format and reaches OpenAI models with one key (design: hackathon/
// openrouter.md). Like the Gemini transport it adapts to the block format the build loop
// reads, so every call still goes through the Claude adapter's reserve-and-settle path.
//
// Not yet run against the live APIs (no key on the team); covered by tests with a mocked
// fetch. The first live call should be checked against the provider's dashboard.

type MessageParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type CountParams = Anthropic.Beta.Messages.MessageCountTokensParams;

export interface OpenAiEndpoint {
  /** Chat Completions URL. */
  url: string;
  apiKey: string;
  /** Registry product → the endpoint's model id. */
  modelId(product: string): string;
  label: string;
  /** What the endpoint calls the output limit; OpenAI's newer name by default. */
  maxTokensParam?: 'max_tokens' | 'max_completion_tokens';
  /** Extra request fields this endpoint needs on every call. */
  extraBody?: Record<string, unknown>;
}

/** Groq: OpenAI-compatible, free tier with daily request limits. */
// Groq's model ids include slashes (e.g. openai/gpt-oss-120b) that are not safe in
// registry ids, so we map from the registry product slug to the real Groq model id.
const GROQ_MODELS: Record<string, string> = {
  'gpt-oss-120b': 'openai/gpt-oss-120b',
};
export const groq = (apiKey: string): OpenAiEndpoint => ({
  url: 'https://api.groq.com/openai/v1/chat/completions', apiKey,
  modelId: (p) => GROQ_MODELS[p] ?? p, label: 'Groq',
});

/** Mistral's La Plateforme: free "Experiment" tier; takes max_tokens. */
export const mistral = (apiKey: string): OpenAiEndpoint => ({
  url: 'https://api.mistral.ai/v1/chat/completions', apiKey, modelId: (p) => p, label: 'Mistral', maxTokensParam: 'max_tokens',
});

/** OpenRouter's free models, which have ":free" ids. Registry products → OpenRouter ids. */
const OPENROUTER_FREE: Record<string, string> = {
  'nemotron-ultra-free': 'nvidia/nemotron-3-ultra-550b-a55b:free',
  'gemma-4-31b-free': 'google/gemma-4-31b-it:free',
};
export const openRouterFree = (apiKey: string): OpenAiEndpoint => ({
  url: 'https://openrouter.ai/api/v1/chat/completions', apiKey, label: 'OpenRouter', maxTokensParam: 'max_tokens',
  modelId: (p) => OPENROUTER_FREE[p] ?? p,
});

export const openAiDirect = (apiKey: string): OpenAiEndpoint => ({
  url: 'https://api.openai.com/v1/chat/completions', apiKey, modelId: (p) => p, label: 'OpenAI',
});

/** OpenRouter model ids are "<vendor>/<slug>"; confirm each against GET /api/v1/models. */
export const openRouter = (apiKey: string): OpenAiEndpoint => ({
  url: 'https://openrouter.ai/api/v1/chat/completions', apiKey, modelId: (p) => `openai/${p}`, label: 'OpenRouter',
});

/**
 * Qwen Cloud (Alibaba Model Studio), international region, OpenAI-compatible mode. New accounts
 * get a free token allowance per model on this region only. Thinking is switched off: it bills
 * reasoning tokens and rejects tool_choice "required". Model ids are the bare product names.
 */
export const qwenCloud = (apiKey: string): OpenAiEndpoint => ({
  url: 'https://ap-southeast-1.maas.qwencloudapi.com/compatible-mode/v1/chat/completions',
  apiKey, modelId: (p) => p, label: 'Qwen Cloud',
  maxTokensParam: 'max_tokens', extraBody: { enable_thinking: false },
});

type Block = Record<string, any>;

/** Anthropic-style messages and system prompt → Chat Completions messages. */
export function chatMessages(params: Pick<MessageParams, 'messages' | 'system'>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  if (params.system) {
    out.push({ role: 'system', content: typeof params.system === 'string' ? params.system : params.system.map((s) => s.text).join('\n') });
  }
  for (const m of params.messages) {
    const blocks: Block[] = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content as unknown as Block[]);
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    if (m.role === 'assistant') {
      const calls = blocks.filter((b) => b.type === 'tool_use').map((b) => ({
        id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      }));
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    // Tool results become their own "tool" messages, each answering one call.
    for (const b of blocks.filter((x) => x.type === 'tool_result')) {
      const content = typeof b.content === 'string' ? b.content
        : (b.content ?? []).map((part: Block) => (part.type === 'text' ? part.text : '')).join('');
      out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.is_error ? `Error: ${content}` : content });
    }
    if (text) out.push({ role: 'user', content: text });
  }
  return out;
}

function chatTools(value: MessageParams['tools']) {
  if (!value?.length) return undefined;
  return (value as unknown as Block[]).filter((t) => typeof t.name === 'string' && t.input_schema).map((t) => ({
    type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

/** Chat Completions has no token-count endpoint: estimate high (3 characters per token). */
const estimateTokens = (params: CountParams) =>
  Math.ceil(JSON.stringify([params.system ?? '', params.messages, params.tools ?? []]).length / 3);

async function post(endpoint: OpenAiEndpoint, body: unknown): Promise<Record<string, any>> {
  for (let waited = 0; ; waited++) {
    const response = await providerFetch(endpoint.label, endpoint.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${endpoint.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(600_000),
    });
    if (response.ok) return response.json() as Promise<Record<string, any>>;
    const detail = (await response.text()).slice(0, 1200);
    if (response.status === 429 && !/insufficient_quota/.test(detail)) {
      // A rate limit clears in seconds; a used-up quota does not.
      const after = Number(response.headers.get('retry-after') ?? 'NaN');
      if (Number.isFinite(after) && after <= 65 && waited < 2) {
        await new Promise((r) => setTimeout(r, (after + 1) * 1000));
        continue;
      }
    }
    if (response.status === 429 || response.status === 402) {
      throw new ProviderLimitError(`${endpoint.label} refused the call: ${response.status === 402 ? 'out of credits' : 'quota or rate limit reached'}. Add credits or pick another model.`);
    }
    if (response.status === 400 || response.status === 401 || response.status === 403 || response.status === 404) {
      throw new NotChargedError(`${endpoint.label} API ${response.status}: ${detail}`);
    }
    throw new Error(`${endpoint.label} API ${response.status}: ${detail}`);
  }
}

export function openAiTransport(endpoint: OpenAiEndpoint): ClaudeTransport {
  return {
    countTokens: async (params) => estimateTokens(params),
    send: async (params) => {
      const tools = chatTools(params.tools);
      const result = await post(endpoint, {
        model: endpoint.modelId(params.model),
        messages: chatMessages(params),
        ...(tools ? { tools } : {}),
        [endpoint.maxTokensParam ?? 'max_completion_tokens']: params.max_tokens,
        ...endpoint.extraBody,
      });
      const choice = result.choices?.[0];
      if (!choice) throw new Error(`${endpoint.label} returned no choice`);
      const message = choice.message ?? {};
      const content: Block[] = [];
      if (typeof message.content === 'string' && message.content) content.push({ type: 'text', text: message.content });
      for (const call of message.tool_calls ?? []) {
        let input: unknown = {};
        try { input = JSON.parse(call.function?.arguments ?? '{}'); } catch { input = {}; }
        content.push({ type: 'tool_use', id: call.id, name: call.function?.name, input });
      }
      const usage = result.usage ?? {};
      const prompt = Number(usage.prompt_tokens ?? 0);
      const cached = Math.min(prompt, Number(usage.prompt_tokens_details?.cached_tokens ?? 0));
      return {
        id: String(result.id ?? 'chatcmpl'), type: 'message', role: 'assistant', model: params.model, content,
        stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use'
          : choice.finish_reason === 'length' ? 'max_tokens'
          : choice.finish_reason === 'content_filter' ? 'refusal'
          : 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: prompt - cached, output_tokens: Number(usage.completion_tokens ?? 0), cache_read_input_tokens: cached },
      } as unknown as ClaudeMessage;
    },
  };
}

/** The endpoint for one of the free OpenAI-compatible providers, if its key is set. */
export function freeEndpointFor(provider: string, env: Readonly<Record<string, string | undefined>>): OpenAiEndpoint | null {
  if (provider === 'groq' && env.GROQ_API_KEY) return groq(env.GROQ_API_KEY);
  if (provider === 'mistral' && env.MISTRAL_API_KEY) return mistral(env.MISTRAL_API_KEY);
  if (provider === 'openrouter' && env.OPENROUTER_API_KEY) return openRouterFree(env.OPENROUTER_API_KEY);
  if (provider === 'qwen' && env.DASHSCOPE_API_KEY) return qwenCloud(env.DASHSCOPE_API_KEY);
  return null;
}

/** The endpoint for this server: OpenAI if its key is set, else OpenRouter, else none. */
export function openAiEndpointFrom(env: Readonly<Record<string, string | undefined>>): OpenAiEndpoint | null {
  if (env.OPENAI_API_KEY) return openAiDirect(env.OPENAI_API_KEY);
  if (env.OPENROUTER_API_KEY) return openRouter(env.OPENROUTER_API_KEY);
  return null;
}

/** The Qwen Cloud endpoint if its key is set. */
export function qwenEndpointFrom(env: Readonly<Record<string, string | undefined>>): OpenAiEndpoint | null {
  return env.DASHSCOPE_API_KEY ? qwenCloud(env.DASHSCOPE_API_KEY) : null;
}

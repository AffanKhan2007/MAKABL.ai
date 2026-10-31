import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { NotChargedError } from '../gate/budget-gate.ts';
import { ProviderLimitError, type ClaudeMessage, type ClaudeTransport } from './claude.ts';
import { providerFetch } from './net.ts';

// Gemini transport: lets the Claude adapter, and so the Budget Gate, drive a Gemini model.
// The build loop speaks the Messages API shape; this translates each request to the
// Gemini API's generateContent and each response back, the same way the simulated model
// stands in for the API. Pricing still happens in the adapter from the usage returned here.
//
// Gemini 3 models return a thought signature with each function call that must be sent
// back with that call on the next turn. It rides on the tool_use block (the build loop
// passes assistant content back unchanged) and is restored when the history is converted.

type MessageParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type CountParams = Anthropic.Beta.Messages.MessageCountTokensParams;

const API = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}
interface GeminiContent { role: 'user' | 'model'; parts: GeminiPart[] }
interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
  };
}

/** A tool_use block carrying the Gemini thought signature for its call. */
type SignedBlock = { type: string; geminiSignature?: string } & Record<string, unknown>;

/** Posts one JSON request; tests substitute a fake. */
export type GeminiPost = (path: string, body: unknown) => Promise<unknown>;

/** Longest per-minute rate-limit wait worth sitting through inside one call. */
const MAX_WAIT_SECONDS = 65;

/** Seconds Gemini asks us to wait, from RetryInfo or the "retry in 1h2m3s" text. */
export function retryAfterSeconds(body: string): number | null {
  const delay = /"retryDelay":\s*"([\d.]+)s"/.exec(body);
  if (delay) return Number(delay[1]);
  const text = /retry in ((?:\d+h)?(?:\d+m)?(?:[\d.]+s)?)/i.exec(body)?.[1];
  if (!text) return null;
  const part = (unit: string) => Number(new RegExp(`([\\d.]+)${unit}`).exec(text)?.[1] ?? 0);
  return part('h') * 3600 + part('m') * 60 + part('s');
}

export function fetchPost(apiKey: string): GeminiPost {
  return async (path, body) => {
    for (let waited = 0; ; waited++) {
      const res = await providerFetch('Gemini', `${API}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(600_000),
      });
      if (res.ok) return res.json();
      const detail = (await res.text()).slice(0, 1200);
      const message = (() => {
        try { return (JSON.parse(detail) as { error?: { message?: string } }).error?.message ?? res.statusText; } catch { return res.statusText; }
      })();
      if (res.status === 429) {
        // A per-minute limit clears in seconds: wait once or twice. A daily quota does not,
        // and retrying only spends more of it.
        const after = retryAfterSeconds(detail);
        if (after !== null && after <= MAX_WAIT_SECONDS && waited < 2) {
          await new Promise((r) => setTimeout(r, (after + 1) * 1000));
          continue;
        }
        const model = /models\/([^:]+)/.exec(path)?.[1] ?? 'model';
        const when = after === null ? 'later' : after >= 3600 ? `in about ${Math.ceil(after / 3600)} hour(s)` : `in ${Math.ceil(after / 60)} minute(s)`;
        throw new ProviderLimitError(`Gemini ${model} quota is used up (free tier); it resets ${when}. Pick another model or use a paid key.`);
      }
      // Rejected before any work was done, so nothing was charged.
      if (res.status === 400) throw new NotChargedError(`Gemini API 400: ${message}`);
      throw new Error(`Gemini API ${res.status}: ${message}`);
    }
  };
}

const systemText = (system: MessageParams['system']): string | undefined => {
  if (system === undefined) return undefined;
  if (typeof system === 'string') return system;
  return system.map((b) => b.text).join('\n\n');
};

/** Messages-API history to Gemini contents. Thinking blocks are Claude-only and dropped. */
export function toContents(messages: MessageParams['messages']): GeminiContent[] {
  const toolNames = new Map<string, string>();
  const contents: GeminiContent[] = [];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
    const parts: GeminiPart[] = [];
    for (const raw of blocks as unknown as SignedBlock[]) {
      if (raw.type === 'text') {
        parts.push({ text: String(raw.text), ...(raw.geminiSignature ? { thoughtSignature: raw.geminiSignature } : {}) });
      } else if (raw.type === 'tool_use') {
        toolNames.set(String(raw.id), String(raw.name));
        parts.push({
          functionCall: { name: String(raw.name), args: (raw.input ?? {}) as Record<string, unknown> },
          ...(raw.geminiSignature ? { thoughtSignature: raw.geminiSignature } : {}),
        });
      } else if (raw.type === 'tool_result') {
        const content = typeof raw.content === 'string'
          ? raw.content
          : (raw.content as Array<{ text?: string }> | undefined ?? []).map((c) => c.text ?? '').join('\n');
        parts.push({
          functionResponse: {
            name: toolNames.get(String(raw.tool_use_id)) ?? 'unknown_tool',
            response: raw.is_error ? { error: content } : { output: content },
          },
        });
      }
    }
    if (parts.length) contents.push({ role, parts });
  }
  return contents;
}

function requestBody(params: MessageParams | CountParams, maxTokens?: number): Record<string, unknown> {
  const system = systemText(params.system);
  const tools = (params.tools ?? []) as Array<{ name: string; description?: string; input_schema?: unknown }>;
  return {
    contents: toContents(params.messages),
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    ...(tools.length ? {
      tools: [{
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          ...(t.description ? { description: t.description } : {}),
          parametersJsonSchema: t.input_schema ?? { type: 'object', properties: {} },
        })),
      }],
    } : {}),
    ...(maxTokens ? { generationConfig: { maxOutputTokens: maxTokens } } : {}),
  };
}

/** A Gemini response in the Messages API shape the build loop and the adapter read. */
export function toMessage(res: GeminiResponse, model: string): ClaudeMessage {
  const candidate = res.candidates?.[0];
  const content: SignedBlock[] = [];
  for (const p of candidate?.content?.parts ?? []) {
    if (p.thought) continue;
    const sig = p.thoughtSignature ? { geminiSignature: p.thoughtSignature } : {};
    if (p.functionCall) {
      content.push({ type: 'tool_use', id: `toolu_gem_${randomUUID()}`, name: p.functionCall.name, input: p.functionCall.args ?? {}, ...sig });
    } else if (p.text !== undefined) {
      content.push({ type: 'text', text: p.text, ...sig });
    }
  }
  const finish = candidate?.finishReason ?? (res.promptFeedback?.blockReason ? 'SAFETY' : 'STOP');
  const stop = content.some((b) => b.type === 'tool_use') ? 'tool_use'
    : finish === 'MAX_TOKENS' ? 'max_tokens'
    : ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'].includes(finish) ? 'refusal'
    : 'end_turn';

  const u = res.usageMetadata ?? {};
  const cached = u.cachedContentTokenCount ?? 0;
  return {
    id: `msg_gem_${randomUUID()}`, type: 'message', role: 'assistant', model,
    content, stop_reason: stop, stop_sequence: null,
    usage: {
      input_tokens: Math.max(0, (u.promptTokenCount ?? 0) - cached),
      // Gemini bills thinking tokens at the output rate.
      output_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
      cache_read_input_tokens: cached,
      cache_creation_input_tokens: 0,
    },
  } as unknown as ClaudeMessage;
}

/** The transport for Gemini models. Reads nothing from the environment; pass the key. */
export function geminiTransport(post: GeminiPost): ClaudeTransport {
  return {
    countTokens: async (params) => {
      const { contents, systemInstruction, tools } = requestBody(params);
      const res = await post(`models/${params.model}:countTokens`, {
        generateContentRequest: { model: `models/${params.model}`, contents, systemInstruction, tools },
      }) as { totalTokens?: number };
      return res.totalTokens ?? 0;
    },
    send: async (params) =>
      toMessage(await post(`models/${params.model}:generateContent`, requestBody(params, params.max_tokens)) as GeminiResponse, params.model),
  };
}

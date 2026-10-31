import type Anthropic from '@anthropic-ai/sdk';
import { NotChargedError } from '../gate/budget-gate.ts';
import { ProviderLimitError, type ClaudeMessage, type ClaudeTransport } from './claude.ts';

type MessageParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type CountParams = Anthropic.Beta.Messages.MessageCountTokensParams;

const API = 'https://generativelanguage.googleapis.com/v1beta/models';

function contents(params: Pick<MessageParams, 'messages'>) {
  const functionNames = new Map<string, string>();
  return params.messages.map((message) => {
    const role = message.role === 'assistant' ? 'model' : 'user';
    const blocks: Array<Record<string, any>> = typeof message.content === 'string'
      ? [{ type: 'text', text: message.content }]
      : (message.content ?? []) as unknown as Array<Record<string, any>>;
    const parts: Array<Record<string, unknown>> = [];
    for (const block of blocks) {
      if (block.type === 'text') {
        parts.push({ text: block.text });
        continue;
      }
      if (block.type === 'tool_use') {
        functionNames.set(block.id, block.name);
        parts.push({ functionCall: { name: block.name, args: block.input },
          ...(typeof block.thoughtSignature === 'string' ? { thoughtSignature: block.thoughtSignature } : {}) });
        continue;
      }
      if (block.type === 'tool_result') {
        const response = typeof block.content === 'string' ? block.content
          : block.content?.map((part: { type?: string; text?: string }) => part.type === 'text' ? part.text : '').join('') ?? '';
        parts.push({ functionResponse: { name: functionNames.get(block.tool_use_id) ?? block.tool_use_id, response: { result: response } } });
      }
    }
    return { role, parts };
  });
}

function systemInstruction(system: MessageParams['system']) {
  if (!system) return undefined;
  const text = typeof system === 'string' ? system : system.map((part) => part.text).join('\n');
  return { parts: [{ text }] };
}

function tools(value: MessageParams['tools']) {
  if (!value?.length) return undefined;
  const declarations = (value as unknown as Array<Record<string, any>>).filter((tool) =>
    typeof tool.name === 'string' && tool.input_schema,
  );
  return [{ functionDeclarations: declarations.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: Object.fromEntries(Object.entries(tool.input_schema).filter(([key]) => key !== 'additionalProperties')),
  })) }];
}

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

async function request(apiKey: string, model: string, method: 'generateContent' | 'countTokens', body: unknown) {
  for (let waited = 0; ; waited++) {
    const response = await fetch(`${API}/${encodeURIComponent(model)}:${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(600_000),
    });
    if (response.ok) return response.json() as Promise<Record<string, any>>;
    const detail = (await response.text()).slice(0, 1200);
    if (response.status === 429) {
      // A per-minute limit clears in seconds: wait once or twice. A daily quota does not,
      // and retrying only spends more of it.
      const after = retryAfterSeconds(detail);
      if (after !== null && after <= MAX_WAIT_SECONDS && waited < 2) {
        await new Promise((r) => setTimeout(r, (after + 1) * 1000));
        continue;
      }
      const when = after === null ? 'later' : after >= 3600 ? `in about ${Math.ceil(after / 3600)} hour(s)` : `in ${Math.ceil(after / 60)} minute(s)`;
      throw new ProviderLimitError(`Gemini ${model} quota is used up (free tier); it resets ${when}. Pick another model or use a paid key.`);
    }
    // Rejected before any work was done, so nothing was charged.
    if (response.status === 400) throw new NotChargedError(`Gemini API 400: ${detail}`);
    throw new Error(`Gemini API ${response.status}: ${detail}`);
  }
}

/** Gemini REST transport. It adapts function calls into the block format consumed by the build loop. */
export function geminiTransport(apiKey: string): ClaudeTransport {
  return {
    countTokens: async (params: CountParams) => {
      // countTokens takes a system prompt or tools only inside a full generateContentRequest.
      const result = await request(apiKey, params.model, 'countTokens', {
        generateContentRequest: {
          model: `models/${params.model}`,
          contents: contents(params),
          ...(params.system ? { systemInstruction: systemInstruction(params.system) } : {}),
          ...(params.tools ? { tools: tools(params.tools) } : {}),
        },
      });
      const count = result.totalTokens ?? result.total_tokens;
      if (typeof count !== 'number') throw new Error('Gemini countTokens returned no token count');
      return count;
    },
    send: async (params: MessageParams) => {
      const result = await request(apiKey, params.model, 'generateContent', {
        contents: contents(params),
        ...(params.system ? { systemInstruction: systemInstruction(params.system) } : {}),
        ...(params.tools ? { tools: tools(params.tools) } : {}),
        generationConfig: { maxOutputTokens: params.max_tokens },
      });
      const candidate = result.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      const content = parts.flatMap((part: Record<string, any>) => [
        ...(typeof part.text === 'string' ? [{ type: 'text', text: part.text }] : []),
        ...(part.functionCall ? [{
          type: 'tool_use', id: `gemini_${crypto.randomUUID()}`,
          name: part.functionCall.name, input: part.functionCall.args ?? {},
          ...(typeof part.thoughtSignature === 'string' ? { thoughtSignature: part.thoughtSignature } : {}),
        }] : []),
      ]);
      const usage = result.usageMetadata ?? {};
      const promptTokens = Number(usage.promptTokenCount ?? 0);
      const cachedTokens = Math.min(promptTokens, Number(usage.cachedContentTokenCount ?? 0));
      const message = {
        id: `gemini_${crypto.randomUUID()}`, type: 'message', role: 'assistant', model: params.model,
        content,
        stop_reason: content.some((block: { type: string }) => block.type === 'tool_use') ? 'tool_use'
          : candidate.finishReason === 'MAX_TOKENS' ? 'max_tokens'
          : candidate.finishReason === 'SAFETY' || candidate.finishReason === 'PROHIBITED_CONTENT' ? 'refusal'
          : 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: promptTokens - cachedTokens,
          output_tokens: Number(usage.candidatesTokenCount ?? 0) + Number(usage.thoughtsTokenCount ?? 0),
          cache_read_input_tokens: cachedTokens,
        },
      };
      if (!candidate) throw new Error('Gemini returned no candidate');
      return message as unknown as ClaudeMessage;
    },
  };
}

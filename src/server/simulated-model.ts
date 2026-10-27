import { randomUUID } from 'node:crypto';
import type { ClaudeMessage, ClaudeTransport } from '../adapters/claude.ts';
import { featureSlug } from '../spec/acceptance.ts';

// A stand-in for the Claude API so the whole build flow can be seen without spending
// anything. For each feature it lists files, writes one file, runs the checks and
// finishes, with token usage shaped like a cached agent loop. Its runs are never
// written to calibration_runs: fake data must not train the estimator.

export { featureSlug };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Usage for turn k of the loop: earlier context is a cache read, the new part a write. */
function usageFor(turn: number) {
  const base = 8_000;
  const growth = 1_500;
  const written = turn === 0 ? base : growth;
  return {
    input_tokens: 50,
    output_tokens: 1_200,
    cache_read_input_tokens: turn === 0 ? 0 : base + (turn - 1) * growth,
    cache_creation_input_tokens: written,
    cache_creation: { ephemeral_5m_input_tokens: written, ephemeral_1h_input_tokens: 0 },
  };
}

export function simulatedTransport(delayMs = 350): ClaudeTransport {
  return {
    countTokens: async (params) => Math.ceil(JSON.stringify(params).length / 3),
    send: async (params) => {
      await sleep(delayMs);
      const first = params.messages[0];
      const text = typeof first?.content === 'string' ? first.content : '';
      const name = /^Feature: (.+) \(\w+\)$/m.exec(text)?.[1] ?? 'feature';
      const slug = featureSlug(name);
      // messages = [task, (assistant, tool results) x k]: this is turn k.
      const turn = (params.messages.length - 1) / 2;

      const toolUse = (tool: string, input: Record<string, unknown>) => ({
        type: 'tool_use', id: `toolu_sim_${randomUUID()}`, name: tool, input,
      });
      const [stop, content] =
        turn === 0 ? ['tool_use', [toolUse('list_files', { path: '.' })]]
        : turn === 1 ? ['tool_use', [toolUse('write_file', {
          path: `features/${slug}.ts`,
          content: `// ${name}\nexport const feature = ${JSON.stringify(name)};\n`,
        })]]
        : turn === 2 ? ['tool_use', [toolUse('run_checks', {})]]
        : ['end_turn', [{ type: 'text', text: `Built ${name} in features/${slug}.ts. Checks pass.` }]];

      return {
        id: `msg_sim_${randomUUID()}`, type: 'message', role: 'assistant', model: params.model,
        content, stop_reason: stop, stop_sequence: null, usage: usageFor(turn),
      } as unknown as ClaudeMessage;
    },
  };
}

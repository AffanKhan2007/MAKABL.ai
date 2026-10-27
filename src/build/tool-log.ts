// Tool results already given to the model, keyed by build step and tool_use id.
//
// Resuming a build after a pause replays earlier model turns from the Budget Gate. Their
// tool calls must get the same results as the first time: files may have changed since,
// and sending different history would edit the conversation, which invalidates thinking
// blocks on Claude Opus 5.5 (and 400s on newer accounts). So results are stored before
// they are sent and reused on replay.

export interface ToolResultRecord {
  content: string;
  isError: boolean;
}

export interface ToolLog {
  get(key: string): Promise<ToolResultRecord | undefined>;
  put(key: string, record: ToolResultRecord): Promise<void>;
}

export class MemoryToolLog implements ToolLog {
  private readonly records = new Map<string, ToolResultRecord>();

  async get(key: string): Promise<ToolResultRecord | undefined> {
    return this.records.get(key);
  }

  async put(key: string, record: ToolResultRecord): Promise<void> {
    // First write wins: a replay must never overwrite what the model already saw.
    if (!this.records.has(key)) this.records.set(key, { ...record });
  }
}

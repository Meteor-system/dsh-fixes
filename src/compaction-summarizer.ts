export type CompactionStreamOptions = {
  purpose?: string;
  messages?: unknown;
  provider?: string;
  model?: string;
  [key: string]: unknown;
};

type RecordValue = Record<string, unknown>;

const PROMPT_TOO_LONG_CODES = new Set([
  "CONTEXT_WINDOW_EXCEEDED",
  "CONTEXT_LENGTH_EXCEEDED",
  "MAX_CONTEXT_LENGTH",
  "PROMPT_TOO_LONG",
  "INPUT_TOO_LONG",
  "REQUEST_TOO_LARGE",
]);

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyText(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

function nextFailure(value: RecordValue): unknown {
  return value.failure ?? value.cause;
}

export function isPromptTooLongFailure(value: unknown): boolean {
  const seen = new Set<object>();
  let current: unknown = value;
  for (let depth = 0; depth < 8 && current !== undefined && current !== null; depth += 1) {
    if (typeof current === "object") {
      if (seen.has(current)) break;
      seen.add(current);
    }
    if (isRecord(current)) {
      if (typeof current.code === "string" && PROMPT_TOO_LONG_CODES.has(current.code.toUpperCase())) return true;
      if (typeof current.message === "string" && /prompt\s+(?:is\s+)?too\s+long|context\s+window(?:\s+limit)?\s+exceed(?:ed|s)?|maximum\s+context\s+length|too\s+many\s+tokens(?:\s+in\s+(?:the\s+)?prompt)?/i.test(current.message)) {
        return true;
      }
      current = nextFailure(current);
      continue;
    }
    if (current instanceof Error && /prompt\s+(?:is\s+)?too\s+long|context\s+window(?:\s+limit)?\s+exceed(?:ed|s)?|maximum\s+context\s+length|too\s+many\s+tokens(?:\s+in\s+(?:the\s+)?prompt)?/i.test(current.message)) {
      return true;
    }
    break;
  }
  return false;
}

function blockHasVisibleOutput(block: RecordValue): boolean {
  if (block.type === "text" || block.type === "reasoning") return nonEmptyText(block.text);
  if (block.type === "tool-call" || block.type === "tool-use") {
    return nonEmptyText(block.name) || nonEmptyText(block.arguments) || nonEmptyText(block.argumentsDelta) || nonEmptyText(block.id);
  }
  return false;
}

export function hasVisibleStreamOutput(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.type === "text-delta" || value.type === "reasoning-delta") return nonEmptyText(value.text);
  if (value.type === "tool-call-delta") return nonEmptyText(value.name) || nonEmptyText(value.argumentsDelta);
  if (value.type === "block-end" && isRecord(value.block)) return blockHasVisibleOutput(value.block);
  if (value.type === "text" || value.type === "reasoning" || value.type === "tool-call" || value.type === "tool-use") {
    return blockHasVisibleOutput(value);
  }
  return false;
}

export function applyCompactionRoute<T extends CompactionStreamOptions>(
  options: T,
  summarization?: { provider: string; model: string } | null,
): T {
  if (options.purpose !== "compaction" || summarization === undefined || summarization === null) return options;
  return {
    ...options,
    provider: summarization.provider,
    model: summarization.model,
  };
}

function messageRole(message: unknown): string | undefined {
  return isRecord(message) && typeof message.role === "string" ? message.role : undefined;
}

function messageSourceKind(message: unknown): string | undefined {
  if (!isRecord(message) || !isRecord(message.source)) return undefined;
  return typeof message.source.kind === "string" ? message.source.kind : undefined;
}

function isDirectUser(message: unknown): boolean {
  return messageRole(message) === "user" && messageSourceKind(message) !== "tool";
}

function messageBlocks(message: unknown): RecordValue[] {
  if (!isRecord(message) || !Array.isArray(message.content)) return [];
  return message.content.filter(isRecord);
}

function toolId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toolPairBalanced(messages: readonly unknown[]): boolean {
  const pending = new Set<string>();
  for (const message of messages) {
    const source = isRecord(message) && isRecord(message.source) ? message.source : undefined;
    const sourceCallId = source?.kind === "tool" ? toolId(source.callId) : undefined;
    for (const block of messageBlocks(message)) {
      const type = typeof block.type === "string" ? block.type : "";
      if (type === "tool-result" || type === "tool-use-result" || sourceCallId !== undefined && pending.has(sourceCallId)) {
        const resultId = toolId(block.callId) ?? toolId(block.toolCallId) ?? sourceCallId;
        if (resultId === undefined || !pending.delete(resultId)) return false;
        continue;
      }
      if (type === "tool-call" || type === "tool-use") {
        const callId = toolId(block.id) ?? toolId(block.callId) ?? toolId(block.toolCallId);
        if (callId !== undefined) pending.add(callId);
      }
    }
    if (sourceCallId !== undefined && messageBlocks(message).length === 0) {
      if (!pending.delete(sourceCallId)) return false;
    }
  }
  return pending.size === 0;
}

function prefixLength(messages: readonly unknown[]): number {
  let index = 0;
  while (index < messages.length && messageRole(messages[index]) === "system") index += 1;
  return index;
}

function candidateCuts(messages: readonly unknown[], prefixEnd: number, lastIndex: number): number[] {
  const directUsers: number[] = [];
  for (let index = prefixEnd; index <= lastIndex; index += 1) {
    if (isDirectUser(messages[index])) directUsers.push(index);
  }
  const cuts = directUsers.filter((index) => index > prefixEnd);
  if (cuts.length > 0) return cuts;
  return directUsers.length > 0 && lastIndex > prefixEnd ? [lastIndex] : [];
}

export function trimOldestCompleteTurns(messages: readonly unknown[]): unknown[] {
  if (messages.length <= 2) return messages.slice();
  const prefixEnd = prefixLength(messages);
  const lastIndex = messages.length - 1;
  if (lastIndex <= prefixEnd) return messages.slice();

  for (const cut of candidateCuts(messages, prefixEnd, lastIndex)) {
    const candidate = [
      ...messages.slice(0, prefixEnd),
      ...messages.slice(cut),
    ];
    if (candidate.length < messages.length && toolPairBalanced(candidate)) return candidate;
  }
  return messages.slice();
}

export async function* retryCompactionStream(
  original: (options: CompactionStreamOptions) => AsyncIterable<unknown>,
  options: CompactionStreamOptions,
): AsyncIterable<unknown> {
  let visibleOutput = false;
  try {
    for await (const chunk of original(options)) {
      visibleOutput ||= hasVisibleStreamOutput(chunk);
      yield chunk;
    }
    return;
  } catch (error) {
    if (options.purpose !== "compaction" || visibleOutput || !isPromptTooLongFailure(error) || !Array.isArray(options.messages)) throw error;
    const trimmed = trimOldestCompleteTurns(options.messages);
    if (trimmed.length >= options.messages.length) throw error;
    for await (const chunk of original({ ...options, messages: trimmed })) yield chunk;
  }
}

import type { FileTouch, RehydrationItem } from "./compaction-rehydration.js";

// The raw session log is the only source that survives both compaction (which
// shadows older messages out of `deriveMessages`) and Host restarts (which clear
// any in-memory ledger). Every reader below works on `snapshotEvents()`.

type RecordValue = Record<string, unknown>;

type ToolCall = { seq: number; callId: string; name: string; args?: RecordValue };
type ToolOutcome = { ok: boolean; text: string };

const FILE_TOOLS = new Set(["read", "write", "edit"]);

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sessionEventList(session: unknown): readonly unknown[] {
  if (!isRecord(session) || typeof session.snapshotEvents !== "function") return [];
  try {
    const events = session.snapshotEvents();
    return Array.isArray(events) ? events : [];
  } catch {
    return [];
  }
}

function eventData(event: unknown): RecordValue | undefined {
  return isRecord(event) && isRecord(event.data) ? event.data : undefined;
}

function eventSeq(event: unknown, fallback: number): number {
  return isRecord(event) && typeof event.seq === "number" && Number.isFinite(event.seq) ? event.seq : fallback;
}

function parseArguments(value: unknown): RecordValue | undefined {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function messageText(message: RecordValue): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter(isRecord)
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .filter((text) => text.length > 0)
    .join("\n");
}

function toolHistory(events: readonly unknown[]): { calls: ToolCall[]; outcomes: Map<string, ToolOutcome> } {
  const calls: ToolCall[] = [];
  const outcomes = new Map<string, ToolOutcome>();
  events.forEach((event, index) => {
    if (!isRecord(event)) return;
    const data = eventData(event);
    if (data === undefined) return;
    if (event.type === "tool/call" && typeof data.callId === "string" && typeof data.name === "string") {
      calls.push({ seq: eventSeq(event, index), callId: data.callId, name: data.name, args: parseArguments(data.arguments) });
    } else if (event.type === "tool/result" && isRecord(data.message) && typeof data.message.toolCallId === "string") {
      // A `tool/result` carries `error` only on failure; success leaves it absent.
      outcomes.set(data.message.toolCallId, { ok: data.error === undefined, text: messageText(data.message) });
    }
  });
  return { calls, outcomes };
}

/** Successful read/write/edit calls, in log order, as file-touch candidates. */
export function fileTouchesFromEvents(events: readonly unknown[]): FileTouch[] {
  const { calls, outcomes } = toolHistory(events);
  const touches: FileTouch[] = [];
  for (const call of calls) {
    if (!FILE_TOOLS.has(call.name)) continue;
    const path = call.args?.file_path;
    if (typeof path !== "string" || path.length === 0) continue;
    if (outcomes.get(call.callId)?.ok !== true) continue;
    touches.push({ path, order: call.seq });
  }
  return touches;
}

/**
 * Skill bodies that were loaded in this session: successful `skill` tool results
 * (their text is the full `<skill_content>` block) plus durable skill-invocation
 * user messages. The most recent load of each name wins.
 */
export function skillItemsFromEvents(events: readonly unknown[]): RehydrationItem[] {
  const { calls, outcomes } = toolHistory(events);
  const loads: Array<{ seq: number; name: string; text: string }> = [];
  for (const call of calls) {
    if (call.name !== "skill") continue;
    const name = call.args?.name;
    if (typeof name !== "string" || name.length === 0) continue;
    const outcome = outcomes.get(call.callId);
    if (outcome?.ok !== true || outcome.text.length === 0) continue;
    loads.push({ seq: call.seq, name, text: outcome.text });
  }
  events.forEach((event, index) => {
    const data = eventData(event);
    if (!isRecord(event) || event.type !== "user/message" || data === undefined) return;
    if (!isRecord(data.source) || data.source.kind !== "skill-invocation") return;
    const name = typeof data.source.name === "string" && data.source.name.length > 0 ? data.source.name : "skill";
    const text = messageText(data);
    if (text.length > 0) loads.push({ seq: eventSeq(event, index), name, text });
  });
  const latest = new Map<string, RehydrationItem>();
  for (const load of loads.sort((left, right) => left.seq - right.seq)) {
    latest.delete(load.name);
    latest.set(load.name, { kind: "skill", name: load.name, text: load.text });
  }
  return [...latest.values()];
}

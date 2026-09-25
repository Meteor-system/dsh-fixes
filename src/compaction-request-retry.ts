import { hasVisibleStreamOutput, isPromptTooLongFailure } from "./compaction-summarizer.js";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function packedRecordHasVisibleOutput(value: unknown): boolean {
  if (!isRecord(value)) return true;
  if (value.type === "text-chunks" || value.type === "reasoning-chunks") {
    return Array.isArray(value.texts) && value.texts.some(nonEmpty);
  }
  if (value.type === "tool-call-chunks") {
    return nonEmpty(value.name) || Array.isArray(value.args) && value.args.some(nonEmpty);
  }
  if (value.type === "chunk") return hasVisibleStreamOutput(value.chunk);
  return true;
}

function attemptVisibleOutput(event: unknown): boolean {
  if (!isRecord(event)) return true;
  const data = isRecord(event.data) ? event.data : event;
  if (!Array.isArray(data.stream)) return true;
  return data.stream.some(packedRecordHasVisibleOutput);
}

function latestAttempt(events: readonly unknown[]): unknown | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (isRecord(event) && event.type === "assistant/attempt") return event;
  }
  return undefined;
}

function sessionEvents(session: RecordValue): readonly unknown[] | undefined {
  if (typeof session.snapshotEvents === "function") {
    try {
      const events = session.snapshotEvents();
      return Array.isArray(events) ? events : undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof session.eventAt !== "function" || typeof session.seq !== "number" || !Number.isSafeInteger(session.seq)) return undefined;
  const events: unknown[] = [];
  const start = Math.max(0, session.seq - 128);
  try {
    for (let seq = start; seq < session.seq; seq += 1) events.push(session.eventAt(seq));
  } catch {
    return undefined;
  }
  return events;
}

export type CompactionRetryGate = {
  canRetry(agent: object, turn: number): boolean;
  markRetried(agent: object, turn: number): void;
  reset(agent?: object): void;
};

export function createCompactionRetryGate(): CompactionRetryGate {
  let states = new WeakMap<object, Set<number>>();
  return {
    canRetry(agent, turn) {
      return !(states.get(agent)?.has(turn) ?? false);
    },
    markRetried(agent, turn) {
      const turns = states.get(agent) ?? new Set<number>();
      turns.add(turn);
      states.set(agent, turns);
    },
    reset(agent) {
      if (agent === undefined) states = new WeakMap<object, Set<number>>();
      else states.delete(agent);
    },
  };
}

export function sessionAttemptHasVisibleOutput(session: unknown): boolean {
  if (!isRecord(session)) return true;
  const events = sessionEvents(session);
  if (events === undefined) return true;
  const attempt = latestAttempt(events);
  return attempt === undefined ? true : attemptVisibleOutput(attempt);
}

export function shouldRetryRequestAfterCompaction(input: {
  failure: unknown;
  outputStarted: boolean;
  alreadyRetried: boolean;
  noProgress?: boolean;
  signalAborted?: boolean;
}): boolean {
  return !input.outputStarted
    && !input.alreadyRetried
    && !input.noProgress
    && !input.signalAborted
    && isPromptTooLongFailure(input.failure);
}

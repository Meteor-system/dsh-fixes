export type AutoCompactInput = {
  estimatedTokens: number;
  contextWindow: number;
  thresholdRatio: number;
  busy: boolean;
  locked: boolean;
};

export function shouldAutoCompact(input: AutoCompactInput): boolean {
  if (input.busy || input.locked) return false;
  if (!(input.contextWindow > 0) || !(input.estimatedTokens >= 0)) return false;
  return input.estimatedTokens >= input.contextWindow * input.thresholdRatio;
}

/** Isolate compaction-basic re-checks its own 0.8 pressure threshold; overflow bypasses it. */
export function autoCompactTrigger(): "context-overflow" {
  return "context-overflow";
}

const LOCK_SCAN = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function eventType(value: unknown): string | undefined {
  return isRecord(value) && typeof value.type === "string" ? value.type : undefined;
}

/**
 * Cheap reverse scan for an unmatched compaction/start on the live session.
 * Caps at the last 64 events so never-compacted logs stay O(1).
 */
export function sessionCompactionLocked(session: unknown): boolean {
  if (!isRecord(session)) return false;
  try {
    if (typeof session.eventAt === "function" && typeof session.seq === "number") {
      const start = session.seq - 1;
      const stop = Math.max(-1, start - LOCK_SCAN);
      for (let seq = start; seq > stop; seq -= 1) {
        const type = eventType(session.eventAt(seq));
        if (type === "compaction/start") return true;
        if (type === "compaction/end" || type === "session/end-seed") return false;
      }
      return false;
    }
    if (typeof session.snapshotEvents === "function") {
      const events = session.snapshotEvents();
      if (!Array.isArray(events)) return false;
      const start = events.length - 1;
      const stop = Math.max(-1, start - LOCK_SCAN);
      for (let index = start; index > stop; index -= 1) {
        const type = eventType(events[index]);
        if (type === "compaction/start") return true;
        if (type === "compaction/end" || type === "session/end-seed") return false;
      }
    }
  } catch {
    return false;
  }
  return false;
}

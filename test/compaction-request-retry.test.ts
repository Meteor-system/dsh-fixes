import { describe, expect, it } from "vitest";
import {
  createCompactionRetryGate,
  sessionAttemptHasVisibleOutput,
  shouldRetryRequestAfterCompaction,
} from "../src/compaction-request-retry.ts";

describe("CompactionRetryGate", () => {
  it("allows one retry per agent and turn", () => {
    const gate = createCompactionRetryGate();
    const agent = {};
    const other = {};
    expect(gate.canRetry(agent, 1)).toBe(true);
    gate.markRetried(agent, 1);
    expect(gate.canRetry(agent, 1)).toBe(false);
    expect(gate.canRetry(agent, 2)).toBe(true);
    expect(gate.canRetry(other, 1)).toBe(true);
    gate.reset(agent);
    expect(gate.canRetry(agent, 1)).toBe(true);
  });
});

describe("sessionAttemptHasVisibleOutput", () => {
  it("reads packed text, reasoning, and tool-call records", () => {
    expect(sessionAttemptHasVisibleOutput({
      snapshotEvents: () => [{
        type: "assistant/attempt",
        data: { stream: [{ type: "text-chunks", texts: ["answer"] }] },
      }],
    })).toBe(true);
    expect(sessionAttemptHasVisibleOutput({
      snapshotEvents: () => [{
        type: "assistant/attempt",
        data: { stream: [{ type: "reasoning-chunks", texts: ["thinking"] }] },
      }],
    })).toBe(true);
    expect(sessionAttemptHasVisibleOutput({
      snapshotEvents: () => [{
        type: "assistant/attempt",
        data: { stream: [{ type: "tool-call-chunks", name: "read", args: ["{}"] }] },
      }],
    })).toBe(true);
  });

  it("treats only control records as zero output", () => {
    expect(sessionAttemptHasVisibleOutput({
      snapshotEvents: () => [{
        type: "assistant/attempt",
        data: { stream: [{ type: "chunk", chunk: { type: "finish", reason: "error" } }] },
      }],
    })).toBe(false);
  });

  it("fails closed when the latest attempt cannot be inspected", () => {
    expect(sessionAttemptHasVisibleOutput(undefined)).toBe(true);
    expect(sessionAttemptHasVisibleOutput({ snapshotEvents: () => [] })).toBe(true);
    expect(sessionAttemptHasVisibleOutput({ snapshotEvents: () => [{ type: "turn/end" }] })).toBe(true);
  });
});

describe("shouldRetryRequestAfterCompaction", () => {
  it("requires an overflow failure, zero output, and an unused retry", () => {
    expect(shouldRetryRequestAfterCompaction({
      failure: { code: "CONTEXT_WINDOW_EXCEEDED" },
      outputStarted: false,
      alreadyRetried: false,
    })).toBe(true);
    expect(shouldRetryRequestAfterCompaction({
      failure: { code: "CONTEXT_WINDOW_EXCEEDED" },
      outputStarted: true,
      alreadyRetried: false,
    })).toBe(false);
    expect(shouldRetryRequestAfterCompaction({
      failure: { code: "CONTEXT_WINDOW_EXCEEDED" },
      outputStarted: false,
      alreadyRetried: true,
    })).toBe(false);
    expect(shouldRetryRequestAfterCompaction({
      failure: { code: "AUTH_FAILED" },
      outputStarted: false,
      alreadyRetried: false,
    })).toBe(false);
    expect(shouldRetryRequestAfterCompaction({
      failure: { code: "CONTEXT_WINDOW_EXCEEDED" },
      outputStarted: false,
      alreadyRetried: false,
      noProgress: true,
    })).toBe(false);
    expect(shouldRetryRequestAfterCompaction({
      failure: { code: "CONTEXT_WINDOW_EXCEEDED" },
      outputStarted: false,
      alreadyRetried: false,
      signalAborted: true,
    })).toBe(false);
  });
});

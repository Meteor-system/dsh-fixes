import { describe, expect, it } from "vitest";
import { autoCompactTrigger, sessionCompactionLocked, shouldAutoCompact } from "../src/compaction-policy.ts";

describe("shouldAutoCompact", () => {
  it("fires at or above window * ratio", () => {
    expect(
      shouldAutoCompact({
        estimatedTokens: 200000,
        contextWindow: 500000,
        thresholdRatio: 0.4,
        busy: false,
        locked: false,
      }),
    ).toBe(true);
  });

  it("skips below threshold, when busy, or when locked", () => {
    const base = {
      estimatedTokens: 200000,
      contextWindow: 500000,
      thresholdRatio: 0.4,
      busy: false,
      locked: false,
    };
    expect(shouldAutoCompact({ ...base, estimatedTokens: 199999 })).toBe(false);
    expect(shouldAutoCompact({ ...base, busy: true })).toBe(false);
    expect(shouldAutoCompact({ ...base, locked: true })).toBe(false);
  });
});

describe("autoCompactTrigger", () => {
  it("uses context-overflow so the slider is not blocked by the engine pressure threshold", () => {
    expect(autoCompactTrigger()).toBe("context-overflow");
  });
});

describe("sessionCompactionLocked", () => {
  it("treats an unmatched compaction/start as locked", () => {
    const events = [{ type: "turn/end" }, { type: "compaction/start" }, { type: "user/message" }];
    expect(
      sessionCompactionLocked({
        seq: events.length,
        eventAt: (seq: number) => events[seq],
      }),
    ).toBe(true);
  });

  it("treats a later compaction/end as unlocked", () => {
    const events = [{ type: "compaction/start" }, { type: "compaction/end" }];
    expect(
      sessionCompactionLocked({
        seq: events.length,
        eventAt: (seq: number) => events[seq],
      }),
    ).toBe(false);
  });

  it("returns false when the session cannot be inspected", () => {
    expect(sessionCompactionLocked(undefined)).toBe(false);
    expect(sessionCompactionLocked({})).toBe(false);
  });
});

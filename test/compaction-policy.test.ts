import { describe, expect, it } from "vitest";
import { autoCompactTrigger, shouldAutoCompact } from "../src/compaction-policy.ts";

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

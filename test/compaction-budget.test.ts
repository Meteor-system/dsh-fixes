import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUMMARY_OUTPUT_TOKENS,
  DEFAULT_TOOL_RESULT_TOKENS,
  resolveCompactionBudget,
} from "../src/compaction-budget.ts";

describe("resolveCompactionBudget", () => {
  it("reserves the summary output and one tool result", () => {
    expect(resolveCompactionBudget(272_000)).toEqual({
      contextWindow: 272_000,
      summaryOutputTokens: DEFAULT_SUMMARY_OUTPUT_TOKENS,
      toolResultTokens: DEFAULT_TOOL_RESULT_TOKENS,
      thresholdTokens: 239_000,
    });
  });

  it("floors small windows at half the context", () => {
    expect(resolveCompactionBudget(8_000)?.thresholdTokens).toBe(4_000);
    expect(resolveCompactionBudget(32_000)?.thresholdTokens).toBe(16_000);
  });

  it("accepts finite route-level reserve overrides", () => {
    expect(resolveCompactionBudget(272_000, {
      summaryOutputTokens: 10_000,
      toolResultTokens: 5_000,
    })?.thresholdTokens).toBe(257_000);
    expect(resolveCompactionBudget(272_000, { summaryOutputTokens: 10_000 })?.toolResultTokens).toBe(13_000);
  });

  it("falls back for invalid values and rejects invalid windows", () => {
    expect(resolveCompactionBudget(272_000, {
      summaryOutputTokens: -1,
      toolResultTokens: Number.NaN,
    })?.thresholdTokens).toBe(239_000);
    expect(resolveCompactionBudget(0)).toBeUndefined();
    expect(resolveCompactionBudget(-1)).toBeUndefined();
    expect(resolveCompactionBudget(Number.NaN)).toBeUndefined();
  });
});

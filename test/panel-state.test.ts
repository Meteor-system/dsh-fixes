import { describe, expect, it } from "vitest";
import { buildPanelState } from "../src/panel-state.ts";

describe("buildPanelState", () => {
  it("uses a stored 200000 window over the llm 500000 window", () => {
    expect(
      buildPanelState({
        provider: "routincodex",
        model: "grok-4.6",
        llmContextWindow: 500000,
        fixes: {
          contextWindows: { "routincodex/grok-4.6": 200000 },
          summarization: { provider: "routincodex", model: "gpt-5.4-mini" },
          thresholdRatio: 0.35,
        },
        catalog: [{ provider: "routincodex", model: "grok-4.6" }],
      }),
    ).toEqual({
      provider: "routincodex",
      model: "grok-4.6",
      window: 200000,
      summarization: { provider: "routincodex", model: "gpt-5.4-mini" },
      thresholdRatio: 0.35,
      models: [{ provider: "routincodex", model: "grok-4.6" }],
    });
  });

  it("snaps a missing stored window from llm 500000 to 500000", () => {
    expect(
      buildPanelState({
        provider: "routincodex",
        model: "grok-4.6",
        llmContextWindow: 500000,
        fixes: {
          contextWindows: {},
          summarization: null,
          thresholdRatio: 0.4,
        },
        catalog: [],
      }),
    ).toEqual({
      provider: "routincodex",
      model: "grok-4.6",
      window: 500000,
      summarization: null,
      thresholdRatio: 0.4,
      models: [],
    });
  });
});

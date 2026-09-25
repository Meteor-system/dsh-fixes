import { describe, expect, it } from "vitest";
import { buildPanelState } from "../src/panel-state.ts";

describe("buildPanelState", () => {
  it("uses a stored 256000 window over the llm 500000 window", () => {
    expect(
      buildPanelState({
        provider: "routincodex",
        model: "grok-4.6",
        llmContextWindow: 500000,
        fixes: {
          contextWindows: { "routincodex/grok-4.6": 256000 },
          summarization: { provider: "routincodex", model: "gpt-5.4-mini" },
          compactionReserves: {},
          autoCompactEnabled: true,
          sessionOverrides: {},
        },
        catalog: [{ provider: "routincodex", model: "grok-4.6" }],
      }),
    ).toEqual({
      provider: "routincodex",
      model: "grok-4.6",
      window: 256000,
      summarization: { provider: "routincodex", model: "gpt-5.4-mini" },
      models: [{ provider: "routincodex", model: "grok-4.6" }],
    });
  });

  it("snaps a missing stored window from llm 500000 to 512000", () => {
    expect(
      buildPanelState({
        provider: "routincodex",
        model: "grok-4.6",
        llmContextWindow: 500000,
        fixes: {
          contextWindows: {},
          summarization: null,
          compactionReserves: {},
          autoCompactEnabled: true,
          sessionOverrides: {},
        },
        catalog: [],
      }),
    ).toEqual({
      provider: "routincodex",
      model: "grok-4.6",
      window: 512000,
      summarization: null,
      models: [],
    });
  });

  it("snaps an unknown catalog window of 262144 to 256000", () => {
    expect(
      buildPanelState({
        provider: "routincodex",
        model: "kimi",
        llmContextWindow: 262144,
        fixes: {
          contextWindows: {},
          summarization: null,
          compactionReserves: {},
          autoCompactEnabled: true,
          sessionOverrides: {},
        },
        catalog: [],
      }).window,
    ).toBe(256000);
  });

  it("does not expose the removed threshold ratio", () => {
    const state = buildPanelState({
      provider: "routincodex",
      model: "grok-4.6",
      fixes: {
        contextWindows: {},
        summarization: null,
        compactionReserves: {},
        autoCompactEnabled: true,
        sessionOverrides: {},
      },
      catalog: [],
    });
    expect(Object.hasOwn(state, "thresholdRatio")).toBe(false);
  });

  it("selects no window when stored and catalog windows are both missing", () => {
    expect(
      buildPanelState({
        provider: "routincodex",
        model: "grok-4.6",
        fixes: {
          contextWindows: {},
          summarization: null,
          compactionReserves: {},
          autoCompactEnabled: true,
          sessionOverrides: {},
        },
        catalog: [],
      }).window,
    ).toBeUndefined();
  });
});

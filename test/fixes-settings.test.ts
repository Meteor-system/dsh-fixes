import { describe, expect, it } from "vitest";
import {
  clampThresholdRatio,
  modelKey,
  nearestWindowChoice,
  parseFixesSettings,
} from "../src/fixes-settings.ts";

describe("parseFixesSettings", () => {
  it("defaults an empty section", () => {
    expect(parseFixesSettings(undefined)).toEqual({
      contextWindows: {},
      summarization: null,
      thresholdRatio: 0.4,
    });
  });

  it("keeps a stored grok window, summarizer, and slider", () => {
    expect(
      parseFixesSettings({
        contextWindows: { "routincodex/grok-4.6": 500000 },
        summarization: { provider: "routincodex", model: "gpt-5.4-mini" },
        thresholdRatio: 0.35,
      }),
    ).toEqual({
      contextWindows: { "routincodex/grok-4.6": 500000 },
      summarization: { provider: "routincodex", model: "gpt-5.4-mini" },
      thresholdRatio: 0.35,
    });
  });
});

describe("clampThresholdRatio", () => {
  it("clamps and defaults", () => {
    expect(clampThresholdRatio(0.05)).toBe(0.2);
    expect(clampThresholdRatio(1)).toBe(0.9);
    expect(clampThresholdRatio("nope")).toBe(0.4);
  });
});

describe("nearestWindowChoice", () => {
  it("snaps 262144 to 200000", () => {
    expect(nearestWindowChoice(262144)).toBe(200000);
  });
});

describe("modelKey", () => {
  it("joins provider and model", () => {
    expect(modelKey("routincodex", "grok-4.6")).toBe("routincodex/grok-4.6");
  });
});

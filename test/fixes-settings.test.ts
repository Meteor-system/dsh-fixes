import { describe, expect, it } from "vitest";
import {
  modelKey,
  nearestWindowChoice,
  parseFixesSettings,
  patchSessionOverride,
  resolveEffectiveAutoCompact,
  resolveEffectiveWindow,
} from "../src/fixes-settings.ts";

describe("parseFixesSettings", () => {
  it("defaults an empty section", () => {
    expect(parseFixesSettings(undefined)).toEqual({
      contextWindows: {},
      summarization: null,
      compactionReserves: {},
      autoCompactEnabled: true,
      sessionOverrides: {},
      imageInputModels: {},
    });
  });

  it("keeps only boolean image switches keyed by route/model", () => {
    expect(
      parseFixesSettings({
        imageInputModels: { "routin/gpt-5.4": false, "routin/gpt-x": "no", "": true },
      }).imageInputModels,
    ).toEqual({ "routin/gpt-5.4": false });
  });

  it("keeps a stored grok window, summarizer, and route reserve", () => {
    expect(
      parseFixesSettings({
        contextWindows: { "routincodex/grok-4.6": 512000 },
        summarization: { provider: "routincodex", model: "gpt-5.4-mini" },
        thresholdRatio: 0.35,
        compactionReserves: {
          "routincodex/grok-4.6": { summaryOutputTokens: 10_000 },
        },
      }),
    ).toEqual({
      contextWindows: { "routincodex/grok-4.6": 512000 },
      summarization: { provider: "routincodex", model: "gpt-5.4-mini" },
      compactionReserves: {
        "routincodex/grok-4.6": { summaryOutputTokens: 10_000 },
      },
      autoCompactEnabled: true,
      sessionOverrides: {},
      imageInputModels: {},
    });
  });

  it("drops invalid route reserve fields and ignores the legacy ratio", () => {
    expect(
      parseFixesSettings({
        thresholdRatio: 0.2,
        compactionReserves: {
          "provider/model": {
            summaryOutputTokens: -1,
            toolResultTokens: 12_345,
          },
          "provider/empty": { summaryOutputTokens: 1.5 },
        },
      }).compactionReserves,
    ).toEqual({ "provider/model": { toolResultTokens: 12_345 } });
  });

  it("drops former 100k/200k/500k window values", () => {
    expect(
      parseFixesSettings({
        contextWindows: { "routincodex/grok-4.6": 500000 },
        sessionOverrides: { "sess-1": { window: 100000 } },
      }).contextWindows,
    ).toEqual({});
    expect(
      parseFixesSettings({
        sessionOverrides: { "sess-1": { window: 100000 } },
      }).sessionOverrides,
    ).toEqual({});
  });

  it("keeps a global auto-compact off switch and per-session overrides", () => {
    expect(
      parseFixesSettings({
        autoCompactEnabled: false,
        sessionOverrides: {
          "sess-1": { window: 128000, autoCompactEnabled: true },
        },
      }),
    ).toEqual({
      contextWindows: {},
      summarization: null,
      compactionReserves: {},
      autoCompactEnabled: false,
      sessionOverrides: {
        "sess-1": { window: 128000, autoCompactEnabled: true },
      },
      imageInputModels: {},
    });
  });
});

describe("nearestWindowChoice", () => {
  it("snaps catalog windows onto the 128k/256k/392k/512k/1M ladder", () => {
    expect(nearestWindowChoice(262144)).toBe(256000);
    expect(nearestWindowChoice(500000)).toBe(512000);
  });
});

describe("modelKey", () => {
  it("joins provider and model", () => {
    expect(modelKey("routincodex", "grok-4.6")).toBe("routincodex/grok-4.6");
  });
});

describe("resolveEffectiveWindow", () => {
  const base = parseFixesSettings({
    contextWindows: { "routincodex/grok-4.6": 512000 },
    sessionOverrides: { "sess-1": { window: 128000 } },
  });

  it("uses the session override when present", () => {
    expect(resolveEffectiveWindow(base, "sess-1", "routincodex/grok-4.6")).toBe(128000);
  });

  it("falls back to the global model window", () => {
    expect(resolveEffectiveWindow(base, "sess-2", "routincodex/grok-4.6")).toBe(512000);
    expect(resolveEffectiveWindow(base, undefined, "routincodex/grok-4.6")).toBe(512000);
  });
});

describe("resolveEffectiveAutoCompact", () => {
  it("uses the session override when present, otherwise the global switch", () => {
    const offGlobally = parseFixesSettings({
      autoCompactEnabled: false,
      sessionOverrides: { "sess-1": { autoCompactEnabled: true } },
    });
    expect(resolveEffectiveAutoCompact(offGlobally, "sess-1")).toBe(true);
    expect(resolveEffectiveAutoCompact(offGlobally, "sess-2")).toBe(false);
    expect(resolveEffectiveAutoCompact(parseFixesSettings(undefined), undefined)).toBe(true);
  });
});

describe("patchSessionOverride", () => {
  it("sets and clears per-session fields without dropping the other", () => {
    const withWindow = patchSessionOverride({}, "sess-1", { window: 256000 });
    expect(withWindow).toEqual({ "sess-1": { window: 256000 } });
    const both = patchSessionOverride(withWindow, "sess-1", { autoCompactEnabled: false });
    expect(both).toEqual({ "sess-1": { window: 256000, autoCompactEnabled: false } });
    const clearedWindow = patchSessionOverride(both, "sess-1", { window: null });
    expect(clearedWindow).toEqual({ "sess-1": { autoCompactEnabled: false } });
    expect(patchSessionOverride(clearedWindow, "sess-1", { autoCompactEnabled: null })).toEqual({});
  });
});

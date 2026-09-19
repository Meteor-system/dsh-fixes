import { describe, expect, it } from "vitest";
import { modelCapacity, patchContextWindows } from "../src/context-window.ts";

describe("modelCapacity", () => {
  it("returns official grok-4.6 window", () => {
    expect(modelCapacity("grok-4.6")).toEqual({
      contextWindow: 500000,
      maxTokens: 500000,
    });
  });

  it("gives unknown third-party ids a 500k working window", () => {
    expect(modelCapacity("union-alpha")).toEqual({
      contextWindow: 500000,
      maxTokens: 500000,
    });
  });
});

describe("patchContextWindows", () => {
  it("fills grok-4.6 contextWindow when the gateway omitted it", () => {
    const { providers, patched } = patchContextWindows({
      routincodex: {
        defaultContextWindow: 262144,
        models: [{ id: "grok-4.6", input: ["text", "image"] }],
      },
    });

    expect(patched).toBeGreaterThanOrEqual(1);
    expect(providers.routincodex.models[0].contextWindow).toBe(500000);
    expect(providers.routincodex.models[0].maxTokens).toBe(500000);
  });

  it("does not shrink an already-declared window", () => {
    const source = {
      moonshotai: {
        models: [{ id: "kimi-k2-0711-preview", contextWindow: 131072, maxTokens: 16384 }],
      },
    };
    const { providers, patched } = patchContextWindows(source);
    expect(patched).toBe(0);
    expect(providers).toBe(source);
  });

  it("raises the 262144/131072 sentinel default to 500k for every provider", () => {
    const { providers } = patchContextWindows({
      routin: {
        defaultContextWindow: 131072,
        models: [{ id: "mimo-v2.5-pro" }],
      },
    });
    expect(providers.routin.defaultContextWindow).toBe(500000);
    expect(providers.routin.models[0].contextWindow).toBe(500000);
  });
});

import { describe, expect, it } from "vitest";
import { isImageAllowed, modelCapacity } from "../src/model-capabilities.ts";

describe("modelCapacity", () => {
  it("uses the exact table for the grok models that have known limits", () => {
    expect(modelCapacity("grok-4.3")).toEqual({ contextWindow: 1_000_000, maxTokens: 30_000 });
    expect(modelCapacity("grok-4.5")).toEqual({ contextWindow: 500_000, maxTokens: 500_000 });
  });

  it("falls back to the 500k working window for other grok-4 models and unknown ids", () => {
    expect(modelCapacity("grok-4.9")).toEqual({ contextWindow: 500_000, maxTokens: 500_000 });
    expect(modelCapacity("gpt-5.4")).toEqual({ contextWindow: 500_000, maxTokens: 500_000 });
  });

  it("returns nothing for an empty id", () => {
    expect(modelCapacity("   ")).toBeUndefined();
  });
});

describe("isImageAllowed", () => {
  it("allows image only when the route/model is recorded as on", () => {
    expect(isImageAllowed({ "routin/gpt-5.4": true }, "routin", "gpt-5.4")).toBe(true);
    expect(isImageAllowed({ "routin/gpt-5.4": false }, "routin", "gpt-5.4")).toBe(false);
    expect(isImageAllowed({}, "routin", "gpt-5.4")).toBe(false);
  });

  it("does not let a record for one route allow the same model id on another", () => {
    expect(isImageAllowed({ "other/gpt-5.4": true }, "routin", "gpt-5.4")).toBe(false);
  });
});

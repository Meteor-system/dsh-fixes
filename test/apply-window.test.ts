import { describe, expect, it } from "vitest";
import { applyModelWindow } from "../src/apply-window.ts";

describe("applyModelWindow", () => {
  it("sets grok-4.6 only", () => {
    const { providers, patched } = applyModelWindow(
      {
        routincodex: {
          models: [
            { id: "gpt-5.4-mini", contextWindow: 131072 },
            { id: "grok-4.6", contextWindow: 500000 },
          ],
        },
      },
      "routincodex",
      "grok-4.6",
      200000,
    );
    expect(patched).toBe(true);
    expect(providers.routincodex.models[0].contextWindow).toBe(131072);
    expect(providers.routincodex.models[1].contextWindow).toBe(200000);
  });

  it("is a no-op for an unknown model", () => {
    const source = { routin: { models: [{ id: "mimo-v2.5-pro" }] } };
    const { providers, patched } = applyModelWindow(source, "routincodex", "grok-4.6", 500000);
    expect(patched).toBe(false);
    expect(providers).toBe(source);
  });
});

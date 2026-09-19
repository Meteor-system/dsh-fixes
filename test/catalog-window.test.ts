import { describe, expect, it } from "vitest";
import { readCatalogContextWindow } from "../src/catalog-window.ts";

describe("readCatalogContextWindow", () => {
  it("reads models then lets modelOverrides win", () => {
    const section = {
      providers: {
        routincodex: {
          models: [
            { id: "grok-4.6", contextWindow: 500000 },
            { id: "kimi", contextWindow: 131072 },
          ],
          modelOverrides: {
            "grok-4.6": { contextWindow: 200000 },
          },
        },
      },
    };
    expect(readCatalogContextWindow(section, "routincodex", "grok-4.6")).toBe(200000);
    expect(readCatalogContextWindow(section, "routincodex", "kimi")).toBe(131072);
  });

  it("returns undefined when the catalog has no window", () => {
    expect(readCatalogContextWindow({ providers: { routincodex: { models: [{ id: "grok-4.6" }] } } }, "routincodex", "grok-4.6")).toBeUndefined();
    expect(readCatalogContextWindow(undefined, "routincodex", "grok-4.6")).toBeUndefined();
  });
});

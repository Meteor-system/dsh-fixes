import { describe, expect, it } from "vitest";
import { groupCatalogByProvider } from "../src/catalog-groups.ts";

describe("groupCatalogByProvider", () => {
  it("keeps provider order and groups models", () => {
    expect(
      groupCatalogByProvider(
        [
          { provider: "routin", model: "mimo-v2.5-pro", label: "mimo-v2.5-pro" },
          { provider: "routincodex", model: "grok-4.6", label: "grok-4.6" },
          { provider: "routin", model: "union-alpha", label: "union-alpha" },
        ],
        { routin: "routin(国产)", routincodex: "routincodex" },
      ),
    ).toEqual([
      {
        provider: "routin",
        label: "routin(国产)",
        models: [
          { provider: "routin", model: "mimo-v2.5-pro", label: "mimo-v2.5-pro" },
          { provider: "routin", model: "union-alpha", label: "union-alpha" },
        ],
      },
      {
        provider: "routincodex",
        label: "routincodex",
        models: [{ provider: "routincodex", model: "grok-4.6", label: "grok-4.6" }],
      },
    ]);
  });
});

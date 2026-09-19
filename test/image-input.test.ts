import { describe, expect, it } from "vitest";
import { patchProviders } from "../src/image-input.ts";

describe("patchProviders", () => {
  it("fills image input for grok-4.6 when the gateway left the list empty", () => {
    const { providers, patched } = patchProviders({
      routincodex: {
        defaultInput: ["text"],
        models: [
          {
            id: "grok-4.6",
            input: [],
          },
        ],
      },
    });

    expect(patched).toBeGreaterThanOrEqual(1);
    expect(providers.routincodex.models[0].input).toEqual(["text", "image"]);
  });

  it("fills image for every model on a third-party gateway, not only grok-4", () => {
    const { providers, patched } = patchProviders({
      routin: {
        defaultInput: ["text"],
        models: [
          { id: "gpt-5.4", input: [] },
          { id: "union-alpha", input: [] },
          { id: "kimi-k2-0711-preview", input: ["text"] },
        ],
      },
    });

    expect(patched).toBeGreaterThanOrEqual(3);
    expect(providers.routin.models.map((model: { input: string[] }) => model.input)).toEqual([
      ["text", "image"],
      ["text", "image"],
      ["text", "image"],
    ]);
  });

  it("lifts provider defaultInput so later unnamed models inherit image", () => {
    const { providers } = patchProviders({
      routinclaude: {
        defaultInput: ["text"],
        models: [],
      },
    });

    expect(providers.routinclaude.defaultInput).toEqual(["text", "image"]);
  });

  it("patches every third-party provider in one pass", () => {
    const { providers, patched } = patchProviders({
      routin: {
        models: [{ id: "mimo-v2.5-pro", input: [] }],
      },
      "moonshotai-cn": {
        models: [{ id: "kimi-k2-0905-preview", input: [] }],
      },
    });

    expect(patched).toBeGreaterThanOrEqual(2);
    expect(providers.routin.models[0].input).toEqual(["text", "image"]);
    expect(providers["moonshotai-cn"].models[0].input).toEqual(["text", "image"]);
  });

  it("is a no-op when grok-4.6 already declares image", () => {
    const source = {
      routincodex: {
        defaultInput: ["text", "image"],
        models: [
          {
            id: "grok-4.6",
            input: ["text", "image"],
          },
        ],
      },
    };

    const { providers, patched } = patchProviders(source);
    expect(patched).toBe(0);
    expect(providers).toBe(source);
  });

  it("adds image when grok-4.6 only declared text", () => {
    const { providers, patched } = patchProviders({
      routincodex: {
        models: [{ id: "grok-4.6", input: ["text"] }],
      },
    });

    expect(patched).toBeGreaterThanOrEqual(1);
    expect(providers.routincodex.models[0].input).toEqual(["text", "image"]);
  });

  it("fills image on a grok-4.6 modelOverrides entry", () => {
    const { providers, patched } = patchProviders({
      routincodex: {
        modelOverrides: {
          "grok-4.6": { input: [] },
        },
      },
    });

    expect(patched).toBeGreaterThanOrEqual(1);
    expect(providers.routincodex.modelOverrides["grok-4.6"].input).toEqual([
      "text",
      "image",
    ]);
  });
});

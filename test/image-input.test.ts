import { describe, expect, it } from "vitest";
import { patchProviders } from "../src/image-input.ts";

describe("patchProviders: image input is off unless recorded as on", () => {
  it("keeps a listed model text-only when nothing is recorded", () => {
    const { providers, patched } = patchProviders({
      routincodex: {
        defaultInput: ["text"],
        models: [{ id: "grok-4.6", input: [] }],
      },
    });

    expect(patched).toBe(1);
    expect(providers.routincodex.models[0].input).toEqual(["text"]);
  });

  it("strips the image the earlier always-on default left on the model and the provider", () => {
    const { providers } = patchProviders({
      routincodex: {
        defaultInput: ["text", "image"],
        models: [{ id: "grok-4.6", input: ["text", "image"] }],
      },
    });

    expect(providers.routincodex.defaultInput).toEqual(["text"]);
    expect(providers.routincodex.models[0].input).toEqual(["text"]);
  });

  it("adds image to a listed model recorded as on, and leaves the provider default alone", () => {
    const { providers, patched } = patchProviders(
      {
        routincodex: {
          defaultInput: ["text"],
          models: [{ id: "grok-4.6", input: [] }],
        },
      },
      { "routincodex/grok-4.6": true },
    );

    expect(patched).toBeGreaterThanOrEqual(1);
    expect(providers.routincodex.models[0].input).toEqual(["text", "image"]);
    expect(providers.routincodex.defaultInput).toEqual(["text"]);
  });

  it("is a no-op for a model recorded as on that already declares image", () => {
    const source = {
      routincodex: {
        defaultInput: ["text"],
        models: [{ id: "grok-4.6", input: ["text", "image"] }],
      },
    };

    const { providers, patched } = patchProviders(source, { "routincodex/grok-4.6": true });
    expect(patched).toBe(0);
    expect(providers).toBe(source);
  });

  it("writes image onto an on model that the provider does not list", () => {
    const { providers, patched } = patchProviders(
      {
        routin: {
          defaultInput: ["text"],
          models: [],
        },
      },
      { "routin/gpt-x": true },
    );

    expect(patched).toBeGreaterThanOrEqual(1);
    expect(providers.routin.modelOverrides["gpt-x"].input).toEqual(["text", "image"]);
  });

  it("removes image from a listed model recorded as off", () => {
    const { providers } = patchProviders(
      {
        routin: {
          defaultInput: ["text"],
          models: [{ id: "gpt-5.4", input: ["text", "image"] }],
        },
      },
      { "routin/gpt-5.4": false },
    );

    expect(providers.routin.models[0].input).toEqual(["text"]);
  });

  it("writes nothing for an unlisted model with no record", () => {
    const source = {
      routin: {
        defaultInput: ["text"],
        models: [],
      },
    };

    const { providers, patched } = patchProviders(source, {});
    expect(patched).toBe(0);
    expect(providers).toBe(source);
  });

  it("does not affect another route that shares the model id", () => {
    const { providers } = patchProviders(
      {
        routincodex: {
          defaultInput: ["text"],
          models: [{ id: "grok-4.6", input: [] }],
        },
        other: {
          defaultInput: ["text"],
          models: [{ id: "grok-4.6", input: [] }],
        },
      },
      { "other/grok-4.6": true },
    );

    expect(providers.routincodex.models[0].input).toEqual(["text"]);
    expect(providers.other.models[0].input).toEqual(["text", "image"]);
  });

  it("settles after one pass: a second run with the same switches changes nothing", () => {
    const flags = { "routin/gpt-5.4": true, "routin/gpt-x": true };
    const first = patchProviders(
      {
        routin: {
          defaultInput: ["text"],
          models: [{ id: "gpt-5.4", input: [] }],
        },
      },
      flags,
    );
    const second = patchProviders(first.providers, flags);
    expect(second.patched).toBe(0);
    expect(second.providers).toBe(first.providers);
  });
});

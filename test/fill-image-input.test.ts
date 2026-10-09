import { describe, expect, it } from "vitest";
import { fillImageInput } from "../src/index.ts";

describe("fillImageInput", () => {
  it("writes text-only onto grok-4.6 when nothing is recorded", async () => {
    const section = {
      providers: {
        routincodex: {
          defaultInput: ["text"],
          models: [{ id: "grok-4.6", input: [] }],
        },
      },
    };
    const writes: unknown[] = [];
    const patched = await fillImageInput({
      writable: true,
      get: () => section,
      update: async (_namespace, value) => {
        writes.push(value);
      },
    });

    expect(patched).toBeGreaterThan(0);
    expect(writes).toEqual([
      {
        providers: {
          routincodex: {
            defaultInput: ["text"],
            models: [
              {
                id: "grok-4.6",
                input: ["text"],
                contextWindow: 500000,
                maxTokens: 500000,
              },
            ],
          },
        },
      },
    ]);
  });

  it("does not write when settings are read-only", async () => {
    const patched = await fillImageInput({
      writable: false,
      get: () => {
        throw new Error("should not read");
      },
      update: async () => {
        throw new Error("should not write");
      },
    });
    expect(patched).toBe(0);
  });

  it("reads via describe when get is missing (dsh 0.1.7)", async () => {
    const section = {
      providers: {
        routincodex: {
          defaultInput: ["text"],
          models: [{ id: "grok-4.6", input: [] }],
        },
      },
    };
    const writes: unknown[] = [];
    const patched = await fillImageInput({
      writable: true,
      describe: () => [{ ns: "llm-pi-ai", value: section }],
      update: async (_namespace, value) => {
        writes.push(value);
      },
    });
    expect(patched).toBeGreaterThan(0);
    expect(writes).toHaveLength(1);
  });

  it("writes image onto a model the user recorded as on", async () => {
    const section = {
      providers: {
        routincodex: {
          defaultInput: ["text"],
          models: [{ id: "grok-4.6", input: [] }],
        },
      },
    };
    const writes: unknown[] = [];
    await fillImageInput(
      {
        writable: true,
        get: () => section,
        update: async (_namespace, value) => {
          writes.push(value);
        },
      },
      { "routincodex/grok-4.6": true },
    );

    const written = writes[0] as { providers: { routincodex: { models: Array<{ input: string[] }> } } };
    expect(written.providers.routincodex.models[0]?.input).toEqual(["text", "image"]);
  });

  it("applies the per-model image switch from fixes settings", async () => {
    const section = {
      providers: {
        routin: {
          defaultInput: ["text"],
          models: [{ id: "gpt-5.4", input: ["text", "image"] }],
        },
      },
    };
    const writes: unknown[] = [];
    await fillImageInput(
      {
        writable: true,
        get: () => section,
        update: async (_namespace, value) => {
          writes.push(value);
        },
      },
      { "routin/gpt-5.4": false },
    );

    expect(writes).toHaveLength(1);
    const written = writes[0] as { providers: { routin: { models: Array<{ input: string[] }> } } };
    expect(written.providers.routin.models[0]?.input).toEqual(["text"]);
  });

  it("one stale switch on a models-list route does not block other routes' image patches", async () => {
    const section = {
      providers: {
        routincodex: {
          defaultInput: ["text"],
          models: [{ id: "grok-4.6", input: ["text"] }],
        },
        routin: {
          defaultInput: ["text"],
          models: [{ id: "gpt-5.4", input: [] }],
        },
      },
    };
    const writes: unknown[] = [];
    await fillImageInput(
      {
        writable: true,
        get: () => section,
        update: async (_namespace, value) => {
          writes.push(value);
        },
      },
      { "routincodex/removed-model": true, "routin/gpt-5.4": true },
    );

    expect(writes).toHaveLength(1);
    const written = writes[0] as {
      providers: {
        routincodex: Record<string, unknown>;
        routin: { models: Array<{ input: string[] }> };
      };
    };
    expect(written.providers.routincodex).not.toHaveProperty("modelOverrides");
    expect(written.providers.routin.models[0]?.input).toEqual(["text", "image"]);
  });
});

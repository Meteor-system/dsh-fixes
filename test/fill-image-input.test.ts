import { describe, expect, it } from "vitest";
import { fillImageInput } from "../src/index.ts";

describe("fillImageInput", () => {
  it("writes text+image onto grok-4.6 and the provider defaultInput", async () => {
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

    expect(patched).toBe(3);
    expect(writes).toEqual([
      {
        providers: {
          routincodex: {
            defaultInput: ["text", "image"],
            models: [
              {
                id: "grok-4.6",
                input: ["text", "image"],
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
});

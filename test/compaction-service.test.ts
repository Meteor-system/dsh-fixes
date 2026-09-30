import { describe, expect, it } from "vitest";
import { compactCurrentSession } from "../src/index.ts";

describe("compaction service lookup", () => {
  it("resolves the preset-scoped compaction service through agentPresets", async () => {
    const calls: unknown[][] = [];
    const compaction = {
      compactNow: async (...args: unknown[]) => {
        calls.push(args);
        return null;
      },
    };
    const context = {
      settings: {},
      timeout: () => undefined,
      on: () => undefined,
      effect: () => undefined,
      get(name: string) {
        if (name === "agentPresets") {
          return { serviceFor: (_agent: unknown, service: string) => service === "compaction" ? compaction : undefined };
        }
        return undefined;
      },
    };

    const result = await compactCurrentSession(
      { options: {}, session: {} },
      undefined,
      context,
    );

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
  });
});

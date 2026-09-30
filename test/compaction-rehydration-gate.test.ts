import { describe, expect, it } from "vitest";
import { createCompactionRehydrationGate } from "../src/compaction-rehydration-gate.ts";

describe("createCompactionRehydrationGate", () => {
  it("claims one rehydration per committed compaction", () => {
    const gate = createCompactionRehydrationGate();
    const agent = {};

    expect(gate.claim(agent, "compact-1")).toBe(true);
    expect(gate.claim(agent, "compact-1")).toBe(false);
    expect(gate.claim(agent, "compact-2")).toBe(true);
  });

  it("allows a failed rehydration to be retried", () => {
    const gate = createCompactionRehydrationGate();
    const agent = {};

    expect(gate.claim(agent, "compact-1")).toBe(true);
    gate.release(agent, "compact-1");
    expect(gate.claim(agent, "compact-1")).toBe(true);
  });
});

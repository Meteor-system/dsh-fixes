import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, it, vi } from "vitest";
import { installSettingsWatcher } from "../src/index.ts";

type Listener = (...args: unknown[]) => unknown;

// Stands in for HMR's `executing` store: Loader commits run inside it, and a config write made
// inside it is rejected with "HMR transactions cannot be nested".
const hmrExecuting = new AsyncLocalStorage<boolean>();

function fakeContext(sections: Record<string, unknown>) {
  const listeners = new Map<string, Listener[]>();
  const writes: Array<{ namespace: string; value: unknown }> = [];
  const outcomes: string[] = [];
  const settings = {
    writable: true,
    get: (namespace: string) => sections[namespace],
    update: async (namespace: string, value: unknown) => {
      if (hmrExecuting.getStore() === true) {
        outcomes.push("nested");
        throw new Error("HMR transactions cannot be nested");
      }
      outcomes.push("ok");
      writes.push({ namespace, value });
    },
  };
  const ctx = {
    settings,
    timeout: () => undefined,
    effect: (callback: () => () => void) => {
      callback();
      return undefined;
    },
    on: (event: string, listener: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return undefined;
    },
  };
  const emitInsideHmr = (event: string, ...args: unknown[]) => {
    hmrExecuting.run(true, () => {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    });
  };
  return { ctx, writes, outcomes, emitInsideHmr };
}

const llmSection = {
  providers: {
    routin: {
      defaultInput: ["text"],
      models: [{ id: "gpt-5.4", input: ["text"] }],
    },
  },
};

describe("image-input settings watcher", () => {
  it("re-applies the image switch when a volatile fixes value changes", async () => {
    const { ctx, writes, outcomes, emitInsideHmr } = fakeContext({
      "llm-pi-ai": llmSection,
      "dsh-fixes": { imageInputModels: { "routin/gpt-5.4": true } },
    });
    installSettingsWatcher(ctx as never);

    emitInsideHmr("loader/volatile-update", ["imageInputModels"]);

    await vi.waitFor(() => expect(writes).toHaveLength(1));
    const written = writes[0]?.value as { providers: { routin: { models: Array<{ input: string[] }> } } };
    expect(writes[0]?.namespace).toBe("llm-pi-ai");
    expect(written.providers.routin.models[0]?.input).toEqual(["text", "image"]);
    expect(outcomes).toEqual(["ok"]);
  });

  it("writes the image switch from a settings update that fires inside HMR", async () => {
    const { ctx, writes, outcomes, emitInsideHmr } = fakeContext({
      "llm-pi-ai": llmSection,
      "dsh-fixes": { imageInputModels: { "routin/gpt-5.4": true } },
    });
    installSettingsWatcher(ctx as never);

    emitInsideHmr(
      "settings/updated",
      "dsh-fixes",
      { imageInputModels: { "routin/gpt-5.4": true } },
      { imageInputModels: {} },
    );

    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(outcomes).toEqual(["ok"]);
  });
});

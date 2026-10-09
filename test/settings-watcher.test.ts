import { describe, expect, it, vi } from "vitest";
import { installSettingsWatcher } from "../src/index.ts";

type Listener = (...args: unknown[]) => unknown;

function fakeContext(sections: Record<string, unknown>) {
  const listeners = new Map<string, Listener[]>();
  const writes: Array<{ namespace: string; value: unknown }> = [];
  const settings = {
    writable: true,
    get: (namespace: string) => sections[namespace],
    update: async (namespace: string, value: unknown) => {
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
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) listener(...args);
  };
  return { ctx, writes, emit, listeners };
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
    const { ctx, writes, emit } = fakeContext({
      "llm-pi-ai": llmSection,
      "dsh-fixes": { imageInputModels: { "routin/gpt-5.4": true } },
    });
    installSettingsWatcher(ctx as never);

    emit("loader/volatile-update", ["imageInputModels"]);

    await vi.waitFor(() => expect(writes).toHaveLength(1));
    const written = writes[0]?.value as { providers: { routin: { models: Array<{ input: string[] }> } } };
    expect(writes[0]?.namespace).toBe("llm-pi-ai");
    expect(written.providers.routin.models[0]?.input).toEqual(["text", "image"]);
  });
});

import { Context, getTraceable, Service } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";
import { apply } from "../src/index.ts";

type PluginContext = Parameters<typeof apply>[0];
type Listener = (...args: unknown[]) => unknown;
type SessionEvent = { type: string; data: unknown; options?: unknown };
type Command = {
  name: string;
  handler(invocation: {
    agent: { session: unknown };
    signal: AbortSignal;
    rawInput: string;
  }): Promise<{ kind: string; text?: string }>;
};

class TestService extends Service {
  constructor(ctx: Context, name: string) {
    super(ctx, name);
  }
}

function createHarness() {
  const appended: SessionEvent[] = [];
  const session = {
    seq: 17,
    surface: { replaceGeneration: 0 },
    deriveMessages: () => [{
      source: { kind: "skill-invocation", name: "context" },
      content: "Keep this durable context.",
    }],
    append(type: string, data: unknown, options?: unknown) {
      appended.push({ type, data, options });
      this.seq += 1;
    },
  };
  const agent = { session, options: {}, status: "idle" };
  const signal = new AbortController().signal;
  const cordis = new Context();
  let commits = 0;
  const compaction = Object.assign(new TestService(cordis, "compaction"), {
    async compactNow(owner: typeof agent, _signal: AbortSignal) {
      commits += 1;
      owner.session.surface.replaceGeneration += 1;
      return { compactionId: `committed-${commits}` };
    },
    async compactIfNeeded(_owner: typeof agent, _trigger: string, _signal: AbortSignal) {
      return null;
    },
  });

  // Installed dsh-agent-preset-registry serviceForAgent() returns impl.value.
  // Cordis createShadowMethod() traces that return value: each call produces a
  // fresh write-through service proxy, and each method read a fresh proxy too.
  // Use Cordis itself rather than a plain Proxy that misses method tracing.
  let serviceLookups = 0;
  const presets = Object.assign(new TestService(cordis, "agentPresets"), {
    serviceFor(_owner: unknown, name: string) {
      serviceLookups += 1;
      return name === "compaction" ? compaction : undefined;
    },
  });
  const registry = getTraceable(cordis, presets);
  const listeners = new Map<string, Listener[]>();
  const effects: Array<() => void> = [];
  const commands = new Map<string, Command>();
  const context: PluginContext = {
    settings: { update: async () => undefined },
    timeout: () => () => undefined,
    on(event, listener) {
      const registered = listeners.get(event) ?? [];
      registered.push(listener);
      listeners.set(event, registered);
      return () => {
        const index = registered.indexOf(listener);
        if (index >= 0) registered.splice(index, 1);
      };
    },
    effect(factory) {
      const disposer = factory();
      effects.push(disposer);
      return disposer;
    },
    get(name) {
      if (name === "agentPresets") return registry;
      if (name === "commands") {
        return {
          register(definition: Command) {
            commands.set(definition.name, definition);
            return () => commands.delete(definition.name);
          },
        };
      }
      return undefined;
    },
  };

  return {
    agent,
    appended,
    commands,
    context,
    registry,
    signal,
    get commits() { return commits; },
    get serviceLookups() { return serviceLookups; },
    get listenerCount() {
      return [...listeners.values()].reduce((total, entries) => total + entries.length, 0);
    },
    async preStep() {
      let delegated = false;
      for (const listener of [...(listeners.get("agent/pre-step") ?? [])]) {
        await listener({ agent, signal }, () => { delegated = true; });
      }
      expect(delegated).toBe(true);
    },
    async manualCompact() {
      const command = commands.get("context-compact");
      expect(command).toBeDefined();
      return command!.handler({ agent, signal, rawInput: "/context-compact" });
    },
    dispose() {
      for (const dispose of effects.splice(0).reverse()) dispose();
    },
  };
}

describe("compaction lifecycle through apply hooks and commands", () => {
  it("appends one rehydration snapshot for one commit after repeated pre-steps", async () => {
    const harness = createHarness();
    const first = harness.registry.serviceFor(harness.agent, "compaction")!;
    const second = harness.registry.serviceFor(harness.agent, "compaction")!;
    expect(first).not.toBe(second);
    expect(first.compactNow).not.toBe(first.compactNow);
    expect(harness.serviceLookups).toBe(2);

    apply(harness.context);
    try {
      // Pre-steps resolve the service even without a token meter or pressure.
      // Before caching these resolutions stacked wrappers on one service.
      for (let step = 0; step < 8; step += 1) await harness.preStep();
      expect(harness.serviceLookups).toBe(3);
      expect(harness.appended).toEqual([]);
      expect(await harness.manualCompact()).toEqual({ kind: "success" });

      expect(harness.commits).toBe(1);
      expect(harness.agent.session.surface.replaceGeneration).toBe(1);
      expect(harness.appended).toEqual([{
        type: "user/message",
        data: {
          id: "dsh-fixes-rehydration-17",
          role: "user",
          content: [{
            type: "text",
            text: "## Rehydration snapshot\n\n### skill:context\nKeep this durable context.",
          }],
          source: {
            kind: "plugin:dsh-fixes",
            form: "snapshot",
            sections: [{ name: "skill:context", text: "Keep this durable context." }],
          },
        },
        options: { surfaceOp: "append" },
      }]);
    } finally {
      harness.dispose();
    }
  });

  it("stops rehydrating after the plugin's effects are disposed", async () => {
    const harness = createHarness();
    apply(harness.context);
    try {
      await harness.preStep();
      expect(await harness.manualCompact()).toEqual({ kind: "success" });
      expect(harness.appended).toHaveLength(1);
    } finally {
      harness.dispose();
    }
    expect(harness.commands.size).toBe(0);
    expect(harness.listenerCount).toBe(0);

    // The core service remains usable by its owner after dsh-fixes unloads.
    const service = harness.registry.serviceFor(harness.agent, "compaction")!;
    await service.compactNow(harness.agent, harness.signal);
    expect(harness.commits).toBe(2);
    expect(harness.appended).toHaveLength(1);
  });
});
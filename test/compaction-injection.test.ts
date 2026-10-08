import { Context, getTraceable, Service } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";
import { compactCurrentSession } from "../src/index.ts";

type PluginContext = NonNullable<Parameters<typeof compactCurrentSession>[2]>;

class TestService extends Service {
  constructor(ctx: Context, name: string) { super(ctx, name); }
}

describe("compaction wrapper dependency injection", () => {
  it("preserves injected services and caller context for manual and automatic calls", async () => {
    const root = new Context();
    const disposers: Array<() => unknown> = [];
    const agent = { session: { surface: { replaceGeneration: 0 } }, options: {} };
    const signal = new AbortController().signal;
    const observed: Array<{ tokens: number; caller: string }> = [];
    let engine: TestService & {
      compactNow(owner: typeof agent, signal: AbortSignal): Promise<null>;
      compactIfNeeded(owner: typeof agent, trigger: string, signal: AbortSignal): Promise<null>;
    };
    try {
      const meterFiber = await root.plugin({ apply(ctx: Context) {
        ctx.provide("tokenMeter", { measure: () => ({ totalTokens: 42 }) });
      } });
      disposers.push(() => meterFiber.dispose());
      const engineFiber = await root.plugin({ inject: ["tokenMeter"], apply(ctx: Context) {
        const observe = function (this: TestService, owner: typeof agent): null {
          // Real engines access injected dependencies through this.ctx; the
          // shadow context must also retain the initiating caller's metadata.
          const runtime = (this as unknown as { ctx: Context & {
            tokenMeter: { measure(session: unknown): { totalTokens: number } };
            requestOwner: string;
          } }).ctx;
          observed.push({ tokens: runtime.tokenMeter.measure(owner.session).totalTokens, caller: runtime.requestOwner });
          return null;
        };
        engine = Object.assign(new TestService(ctx, "compaction"), {
          async compactNow(owner: typeof agent, _signal: AbortSignal) { return observe.call(this, owner); },
          async compactIfNeeded(owner: typeof agent, _trigger: string, _signal: AbortSignal) { return observe.call(this, owner); },
        });
      } });
      disposers.push(() => engineFiber.dispose());
      const presetFiber = await root.plugin({ apply(ctx: Context) {
        Object.assign(new TestService(ctx, "agentPresets"), { serviceFor() { return engine; } });
      } });
      disposers.push(() => presetFiber.dispose());
      let caller!: Context;
      const callerFiber = await root.plugin({ inject: ["agentPresets"], apply(ctx: Context) {
        caller = ctx.extend({ requestOwner: "host-command" });
      } });
      disposers.push(() => callerFiber.dispose());

      // This is an active plugin context with no tokenMeter injection, even
      // though the engine is correctly injected and a normal traced call works.
      expect(() => Reflect.get(caller, "tokenMeter")).toThrow('cannot get property "tokenMeter" without inject');
      const commandService = getTraceable(caller, engine!);
      await expect(commandService.compactNow(agent, signal)).resolves.toBeNull();
      observed.length = 0;

      const result = await compactCurrentSession(agent, signal, caller as unknown as PluginContext);
      expect(result).toEqual({ ok: true });
      await expect(commandService.compactIfNeeded(agent, "context-overflow", signal)).resolves.toBeNull();
      expect(observed).toEqual([
        { tokens: 42, caller: "host-command" },
        { tokens: 42, caller: "host-command" },
      ]);
    } finally {
      for (const dispose of disposers.reverse()) await dispose();
    }
  });
});

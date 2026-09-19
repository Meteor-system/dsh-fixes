import { applyModelWindow } from "./apply-window.js";
import { shouldAutoCompact } from "./compaction-policy.js";
import { shrinkCompactionOptions } from "./compaction-shrink.js";
import { patchContextWindows } from "./context-window.js";
import { DUCKDUCKGO_PROVIDER_ID, searchFreeWeb } from "./duckduckgo.js";
import {
  FIXES_NAMESPACE,
  parseFixesSettings,
  type FixesSettings,
} from "./fixes-settings.js";
import { patchProviders } from "./image-input.js";

const SETTINGS_NAMESPACE = "llm-pi-ai";
const LOG_PREFIX = "[dsh-fixes]";

export const name = "dsh-fixes";
export const inject = ["settings", "timer"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function log(...args: unknown[]): void {
  console.log(LOG_PREFIX, ...args);
}

type SettingsLike = {
  writable?: boolean;
  get(namespace: string): unknown;
  update(namespace: string, value: unknown): Promise<unknown>;
  register?(namespace: string, schema: unknown, options?: unknown): unknown;
};

export async function fillImageInput(settings: SettingsLike): Promise<number> {
  if (settings.writable !== true) return 0;
  let section: unknown;
  try {
    section = settings.get(SETTINGS_NAMESPACE);
  } catch (error) {
    log("read settings error:", error instanceof Error ? error.message : String(error));
    return 0;
  }
  if (!isRecord(section)) return 0;
  const image = patchProviders(section.providers);
  const windows = patchContextWindows(image.providers);
  const patched = image.patched + windows.patched;
  if (patched === 0) return 0;
  await settings.update(SETTINGS_NAMESPACE, { providers: windows.providers });
  log("patched", patched, "llm-pi-ai entries (image input / context windows)");
  return patched;
}

export function readFixes(settings: SettingsLike): FixesSettings {
  try {
    return parseFixesSettings(settings.get(FIXES_NAMESPACE));
  } catch (error) {
    log("read dsh-fixes error:", error instanceof Error ? error.message : String(error));
    return parseFixesSettings(undefined);
  }
}

export async function writeFixes(settings: SettingsLike, next: FixesSettings): Promise<void> {
  await settings.update(FIXES_NAMESPACE, next);
}

function splitModelKey(key: string): { provider: string; model: string } | undefined {
  const index = key.indexOf("/");
  if (index <= 0 || index === key.length - 1) return undefined;
  return { provider: key.slice(0, index), model: key.slice(index + 1) };
}

function changedWindows(
  prev: FixesSettings["contextWindows"],
  next: FixesSettings["contextWindows"],
): FixesSettings["contextWindows"] {
  const changed: FixesSettings["contextWindows"] = {};
  for (const [key, tokens] of Object.entries(next)) {
    if (prev[key] !== tokens) changed[key] = tokens;
  }
  return changed;
}

async function mirrorContextWindows(
  settings: SettingsLike,
  windows: FixesSettings["contextWindows"],
): Promise<void> {
  if (settings.writable !== true) return;
  const keys = Object.keys(windows);
  if (keys.length === 0) return;
  let section: unknown;
  try {
    section = settings.get(SETTINGS_NAMESPACE);
  } catch (error) {
    log("read llm-pi-ai error:", error instanceof Error ? error.message : String(error));
    return;
  }
  if (!isRecord(section)) return;
  let providers = section.providers;
  let dirty = false;
  for (const [key, tokens] of Object.entries(windows)) {
    const parsed = splitModelKey(key);
    if (parsed === undefined) continue;
    const result = applyModelWindow(providers, parsed.provider, parsed.model, tokens);
    if (result.patched) {
      providers = result.providers;
      dirty = true;
    }
  }
  if (!dirty) return;
  await settings.update(SETTINGS_NAMESPACE, { providers });
  log("mirrored", keys.length, "context window(s) into llm-pi-ai");
}

type WebLike = {
  registerSearchProvider(provider: {
    id: string;
    available(): boolean;
    search(
      request: { query: string; maxResults?: number },
      signal?: AbortSignal,
    ): Promise<{ sources: Array<{ url: string; title?: string; snippet?: string }>; truncated: boolean }>;
  }): () => void;
};

type PluginContext = {
  settings: SettingsLike;
  timeout: (callback: () => void, delay: number) => unknown;
  on: (
    event: string,
    listener: (...args: unknown[]) => unknown,
    options?: { global?: boolean },
  ) => unknown;
  effect: (callback: () => () => void, name?: string) => unknown;
  get(name: string): unknown;
};

function fixesSchema(value: unknown): FixesSettings {
  return parseFixesSettings(value);
}

fixesSchema.toJSON = () => ({
  type: "object",
  properties: {
    contextWindows: { type: "object" },
    summarization: { type: "object" },
    thresholdRatio: { type: "number" },
  },
});

function installFixesNamespace(ctx: PluginContext): void {
  const register = ctx.settings.register;
  if (typeof register !== "function") return;
  try {
    register.call(ctx.settings, FIXES_NAMESPACE, fixesSchema);
  } catch (error) {
    log("settings register error:", error instanceof Error ? error.message : String(error));
  }
}

function installSettingsWatcher(ctx: PluginContext): void {
  const settings = ctx.settings;
  ctx.effect(() => {
    let alive = true;
    let retries = 0;
    const timerDisposers: Array<() => void> = [];
    const schedule = (delay: number) => {
      if (!alive) return;
      const disposer = ctx.timeout(() => {
        if (!alive) return;
        void tryOnce();
      }, delay);
      if (typeof disposer === "function") {
        timerDisposers.push(() => {
          disposer();
        });
      }
    };
    const tryOnce = async () => {
      if (!alive) return;
      try {
        const patched = await fillImageInput(settings);
        await mirrorContextWindows(settings, readFixes(settings).contextWindows);
        if (patched > 0) return;
      } catch (error) {
        if (!alive) return;
        log("fill error:", error instanceof Error ? error.message : String(error));
      }
      if (!alive) return;
      retries += 1;
      if (retries <= 5) schedule(2000);
    };
    schedule(500);
    const listenerDisposer = ctx.on("settings/updated", (...args: unknown[]) => {
      if (!alive) return;
      const namespace = args[0];
      if (namespace === SETTINGS_NAMESPACE) {
        fillImageInput(settings)
          .then(() => mirrorContextWindows(settings, readFixes(settings).contextWindows))
          .catch((error) => {
            if (alive) log("watch fill error:", error instanceof Error ? error.message : String(error));
          });
        return;
      }
      if (namespace !== FIXES_NAMESPACE) return;
      const next = parseFixesSettings(args[1]);
      const prev = parseFixesSettings(args[2]);
      const windows = changedWindows(prev.contextWindows, next.contextWindows);
      mirrorContextWindows(settings, windows).catch((error) => {
        if (alive) log("window mirror error:", error instanceof Error ? error.message : String(error));
      });
    });
    return () => {
      alive = false;
      for (const dispose of timerDisposers.splice(0)) dispose();
      if (typeof listenerDisposer === "function") listenerDisposer();
    };
  }, "dsh-fixes: image-input settings watcher");
}

function installDuckDuckGoSearch(ctx: PluginContext): void {
  const web = ctx.get("web") as WebLike | undefined;
  if (web === undefined) {
    log("web service unavailable; duckduckgo search not registered");
    return;
  }
  ctx.effect(() => {
    const dispose = web.registerSearchProvider({
      id: DUCKDUCKGO_PROVIDER_ID,
      available: () => true,
      search: (request, signal) => searchFreeWeb(request, { fetch: globalThis.fetch, signal }),
    });
    log("registered duckduckgo web search");
    return () => {
      dispose();
    };
  }, "dsh-fixes: duckduckgo search");
}

function installCompactionShrink(ctx: PluginContext): void {
  const llm = ctx.get("llm") as { stream: (options: unknown) => unknown } | undefined;
  if (llm === undefined || typeof llm.stream !== "function") {
    log("llm unavailable; compaction shrink not installed");
    return;
  }
  const runtime = llm;
  ctx.effect(() => {
    const original = runtime.stream.bind(runtime);
    runtime.stream = (options: unknown) =>
      original(
        shrinkCompactionOptions(
          options as { purpose?: string; messages?: unknown },
          undefined,
          readFixes(ctx.settings).summarization,
        ),
      );
    log("wrapping llm.stream for overflow-safe compaction");
    return () => {
      runtime.stream = original;
    };
  }, "dsh-fixes: compaction shrink");
}

type CompactAgent = {
  status?: string;
  options?: { provider?: string; model?: string };
  session?: unknown;
  ctx?: { get(name: string): unknown };
};

type CompactionLike = {
  compactIfNeeded?(agent: unknown, trigger: string, signal: AbortSignal): Promise<unknown>;
  compactNow?(agent: unknown, signal: AbortSignal, sourceCommandId?: unknown): Promise<unknown>;
};

function agentCompaction(agent: CompactAgent): CompactionLike | undefined {
  const get = agent.ctx?.get;
  if (typeof get !== "function") return undefined;
  const compaction = get.call(agent.ctx, "compaction");
  if (!isRecord(compaction)) return undefined;
  return compaction as CompactionLike;
}

function abortSignalOf(value: unknown): AbortSignal | undefined {
  return value instanceof AbortSignal ? value : undefined;
}

function isBusyError(error: unknown): boolean {
  if (isRecord(error) && error.code === "busy") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /busy/i.test(message);
}

type TokenMeterLike = {
  measure(session: unknown): { totalTokens?: number };
};

type LlmInfoLike = {
  resolveModelInfo?(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<{ context?: { contextWindow?: number } }>;
};

async function runAutoCompact(ctx: PluginContext, payload: unknown): Promise<void> {
  if (!isRecord(payload)) return;
  const signal = abortSignalOf(payload.signal);
  if (signal?.aborted) return;
  const agent = payload.agent as CompactAgent | undefined;
  if (!isRecord(agent)) return;

  const compaction = agentCompaction(agent);
  if (compaction?.compactIfNeeded === undefined) {
    if (!runAutoCompact.missingLogged) {
      runAutoCompact.missingLogged = true;
      log("agent compaction unavailable; auto-compact skipped");
    }
    return;
  }

  const meter = ctx.get("tokenMeter") as TokenMeterLike | undefined;
  if (meter === undefined || typeof meter.measure !== "function" || agent.session === undefined) {
    return;
  }
  let estimatedTokens: number;
  try {
    const measurement = meter.measure(agent.session);
    if (typeof measurement?.totalTokens !== "number") return;
    estimatedTokens = measurement.totalTokens;
  } catch {
    return;
  }

  const provider = agent.options?.provider;
  const model = agent.options?.model;
  const llm = ctx.get("llm") as LlmInfoLike | undefined;
  if (provider === undefined || model === undefined || typeof llm?.resolveModelInfo !== "function") {
    return;
  }
  let contextWindow: number;
  try {
    const info = await llm.resolveModelInfo(provider, model, signal);
    const window = info?.context?.contextWindow;
    if (typeof window !== "number") return;
    contextWindow = window;
  } catch {
    return;
  }

  const busy = agent.status !== undefined && agent.status !== "idle" && agent.status !== "running";
  const locked = false;
  if (
    !shouldAutoCompact({
      estimatedTokens,
      contextWindow,
      thresholdRatio: readFixes(ctx.settings).thresholdRatio,
      busy,
      locked,
    })
  ) {
    return;
  }

  try {
    await compaction.compactIfNeeded(agent, "pressure", signal ?? new AbortController().signal);
  } catch (error) {
    if (isBusyError(error)) return;
    log("auto-compact failed:", error instanceof Error ? error.message : String(error));
  }
}

runAutoCompact.missingLogged = false;

function installAutoCompact(ctx: PluginContext): void {
  ctx.effect(() => {
    const disposer = ctx.on(
      "agent/pre-step",
      async (...args: unknown[]) => {
        try {
          await runAutoCompact(ctx, args[0]);
        } catch (error) {
          log("auto-compact error:", error instanceof Error ? error.message : String(error));
        }
        const next = args[1];
        if (typeof next === "function") return next();
      },
      { global: true },
    );
    return () => {
      if (typeof disposer === "function") disposer();
    };
  }, "dsh-fixes: auto-compact");
}

export async function compactCurrentSession(
  agent: CompactAgent,
  signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const compaction = agentCompaction(agent);
  if (compaction?.compactNow === undefined) {
    return { ok: false, error: "compaction unavailable on this agent" };
  }
  try {
    await compaction.compactNow(agent, signal ?? new AbortController().signal);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

type CommandsLike = {
  register(definition: {
    name: string;
    description: string;
    recordInput?: boolean;
    handler: (invocation: {
      agent: CompactAgent;
      signal: AbortSignal;
      commandId?: unknown;
      rawInput: string;
    }) => Promise<{ kind: "success"; text?: string } | { kind: "error"; text: string }>;
  }): () => void;
};

function installContextCommand(ctx: PluginContext): void {
  const commands = ctx.get("commands") as CommandsLike | undefined;
  if (commands === undefined || typeof commands.register !== "function") {
    log("commands unavailable; context-compact not registered (client may send /compact)");
    return;
  }
  ctx.effect(() => {
    const dispose = commands.register({
      name: "context-compact",
      description: "Compact the current session context",
      recordInput: false,
      handler: async (invocation) => {
        const result = await compactCurrentSession(invocation.agent, invocation.signal);
        if (result.ok) return { kind: "success" };
        return { kind: "error", text: result.error };
      },
    });
    log("registered context-compact command");
    return () => {
      dispose();
    };
  }, "dsh-fixes: context-compact");
}

export function apply(ctx: PluginContext): void {
  installFixesNamespace(ctx);
  installSettingsWatcher(ctx);
  installDuckDuckGoSearch(ctx);
  installCompactionShrink(ctx);
  installAutoCompact(ctx);
  installContextCommand(ctx);
}

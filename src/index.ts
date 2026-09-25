import { applyModelWindow } from "./apply-window.js";
import { resolveCompactionBudget } from "./compaction-budget.js";
import { autoCompactTrigger, sessionCompactionLocked, shouldAutoCompact, shouldRunIsolateCompact } from "./compaction-policy.js";
import { sessionIdOf } from "./compact-preview.js";
import {
  applyCompactionRoute,
  retryCompactionStream,
  type CompactionStreamOptions,
} from "./compaction-summarizer.js";
import {
  createCompactionRetryGate,
  sessionAttemptHasVisibleOutput,
  shouldRetryRequestAfterCompaction,
} from "./compaction-request-retry.js";
import {
  MAX_REHYDRATION_FILES,
  MAX_REHYDRATION_TOKENS,
  renderRehydrationMessage,
  selectRecentFileTouches,
  skillBodiesFromSession,
  todoItemsFromProjection,
  type FileTouch,
  type RehydrationItem,
} from "./compaction-rehydration.js";
import { patchContextWindows } from "./context-window.js";
import { DUCKDUCKGO_PROVIDER_ID, searchFreeWeb } from "./duckduckgo.js";
import {
  FIXES_NAMESPACE,
  modelKey,
  parseFixesSettings,
  resolveEffectiveAutoCompact,
  resolveEffectiveWindow,
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
    compactionReserves: { type: "object" },
    autoCompactEnabled: { type: "boolean" },
    sessionOverrides: { type: "object" },
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

function compactionLiveOptions(ctx: PluginContext, options: unknown): unknown {
  if (!isRecord(options)) return options;
  return applyCompactionRoute(
    options as CompactionStreamOptions,
    readFixes(ctx.settings).summarization,
  );
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;
  return typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function";
}

function installCompactionRetry(ctx: PluginContext): void {
  ctx.effect(() => {
    const disposer = ctx.on(
      "llm/stream",
      (...args: unknown[]) => {
        const options = compactionLiveOptions(ctx, args[0]);
        const next = args[1];
        if (typeof next !== "function") return;
        return (next as (rewritten?: unknown) => unknown)(options);
      },
      { global: true },
    );
    return () => {
      if (typeof disposer === "function") disposer();
    };
  }, "dsh-fixes: compaction retry waterfall");

  // Cordis waterfall next() does not replace the instance's closed-over request,
  // so the runtime wrapper is also required for route selection and retry.
  const llm = ctx.get("llm") as { stream: (options: unknown) => unknown } | undefined;
  if (llm === undefined || typeof llm.stream !== "function") {
    log("llm unavailable; compaction retry wrap not installed (waterfall still registered)");
    return;
  }
  const runtime = llm;
  ctx.effect(() => {
    const original = runtime.stream.bind(runtime);
    runtime.stream = (options: unknown) => {
      const routed = compactionLiveOptions(ctx, options);
      if (!isRecord(routed) || routed.purpose !== "compaction") return original(routed);
      return retryCompactionStream(
        (attempt) => {
          const result = original(attempt);
          if (!isAsyncIterable(result)) throw new TypeError("llm.stream did not return an async iterable");
          return result;
        },
        routed as CompactionStreamOptions,
      );
    };
    log("wrapping llm.stream for safe compaction retry");
    return () => {
      runtime.stream = original;
    };
  }, "dsh-fixes: compaction retry");
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

const wrappedCompaction = new WeakMap<object, {
  originalIfNeeded?: (agent: unknown, trigger: string, signal: AbortSignal) => Promise<unknown>;
  originalNow?: (agent: unknown, signal: AbortSignal, sourceCommandId?: unknown) => Promise<unknown>;
}>();
const latestCompactionProgress = new WeakMap<object, {
  committed: boolean;
  noProgress: boolean;
}>();
const fileTouchesByAgent = new WeakMap<object, FileTouch[]>();
let nextFileTouchOrder = 0;

type CompactionProgressSnapshot = {
  generation?: number;
  tokens?: number;
};

function executionAborted(value: unknown): boolean {
  return (typeof AbortSignal !== "undefined" && value instanceof AbortSignal && value.aborted)
    || isRecord(value) && value.aborted === true;
}

function recordFileTouch(exec: unknown, result: unknown): void {
  if (!isRecord(exec) || !isRecord(result) || result.isError !== false || executionAborted(exec.signal)) return;
  if (exec.name !== "read" && exec.name !== "write" && exec.name !== "edit") return;
  if (!isRecord(exec.arguments) || typeof exec.arguments.file_path !== "string" || exec.arguments.file_path.length === 0) return;
  const rootAgent = isRecord(exec.rootAgent) ? exec.rootAgent : isRecord(exec.agent) ? exec.agent : undefined;
  if (rootAgent === undefined) return;
  const touches = fileTouchesByAgent.get(rootAgent) ?? [];
  touches.push({ path: exec.arguments.file_path, order: ++nextFileTouchOrder });
  fileTouchesByAgent.set(rootAgent, touches);
}

function installFileTouchLedger(ctx: PluginContext): void {
  ctx.effect(() => {
    const disposer = ctx.on(
      "tools/result",
      (...args: unknown[]) => recordFileTouch(args[0], args[1]),
      { global: true },
    );
    return () => {
      if (typeof disposer === "function") disposer();
    };
  }, "dsh-fixes: file touch ledger");
}

function compactionSnapshot(ctx: PluginContext, agent: CompactAgent): CompactionProgressSnapshot {
  const session = agent.session;
  const surface = isRecord(session) && isRecord(session.surface) ? session.surface : undefined;
  const generation = typeof surface?.replaceGeneration === "number" ? surface.replaceGeneration : undefined;
  let tokens: number | undefined;
  const meter = ctx.get("tokenMeter") as TokenMeterLike | undefined;
  if (meter !== undefined && typeof meter.measure === "function" && session !== undefined) {
    try {
      const measured = meter.measure(session);
      if (typeof measured?.totalTokens === "number" && Number.isFinite(measured.totalTokens)) tokens = measured.totalTokens;
    } catch {
      tokens = undefined;
    }
  }
  return { generation, tokens };
}

function recordCompactionProgress(
  ctx: PluginContext,
  agent: CompactAgent,
  before: CompactionProgressSnapshot,
  result: unknown,
): { committed: boolean; noProgress: boolean } {
  const after = compactionSnapshot(ctx, agent);
  const generationAdvanced = before.generation !== undefined && after.generation !== undefined
    ? after.generation > before.generation
    : true;
  const committed = result !== null && result !== undefined && generationAdvanced;
  const noProgress = !committed
    || before.tokens !== undefined && after.tokens !== undefined && after.tokens >= before.tokens;
  const progress = { committed, noProgress };
  latestCompactionProgress.set(agent as object, progress);
  return progress;
}

async function postCompaction(
  ctx: PluginContext,
  agent: CompactAgent,
  progress: { committed: boolean; noProgress: boolean },
): Promise<void> {
  if (!progress.committed) return;
  try {
    await rehydrateAfterCompaction(ctx, agent);
  } catch (error) {
    log("post-compaction rehydration failed:", error instanceof Error ? error.message : String(error));
  }
}

function wrapCompactionMethods(ctx: PluginContext, compaction: CompactionLike): (() => void) | undefined {
  if (wrappedCompaction.has(compaction)) return undefined;
  const originalIfNeeded = compaction.compactIfNeeded?.bind(compaction);
  const originalNow = compaction.compactNow?.bind(compaction);
  let wrapperIfNeeded: CompactionLike["compactIfNeeded"];
  let wrapperNow: CompactionLike["compactNow"];
  try {
    if (originalIfNeeded !== undefined) {
      wrapperIfNeeded = async (agent, trigger, signal) => {
        if (!shouldRunIsolateCompact(trigger)) return null;
        const before = compactionSnapshot(ctx, agent as CompactAgent);
        try {
          const result = await originalIfNeeded(agent, trigger, signal);
          const progress = recordCompactionProgress(ctx, agent as CompactAgent, before, result);
          await postCompaction(ctx, agent as CompactAgent, progress);
          return result;
        } catch (error) {
          const progress = recordCompactionProgress(ctx, agent as CompactAgent, before, {});
          await postCompaction(ctx, agent as CompactAgent, progress);
          throw error;
        }
      };
      compaction.compactIfNeeded = wrapperIfNeeded;
    }
    if (originalNow !== undefined) {
      wrapperNow = async (agent, signal, sourceCommandId) => {
        const before = compactionSnapshot(ctx, agent as CompactAgent);
        try {
          const result = await originalNow(agent, signal, sourceCommandId);
          const progress = recordCompactionProgress(ctx, agent as CompactAgent, before, result);
          await postCompaction(ctx, agent as CompactAgent, progress);
          return result;
        } catch (error) {
          const progress = recordCompactionProgress(ctx, agent as CompactAgent, before, {});
          await postCompaction(ctx, agent as CompactAgent, progress);
          throw error;
        }
      };
      compaction.compactNow = wrapperNow;
    }
    wrappedCompaction.set(compaction, { originalIfNeeded, originalNow });
  } catch (error) {
    if (originalIfNeeded !== undefined) compaction.compactIfNeeded = originalIfNeeded;
    if (originalNow !== undefined) compaction.compactNow = originalNow;
    log("could not wrap compaction lifecycle:", error instanceof Error ? error.message : String(error));
    return undefined;
  }
  return () => {
    const current = wrappedCompaction.get(compaction);
    if (current === undefined) return;
    if (wrapperIfNeeded !== undefined && compaction.compactIfNeeded === wrapperIfNeeded) compaction.compactIfNeeded = current.originalIfNeeded;
    if (wrapperNow !== undefined && compaction.compactNow === wrapperNow) compaction.compactNow = current.originalNow;
    wrappedCompaction.delete(compaction);
  };
}

function agentCompaction(ctx: PluginContext | undefined, agent: CompactAgent): CompactionLike | undefined {
  const get = agent.ctx?.get;
  if (typeof get !== "function") return undefined;
  const compaction = get.call(agent.ctx, "compaction");
  if (!isRecord(compaction)) return undefined;
  const service = compaction as CompactionLike;
  if (ctx !== undefined) {
    const dispose = wrapCompactionMethods(ctx, service);
    if (dispose !== undefined) ctx.effect(() => dispose, "dsh-fixes: compaction lifecycle");
  }
  return service;
}

type FsLike = {
  resolve?(path: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<{ displayPath?: string }>;
  stat?(target: unknown, signal?: AbortSignal): Promise<{ type?: string; size?: number } | undefined>;
  readText?(target: unknown, signal?: AbortSignal): Promise<string>;
};

type SessionProjectionLike = {
  stateOf?(session: unknown, key: string): unknown;
};

type SessionStoreLike = {
  flush?(session: unknown): Promise<unknown>;
};

async function rehydrateAfterCompaction(ctx: PluginContext, agent: CompactAgent): Promise<void> {
  const session = agent.session;
  if (!isRecord(session) || typeof session.append !== "function") return;
  const touches = fileTouchesByAgent.get(agent as object) ?? [];
  const items: RehydrationItem[] = [];
  const fs = ctx.get("fs") as FsLike | undefined;
  const header = isRecord(session.header) ? session.header : undefined;
  if (fs?.resolve !== undefined && fs.stat !== undefined && fs.readText !== undefined) {
    for (const path of selectRecentFileTouches(touches).slice(0, MAX_REHYDRATION_FILES)) {
      try {
        const target = await fs.resolve(path, { cwd: typeof header?.cwd === "string" ? header.cwd : undefined });
        const info = await fs.stat(target);
        if (info?.type !== "file" || info.size !== undefined && info.size > MAX_REHYDRATION_TOKENS * 4) continue;
        const text = await fs.readText(target);
        if (typeof text === "string" && text.length > 0) {
          items.push({ kind: "file", name: target.displayPath ?? path, text });
        }
      } catch {
        // One missing or unreadable file must not cancel the snapshot.
      }
    }
  }

  const projections = ctx.get("sessionProjections") as SessionProjectionLike | undefined;
  if (projections?.stateOf !== undefined) {
    try {
      const todo = todoItemsFromProjection(projections.stateOf(session, "todos"));
      if (todo !== undefined) items.push(todo);
    } catch {
      // Projection capability is optional and may disappear with its provider.
    }
  }
  items.push(...skillBodiesFromSession(session));

  let message = renderRehydrationMessage(items, MAX_REHYDRATION_TOKENS);
  const meter = ctx.get("tokenMeter") as TokenMeterLike | undefined;
  if (message !== undefined && typeof meter?.estimateMessage === "function") {
    let remaining = items.slice();
    while (message !== undefined) {
      let estimate: number | undefined;
      try {
        const measured = meter.estimateMessage(message);
        estimate = typeof measured === "number" && Number.isFinite(measured) ? measured : undefined;
      } catch {
        estimate = undefined;
      }
      if (estimate === undefined || estimate <= MAX_REHYDRATION_TOKENS || remaining.length === 0) break;
      remaining = remaining.slice(0, -1);
      message = renderRehydrationMessage(remaining, MAX_REHYDRATION_TOKENS);
    }
  }
  if (!isRecord(message)) return;
  const seq = typeof session.seq === "number" ? session.seq : Date.now();
  const userMessage = { ...message, id: `dsh-fixes-rehydration-${seq}` };
  try {
    session.append("user/message", { message: userMessage }, { surfaceOp: "append" });
  } catch (error) {
    log("could not append rehydration snapshot:", error instanceof Error ? error.message : String(error));
    return;
  }
  const sessions = ctx.get("sessions") as SessionStoreLike | undefined;
  if (typeof sessions?.flush === "function") {
    try {
      await sessions.flush(session);
    } catch (error) {
      log("could not flush rehydration snapshot:", error instanceof Error ? error.message : String(error));
    }
  }
}

function abortSignalOf(value: unknown): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && value instanceof AbortSignal ? value : undefined;
}

function isBusyError(error: unknown): boolean {
  if (isRecord(error) && error.code === "busy") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /busy/i.test(message);
}

type TokenMeterLike = {
  measure(session: unknown): { totalTokens?: number };
  estimateMessage?(message: unknown): number;
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

  const compaction = agentCompaction(ctx, agent);
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
  let catalogWindow: number | undefined;
  try {
    const info = await llm.resolveModelInfo(provider, model, signal);
    const window = info?.context?.contextWindow;
    if (typeof window === "number") catalogWindow = window;
  } catch {
    catalogWindow = undefined;
  }

  const busy = agent.status !== undefined && agent.status !== "idle" && agent.status !== "running";
  const locked = sessionCompactionLocked(agent.session);
  const fixes = readFixes(ctx.settings);
  const sessionId = sessionIdOf(agent.session);
  const routeKey = modelKey(provider, model);
  const contextWindow = resolveEffectiveWindow(fixes, sessionId, routeKey) ?? catalogWindow;
  const budget = typeof contextWindow === "number"
    ? resolveCompactionBudget(contextWindow, fixes.compactionReserves[routeKey])
    : undefined;
  if (budget === undefined) return;
  if (
    !shouldAutoCompact({
      estimatedTokens,
      contextWindow: budget.contextWindow,
      thresholdTokens: budget.thresholdTokens,
      busy,
      locked,
      enabled: resolveEffectiveAutoCompact(fixes, sessionId),
    })
  ) {
    return;
  }

  try {
    await compaction.compactIfNeeded(agent, autoCompactTrigger(), signal ?? new AbortController().signal);
  } catch (error) {
    if (isBusyError(error)) return;
    log("auto-compact failed:", error instanceof Error ? error.message : String(error));
  }
}

runAutoCompact.missingLogged = false;

function installRequestErrorRetry(ctx: PluginContext): void {
  const gate = createCompactionRetryGate();
  ctx.effect(() => {
    const requestDisposer = ctx.on(
      "agent/request-error",
      async (...args: unknown[]) => {
        const payload = args[0];
        const next = args[1];
        const delegate = () => (typeof next === "function" ? (next as () => Promise<unknown>)() : undefined);
        if (!isRecord(payload) || !isRecord(payload.agent) || typeof payload.turn !== "number") return delegate();
        const agent = payload.agent as CompactAgent;
        const signal = abortSignalOf(payload.signal);
        const progress = latestCompactionProgress.get(agent);
        latestCompactionProgress.delete(agent);
        const shouldRetry = shouldRetryRequestAfterCompaction({
          failure: payload.failure,
          outputStarted: sessionAttemptHasVisibleOutput(agent.session),
          alreadyRetried: !gate.canRetry(agent, payload.turn),
          noProgress: progress?.noProgress,
          signalAborted: signal?.aborted === true,
        });
        if (!shouldRetry) return delegate();

        const compaction = agentCompaction(ctx, agent);
        if (compaction?.compactIfNeeded === undefined) return delegate();
        gate.markRetried(agent, payload.turn);
        try {
          await compaction.compactIfNeeded(agent, autoCompactTrigger(), signal ?? new AbortController().signal);
        } catch (error) {
          const failedProgress = latestCompactionProgress.get(agent);
          if (signal?.aborted !== true && failedProgress?.committed === true && failedProgress.noProgress === false) {
            return { kind: "retry" };
          }
          log("request-overflow compaction failed:", error instanceof Error ? error.message : String(error));
          return delegate();
        }
        const completedProgress = latestCompactionProgress.get(agent);
        if (signal?.aborted === true || completedProgress?.committed !== true || completedProgress.noProgress === true) {
          return delegate();
        }
        return { kind: "retry" };
      },
      { global: true },
    );
    const statusDisposer = ctx.on(
      "agent/status",
      (...args: unknown[]) => {
        const payload = args[0];
        if (isRecord(payload) && payload.status === "idle" && isRecord(payload.agent)) gate.reset(payload.agent);
      },
      { global: true },
    );
    return () => {
      if (typeof requestDisposer === "function") requestDisposer();
      if (typeof statusDisposer === "function") statusDisposer();
    };
  }, "dsh-fixes: request overflow recovery");
}

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
  ctx?: PluginContext,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const compaction = agentCompaction(ctx, agent);
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
        const result = await compactCurrentSession(invocation.agent, invocation.signal, ctx);
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
  installFileTouchLedger(ctx);
  installCompactionRetry(ctx);
  installRequestErrorRetry(ctx);
  installAutoCompact(ctx);
  installContextCommand(ctx);
}

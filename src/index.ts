import { symbols } from "@deepseek-ai/cordis";
import { applyModelWindow } from "./apply-window.js";
import { createAgentServiceCache } from "./compaction-service-cache.js";
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
import { createCompactionRehydrationGate } from "./compaction-rehydration-gate.js";
import {
  fileTouchesFromEvents,
  sessionEventList,
  skillItemsFromEvents,
} from "./compaction-history.js";
import {
  MAX_REHYDRATION_TOKENS,
  renderRehydrationMessage,
  selectRecentFileTouches,
  todoItemsFromProjection,
  type RehydrationItem,
} from "./compaction-rehydration.js";
import { patchContextWindows } from "./context-window.js";
import { patchGet, patchMethod } from "./method-patch.js";
import { probeHostSurface, type ServiceSpec } from "./host-probe.js";
import { createLogSink, formatDiag, formatLogArgs, resolveLogFile } from "./log.js";

const HOST_SURFACE: readonly ServiceSpec[] = [
  { name: "llm", members: ["stream"] },
  { name: "tokenMeter", members: ["measure"] },
  { name: "sessions", members: ["get"] },
  { name: "agents", members: ["get"] },
];
import {
  FIXES_NAMESPACE,
  modelKey,
  parseFixesSettings,
  resolveEffectiveAutoCompact,
  resolveEffectiveWindow,
  type FixesSettings,
} from "./fixes-settings.js";
import { Config } from "./fixes-config.js";
import { patchProviders, type ImageAllowance } from "./image-input.js";
import {
  normalizeUserMessageEvent,
  userMessageAppendData,
} from "./user-message-event.js";

const SETTINGS_NAMESPACE = "llm-pi-ai";
const LOG_PREFIX = "[dsh-fixes]";

export const name = "dsh-fixes";
export const inject = ["settings", "timer", "agentPresets"];
export { Config };

let activeConfig: unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Console output reaches only the terminal running `dsh web`. The same lines also go to
// <profile>/logs/dsh-fixes.log when the profile directory is known, so diagnostics survive a closed terminal.
const logSink = createLogSink({
  file: resolveLogFile(process.env),
  onFailure: (message) => console.warn(LOG_PREFIX, "log file disabled:", message),
});

function logLine(message: string): void {
  logSink.write(`${new Date().toISOString()} ${message}`);
}

function log(...args: unknown[]): void {
  console.warn(LOG_PREFIX, ...args);
  logLine(`${LOG_PREFIX} ${formatLogArgs(args)}`);
}

function diag(stage: string, detail: Record<string, unknown> = {}): void {
  console.warn(`${LOG_PREFIX} [diag] ${stage}`, JSON.stringify(detail));
  logLine(`${LOG_PREFIX} ${formatDiag(stage, detail)}`);
}

type SettingsDescriptorRow = { ns?: string; value?: unknown };

type SettingsLike = {
  writable?: boolean;
  get?(namespace: string): unknown;
  describe?(options?: { redactSecrets?: boolean }): SettingsDescriptorRow[];
  update(namespace: string, value: unknown): Promise<unknown>;
  register?(namespace: string, schema: unknown, options?: unknown): unknown;
  configure?(presentation: { auto?: boolean }, owner?: unknown): () => void;
};

function namespaceId(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readSection(settings: SettingsLike, namespace: string): unknown {
  if (typeof settings.get === "function") {
    try {
      return settings.get(namespace);
    } catch {
      // 0.1.7 SettingsForms has no get(); fall through to describe().
    }
  }
  if (typeof settings.describe !== "function") return undefined;
  try {
    const rows = settings.describe({ redactSecrets: false }) ?? [];
    for (const row of rows) {
      const id = namespaceId(row.ns);
      if (id === namespace || id.endsWith(`:${namespace}`)) return row.value;
    }
  } catch (error) {
    log("describe error:", error instanceof Error ? error.message : String(error));
  }
  return undefined;
}

function unwrapField(value: unknown): unknown {
  if (isRecord(value) && typeof value.get === "function") {
    try {
      return (value.get as () => unknown)();
    } catch {
      return undefined;
    }
  }
  return value;
}

function liveFixes(config: unknown): FixesSettings | undefined {
  if (!isRecord(config)) return undefined;
  const keys = ["contextWindows", "summarization", "compactionReserves", "autoCompactEnabled", "sessionOverrides", "imageInputModels"];
  if (!keys.some((key) => key in config)) return undefined;
  return parseFixesSettings({
    contextWindows: unwrapField(config.contextWindows),
    summarization: unwrapField(config.summarization),
    compactionReserves: unwrapField(config.compactionReserves),
    autoCompactEnabled: unwrapField(config.autoCompactEnabled),
    sessionOverrides: unwrapField(config.sessionOverrides),
    imageInputModels: unwrapField(config.imageInputModels),
  });
}

export async function fillImageInput(settings: SettingsLike, allow: ImageAllowance = {}): Promise<number> {
  if (settings.writable !== true) return 0;
  let section: unknown;
  try {
    section = readSection(settings, SETTINGS_NAMESPACE);
  } catch (error) {
    log("read settings error:", error instanceof Error ? error.message : String(error));
    return 0;
  }
  if (!isRecord(section)) return 0;
  const image = patchProviders(section.providers, allow);
  const windows = patchContextWindows(image.providers);
  const patched = image.patched + windows.patched;
  if (patched === 0) return 0;
  await settings.update(SETTINGS_NAMESPACE, { providers: windows.providers });
  log("patched", patched, "llm-pi-ai entries (image input / context windows)");
  return patched;
}

export function readFixes(settings: SettingsLike, config?: unknown): FixesSettings {
  const fromLive = liveFixes(config);
  if (fromLive !== undefined) return fromLive;
  try {
    return parseFixesSettings(readSection(settings, FIXES_NAMESPACE));
  } catch (error) {
    log("read dsh-fixes error:", error instanceof Error ? error.message : String(error));
    return parseFixesSettings(undefined);
  }
}

function currentFixes(settings: SettingsLike): FixesSettings {
  return readFixes(settings, activeConfig);
}

export async function writeFixes(settings: SettingsLike, next: FixesSettings): Promise<void> {
  await settings.update(FIXES_NAMESPACE, next);
}

function splitModelKey(key: string): { provider: string; model: string } | undefined {
  const index = key.indexOf("/");
  if (index <= 0 || index === key.length - 1) return undefined;
  return { provider: key.slice(0, index), model: key.slice(index + 1) };
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
    section = readSection(settings, SETTINGS_NAMESPACE);
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
    imageInputModels: { type: "object" },
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

export function installSettingsWatcher(ctx: PluginContext): void {
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
        const patched = await fillImageInput(settings, currentFixes(settings).imageInputModels);
        await mirrorContextWindows(settings, currentFixes(settings).contextWindows);
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
    // Config writes made while a Loader commit is running (HMR executing store) are rejected as nested.
    // The watcher listeners fire inside that commit, so they only queue a fill; the loop below was
    // started at install time and its awaits resume in that outer context, outside the commit.
    let wake: (() => void) | undefined;
    let queued = false;
    let queuedFixes: FixesSettings | undefined;
    const requestFill = (fixes?: FixesSettings) => {
      if (!alive) return;
      queued = true;
      if (fixes !== undefined) queuedFixes = fixes;
      const resume = wake;
      wake = undefined;
      resume?.();
    };
    const fillLoop = async () => {
      while (alive) {
        if (!queued) await new Promise<void>((resolve) => { wake = resolve; });
        if (!alive) return;
        queued = false;
        const fixes = queuedFixes ?? currentFixes(settings);
        queuedFixes = undefined;
        try {
          await fillImageInput(settings, fixes.imageInputModels);
          await mirrorContextWindows(settings, fixes.contextWindows);
        } catch (error) {
          if (alive) log("image switch error:", error instanceof Error ? error.message : String(error));
        }
      }
    };
    void fillLoop();
    const onSettingsChange = (...args: unknown[]) => {
      if (!alive) return;
      const namespace = args[0];
      if (namespace !== SETTINGS_NAMESPACE && namespace !== FIXES_NAMESPACE && namespace !== undefined) return;
      const carriesFixes = namespace !== SETTINGS_NAMESPACE && args.length >= 3;
      requestFill(carriesFixes ? parseFixesSettings(args[1]) : undefined);
    };
    const listenerDisposer = ctx.on("settings/updated", onSettingsChange);
    const documentDisposer = ctx.on("settings/document-updated", onSettingsChange);
    // Chat-side toggles write volatile config, which emits loader/volatile-update rather than
    // settings/document-updated; without this listener a ticked switch only applies after a restart.
    const volatileDisposer = ctx.on("loader/volatile-update", () => requestFill());
    return () => {
      alive = false;
      const resume = wake;
      wake = undefined;
      resume?.();
      for (const dispose of timerDisposers.splice(0)) dispose();
      if (typeof listenerDisposer === "function") listenerDisposer();
      if (typeof documentDisposer === "function") documentDisposer();
      if (typeof volatileDisposer === "function") volatileDisposer();
    };
  }, "dsh-fixes: image-input settings watcher");
}

function compactionLiveOptions(ctx: PluginContext, options: unknown): unknown {
  if (!isRecord(options)) return options;
  return applyCompactionRoute(
    options as CompactionStreamOptions,
    readFixes(ctx.settings, activeConfig).summarization,
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
    const restore = patchMethod(runtime, "stream", (original: (options: unknown) => unknown, options: unknown) => {
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
    });
    log("wrapping llm.stream for safe compaction retry");
    return restore;
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

type TraceableCompaction = CompactionLike & { [symbols.original]?: unknown };

function compactionTarget(compaction: CompactionLike): CompactionLike {
  const original = (compaction as TraceableCompaction)[symbols.original];
  return original !== null && (typeof original === "object" || typeof original === "function")
    ? original as CompactionLike
    : compaction;
}

const wrappedCompaction = new WeakMap<object, {
  originalIfNeeded?: CompactionLike["compactIfNeeded"];
  originalNow?: CompactionLike["compactNow"];
}>();
const latestCompactionProgress = new WeakMap<object, {
  committed: boolean;
  noProgress: boolean;
}>();
const rehydrationGate = createCompactionRehydrationGate();

type CompactionProgressSnapshot = {
  generation?: number;
  tokens?: number;
};

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

function compactionResultKey(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  if (typeof result.compactionId === "string" && result.compactionId.length > 0) {
    return `id:${result.compactionId}`;
  }
  if (typeof result.summarySeq === "number" && Number.isSafeInteger(result.summarySeq)) {
    return `summary:${result.summarySeq}`;
  }
  return undefined;
}

async function postCompaction(
  ctx: PluginContext,
  agent: CompactAgent,
  progress: { committed: boolean; noProgress: boolean },
  result: unknown,
): Promise<void> {
  const key = compactionResultKey(result);
  diag("postCompaction", {
    committed: progress.committed,
    noProgress: progress.noProgress,
    key: key ?? null,
    resultKeys: isRecord(result) ? Object.keys(result) : typeof result,
  });
  if (!progress.committed) return;
  if (key !== undefined && !rehydrationGate.claim(agent as object, key)) {
    diag("postCompaction: rehydration already claimed for this compaction", { key });
    return;
  }
  try {
    await rehydrateAfterCompaction(ctx, agent);
  } catch (error) {
    if (key !== undefined) rehydrationGate.release(agent as object, key);
    log("post-compaction rehydration failed:", error instanceof Error ? error.message : String(error));
  }
}

function wrapCompactionMethods(ctx: PluginContext, compaction: CompactionLike): (() => void) | undefined {
  const target = compactionTarget(compaction);
  if (wrappedCompaction.has(target as object)) return undefined;
  const originalIfNeededValue = target.compactIfNeeded;
  const originalNowValue = target.compactNow;
  // Read through Cordis so its method proxy keeps the engine's injected
  // dependencies together with the caller's context. Raw methods bound to the
  // service proxy lose that shadow context and fail on this.ctx.tokenMeter.
  const originalIfNeeded = compaction.compactIfNeeded?.bind(compaction);
  const originalNow = compaction.compactNow?.bind(compaction);
  let wrapperIfNeeded: CompactionLike["compactIfNeeded"];
  let wrapperNow: CompactionLike["compactNow"];
  try {
    if (originalIfNeeded !== undefined) {
      wrapperIfNeeded = async (agent, trigger, signal) => {
        if (!shouldRunIsolateCompact(trigger)) {
          return null;
        }
        const before = compactionSnapshot(ctx, agent as CompactAgent);
        try {
          const result = await originalIfNeeded(agent, trigger, signal);
          const progress = recordCompactionProgress(ctx, agent as CompactAgent, before, result);
          await postCompaction(ctx, agent as CompactAgent, progress, result);
          return result;
        } catch (error) {
          const progress = recordCompactionProgress(ctx, agent as CompactAgent, before, {});
          await postCompaction(ctx, agent as CompactAgent, progress, {});
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
          await postCompaction(ctx, agent as CompactAgent, progress, result);
          return result;
        } catch (error) {
          const progress = recordCompactionProgress(ctx, agent as CompactAgent, before, {});
          await postCompaction(ctx, agent as CompactAgent, progress, {});
          throw error;
        }
      };
      compaction.compactNow = wrapperNow;
    }
    wrappedCompaction.set(target as object, {
      originalIfNeeded: originalIfNeededValue,
      originalNow: originalNowValue,
    });
  } catch (error) {
    if (originalIfNeededValue !== undefined) target.compactIfNeeded = originalIfNeededValue;
    if (originalNowValue !== undefined) target.compactNow = originalNowValue;
    log("could not wrap compaction lifecycle:", error instanceof Error ? error.message : String(error));
    return undefined;
  }
  return () => {
    const current = wrappedCompaction.get(target as object);
    if (current === undefined) return;
    if (wrapperIfNeeded !== undefined && target.compactIfNeeded === wrapperIfNeeded) target.compactIfNeeded = current.originalIfNeeded;
    if (wrapperNow !== undefined && target.compactNow === wrapperNow) target.compactNow = current.originalNow;
    wrappedCompaction.delete(target as object);
  };
}

type CompactionServiceCache = (agent: CompactAgent) => CompactionLike | undefined;

const compactionServiceCaches = new WeakMap<object, CompactionServiceCache>();

function resolveAgentCompaction(ctx: PluginContext | undefined, agent: CompactAgent): CompactionLike | undefined {
  // Presets isolate compaction behind a per-agent realm in DSH 0.1.7. The
  // preset registry is the supported bridge from a global plugin to that
  // agent-owned service; direct context lookup remains a compatibility path
  // for older runtimes and unisolated deployments.
  let compaction: unknown;
  const presets = typeof ctx?.get === "function" ? ctx.get("agentPresets") : undefined;
  if (isRecord(presets) && typeof presets.serviceFor === "function") {
    try {
      compaction = presets.serviceFor(agent, "compaction");
    } catch {
      compaction = undefined;
    }
  }
  if (!isRecord(compaction) && typeof ctx?.get === "function") {
    compaction = ctx.get("compaction");
  }
  if (!isRecord(compaction)) {
    const get = agent.ctx?.get;
    compaction = typeof get === "function" ? get.call(agent.ctx, "compaction") : undefined;
  }
  if (!isRecord(compaction)) return undefined;
  return compaction as CompactionLike;
}

function agentCompaction(ctx: PluginContext | undefined, agent: CompactAgent): CompactionLike | undefined {
  let compaction: CompactionLike | undefined;
  if (ctx === undefined) {
    compaction = resolveAgentCompaction(ctx, agent);
  } else {
    let cache = compactionServiceCaches.get(ctx as object);
    if (cache === undefined) {
      cache = createAgentServiceCache<CompactAgent, CompactionLike>((owner) => resolveAgentCompaction(ctx, owner));
      compactionServiceCaches.set(ctx as object, cache);
    }
    compaction = cache(agent);
  }
  if (compaction === undefined) return undefined;
  if (ctx !== undefined) {
    const dispose = wrapCompactionMethods(ctx, compaction);
    if (dispose !== undefined) ctx.effect(() => dispose, "dsh-fixes: compaction lifecycle");
  }
  return compaction;
}

type SessionProjectionLike = {
  stateOf?(session: unknown, key: string): unknown;
};

type SessionStoreLike = {
  flush?(session: unknown): Promise<unknown>;
};

async function rehydrateAfterCompaction(ctx: PluginContext, agent: CompactAgent): Promise<void> {
  const session = agent.session;
  if (!isRecord(session) || typeof session.append !== "function") {
    diag("rehydrate: skipped, session has no append", { sessionType: typeof session });
    return;
  }
  installUserMessageShapeGuard(session);
  const history = sessionEventList(session);
  const touches = fileTouchesFromEvents(history);
  diag("rehydrate: start", { events: history.length, touches: touches.length });
  const items: RehydrationItem[] = [];
  const header = isRecord(session.header) ? session.header : undefined;
  // Paths only: the model re-reads a file when it needs its current content,
  // which keeps file bodies out of the snapshot and frees the budget for skills.
  const paths = selectRecentFileTouches(touches, typeof header?.cwd === "string" ? header.cwd : undefined);
  diag("rehydrate: recent files", { count: paths.length });
  if (paths.length > 0) {
    items.push({
      kind: "file",
      name: "recent files",
      text: ["Recently touched files (paths only; read them again before relying on their content):", ...paths.map((path) => `- ${path}`)].join("\n"),
    });
  }

  const projections = ctx.get("sessionProjections") as SessionProjectionLike | undefined;
  diag("rehydrate: projections", { available: projections?.stateOf !== undefined });
  if (projections?.stateOf !== undefined) {
    try {
      const rawTodos = projections.stateOf(session, "todos");
      const todo = todoItemsFromProjection(rawTodos);
      if (todo !== undefined) items.push(todo);
    } catch (error) {
      // Projection capability is optional and may disappear with its provider.
      diag("rehydrate: todo projection failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  const skills = skillItemsFromEvents(history);
  diag("rehydrate: history", { events: history.length, touches: touches.length, skills: skills.map((item) => item.name) });
  items.push(...skills);
  diag("rehydrate: items", { count: items.length, kinds: items.map((item) => item.kind) });

  let message = renderRehydrationMessage(items, MAX_REHYDRATION_TOKENS);
  const meter = ctx.get("tokenMeter") as TokenMeterLike | undefined;
  if (message !== undefined && typeof meter?.estimateMessage === "function") {
    let remaining = items.slice();
    while (message !== undefined) {
      let estimate: number | undefined;
      try {
        const measured = meter.estimateMessage({ ...message, id: "dsh-fixes-rehydration-estimate" });
        estimate = typeof measured === "number" && Number.isFinite(measured) ? measured : undefined;
      } catch {
        estimate = undefined;
      }
      if (estimate === undefined || estimate <= MAX_REHYDRATION_TOKENS || remaining.length === 0) break;
      remaining = remaining.slice(0, -1);
      message = renderRehydrationMessage(remaining, MAX_REHYDRATION_TOKENS);
    }
  }
  if (!isRecord(message)) {
    diag("rehydrate: no snapshot (empty after render)", { items: items.length });
    return;
  }
  const seq = typeof session.seq === "number" ? session.seq : Date.now();
  const userMessage = userMessageAppendData({ ...message, id: `dsh-fixes-rehydration-${seq}` });
  try {
    // user/message data is the message itself — nested `{ message }` leaves
    // event.data.source undefined and core throws reading `kind`.
    session.append("user/message", userMessage, { surfaceOp: "append" });
    // Report what was written, not what was offered: the budget may drop items.
    const written = isRecord(message.source) && Array.isArray(message.source.sections) ? message.source.sections.length : 0;
    diag("rehydrate: appended snapshot", { seq, sections: written, offered: items.length });
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
  if (meter === undefined || typeof meter.measure !== "function" || agent.session === undefined) return;
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
  if (provider === undefined || model === undefined || typeof llm?.resolveModelInfo !== "function") return;
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
  const fixes = currentFixes(ctx.settings);
  const sessionId = sessionIdOf(agent.session);
  const routeKey = modelKey(provider, model);
  const contextWindow = resolveEffectiveWindow(fixes, sessionId, routeKey) ?? catalogWindow;
  const budget = typeof contextWindow === "number"
    ? resolveCompactionBudget(contextWindow, fixes.compactionReserves[routeKey])
    : undefined;
  if (budget === undefined) return;
  const compact = shouldAutoCompact({
    estimatedTokens,
    contextWindow: budget.contextWindow,
    thresholdTokens: budget.thresholdTokens,
    busy,
    locked,
    enabled: resolveEffectiveAutoCompact(fixes, sessionId),
  });
  if (!compact) return;

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

function installUserMessageShapeGuard(session: unknown): void {
  if (!isRecord(session) || session.__dshFixesUserMessageGuard === true) return;
  try {
    if (typeof session.snapshotEvents === "function") {
      const original = (session.snapshotEvents as (...args: unknown[]) => unknown).bind(session);
      session.snapshotEvents = (...args: unknown[]) => {
        const events = original(...args);
        return Array.isArray(events) ? events.map((event) => normalizeUserMessageEvent(event)) : events;
      };
    }
    if (typeof session.eventAt === "function") {
      const original = (session.eventAt as (...args: unknown[]) => unknown).bind(session);
      session.eventAt = (...args: unknown[]) => normalizeUserMessageEvent(original(...args));
    }
    session.__dshFixesUserMessageGuard = true;
  } catch {
    // Frozen session objects still go through the corrected append path.
  }
}

function installUserMessageShapeGuards(ctx: PluginContext): void {
  ctx.effect(() => {
    // Set false on dispose so a call that slips past the restore cannot touch a dead context.
    let active = true;
    const restores: Array<() => void> = [];
    const sessions = ctx.get("sessions") as { get?(id: unknown): unknown } | undefined;
    if (sessions !== undefined) {
      restores.push(
        patchGet(sessions, (original, id) => {
          const session = original(id);
          if (active) installUserMessageShapeGuard(session);
          return session;
        }),
      );
    }
    const agents = ctx.get("agents") as { get?(id: unknown): unknown } | undefined;
    if (agents !== undefined) {
      restores.push(
        patchGet(agents, (original, id) => {
          const agent = original(id);
          if (active && isRecord(agent)) {
            installUserMessageShapeGuard(agent.session);
            // The Host resolves the agent before running a human command such as
            // /compact. Installing here covers a first manual compaction after a
            // restart, when no pre-step has run to install the wrapper yet.
            try {
              agentCompaction(ctx, agent as CompactAgent);
            } catch (error) {
              log("compaction lifecycle install failed:", error instanceof Error ? error.message : String(error));
            }
          }
          return agent;
        }),
      );
    }
    const disposer = ctx.on(
      "session/event",
      (...args: unknown[]) => {
        if (active) installUserMessageShapeGuard(args[0]);
      },
      { global: true },
    );
    return () => {
      active = false;
      for (const restore of restores) restore();
      if (typeof disposer === "function") disposer();
    };
  }, "dsh-fixes: user-message shape guard");
}


export function apply(ctx: PluginContext, config?: unknown): void {
  activeConfig = config;
  // One line per startup: which Host services the plugin can patch, and why any are missing.
  diag("host surface", probeHostSurface((name) => ctx.get(name), HOST_SURFACE));
  installUserMessageShapeGuards(ctx);
  installFixesNamespace(ctx);
  if (typeof ctx.settings.configure === "function") {
    try {
      ctx.effect(() => {
        const dispose = ctx.settings.configure?.({ auto: false });
        return typeof dispose === "function" ? dispose : () => undefined;
      }, "dsh-fixes: custom page");
    } catch (error) {
      log("settings configure error:", error instanceof Error ? error.message : String(error));
    }
  }
  installSettingsWatcher(ctx);
  installCompactionRetry(ctx);
  installRequestErrorRetry(ctx);
  installAutoCompact(ctx);
  installContextCommand(ctx);
}

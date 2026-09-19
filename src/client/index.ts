import { createElement, useEffect, useRef, useState, type CSSProperties, type ChangeEvent } from "react";

export const name = "dsh-fixes";
export const inject = ["slots"];

const FIXES_NS = "dsh-fixes";
const PI_AI_NS = "llm-pi-ai";
const WINDOW_CHOICES = [
  { tokens: 100000, label: "100k" },
  { tokens: 200000, label: "200k" },
  { tokens: 500000, label: "500k" },
  { tokens: 1000000, label: "1M" },
] as const;

type WindowChoice = (typeof WINDOW_CHOICES)[number]["tokens"];
type Summarization = { provider: string; model: string };
type FixesSettings = {
  contextWindows: Record<string, WindowChoice>;
  summarization: Summarization | null;
  thresholdRatio: number;
};
type ModelRef = { provider: string; model: string };
type CatalogModel = { provider: string; model: string; label: string };

type SettingsLike = {
  get?(namespace: string): unknown;
  update?(namespace: string, value: unknown): unknown;
  watch?(namespace: string, listener: () => void): unknown;
};

type SlotProps = {
  useSession?: (selector?: (value: unknown) => unknown) => unknown;
  useConversation?: (selector?: (value: unknown) => unknown) => unknown;
  useInput?: (selector?: (value: unknown) => unknown) => unknown;
  useChat?: () => { runCommand?: (name: string) => unknown };
  runCommand?: (name: string) => unknown;
  command?: (name: string) => unknown;
  inputActions?: {
    setDraft?: (text: string) => void;
    submit?: () => void;
    submitCommand?: (name: string) => unknown;
    runCommand?: (name: string) => unknown;
  };
};

type ClientContext = {
  slots: {
    inject(name: string, register: () => unknown): unknown;
    register(
      meta: {
        name: string;
        id: string;
        order: number;
        label: string;
      },
      render: (props: SlotProps) => unknown,
    ): unknown;
  };
  settings?: SettingsLike;
  get?(name: string): unknown;
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
};

const DEFAULT_FIXES: FixesSettings = {
  contextWindows: {},
  summarization: null,
  thresholdRatio: 0.4,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function modelKey(provider: string, model: string): string {
  return `${provider}/${model}`;
}

function clampThresholdRatio(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.4;
  if (value < 0.2) return 0.2;
  if (value > 0.9) return 0.9;
  return value;
}

function parseFixesSettings(raw: unknown): FixesSettings {
  if (!isRecord(raw)) return { ...DEFAULT_FIXES, contextWindows: {} };
  const contextWindows: Record<string, WindowChoice> = {};
  if (isRecord(raw.contextWindows)) {
    for (const [key, tokens] of Object.entries(raw.contextWindows)) {
      if (typeof tokens === "number" && WINDOW_CHOICES.some((choice) => choice.tokens === tokens)) {
        contextWindows[key] = tokens as WindowChoice;
      }
    }
  }
  let summarization: Summarization | null = null;
  if (isRecord(raw.summarization) && typeof raw.summarization.provider === "string" && typeof raw.summarization.model === "string") {
    if (raw.summarization.provider.length > 0 && raw.summarization.model.length > 0) {
      summarization = { provider: raw.summarization.provider, model: raw.summarization.model };
    }
  }
  return {
    contextWindows,
    summarization,
    thresholdRatio: clampThresholdRatio(raw.thresholdRatio),
  };
}

function windowLabel(tokens: number | undefined): string {
  return WINDOW_CHOICES.find((choice) => choice.tokens === tokens)?.label ?? "";
}

function nearestWindowChoice(tokens: number): WindowChoice {
  let best: WindowChoice = 100000;
  let bestDelta = Infinity;
  for (const choice of WINDOW_CHOICES) {
    const delta = Math.abs(choice.tokens - tokens);
    if (delta < bestDelta) {
      best = choice.tokens;
      bestDelta = delta;
    }
  }
  return best;
}

function readSettingsService(ctx: ClientContext): SettingsLike | undefined {
  if (ctx.settings !== undefined) return ctx.settings;
  if (typeof ctx.get === "function") {
    const settings = ctx.get("settings");
    if (isRecord(settings)) return settings as SettingsLike;
  }
  return undefined;
}

function settingsGet(ctx: ClientContext, namespace: string): unknown {
  const settings = readSettingsService(ctx);
  if (typeof settings?.get === "function") {
    try {
      return settings.get(namespace);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function settingsUpdate(ctx: ClientContext, namespace: string, value: unknown): Promise<void> {
  const settings = readSettingsService(ctx);
  if (typeof settings?.update !== "function") {
    return Promise.reject(new Error("settings unavailable"));
  }
  return Promise.resolve(settings.update(namespace, value)).then(() => undefined);
}

function asDisposer(value: unknown): (() => void) | undefined {
  return typeof value === "function" ? () => { value(); } : undefined;
}

function subscribeSettings(ctx: ClientContext, onChange: () => void): () => void {
  const settings = readSettingsService(ctx);
  const disposers: Array<() => void> = [];
  if (typeof settings?.watch === "function") {
    const off = asDisposer(settings.watch(FIXES_NS, onChange));
    if (off !== undefined) disposers.push(off);
    const offPi = asDisposer(settings.watch(PI_AI_NS, onChange));
    if (offPi !== undefined) disposers.push(offPi);
  }
  if (typeof ctx.on === "function") {
    const off = asDisposer(ctx.on("settings/updated", (...args: unknown[]) => {
      const namespace = args[0];
      if (namespace === FIXES_NS || namespace === PI_AI_NS) onChange();
    }));
    if (off !== undefined) disposers.push(off);
  }
  return () => {
    for (const dispose of disposers) dispose();
  };
}

function catalogFromPiAi(raw: unknown): CatalogModel[] {
  if (!isRecord(raw) || !isRecord(raw.providers)) return [];
  const models: CatalogModel[] = [];
  const seen = new Set<string>();
  for (const [provider, profile] of Object.entries(raw.providers)) {
    if (!isRecord(profile)) continue;
    const list = Array.isArray(profile.models) ? profile.models : [];
    for (const entry of list) {
      if (!isRecord(entry)) continue;
      const model = typeof entry.id === "string" ? entry.id : typeof entry.name === "string" ? entry.name : "";
      if (!model) continue;
      const key = modelKey(provider, model);
      if (seen.has(key)) continue;
      seen.add(key);
      const display = typeof entry.name === "string" && entry.name && entry.name !== model ? `${entry.name}` : model;
      models.push({ provider, model, label: `${provider}/${display}` });
    }
  }
  return models;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function readModelPair(value: unknown): ModelRef | undefined {
  const rec = asRecord(value);
  if (rec === undefined) return undefined;
  const nested =
    asRecord(rec.config) ??
    asRecord(asRecord(rec.header)?.config) ??
    asRecord(rec.header) ??
    asRecord(rec.options) ??
    asRecord(rec.requestConfig) ??
    rec;
  const provider = nested.provider;
  const model = nested.model;
  if (typeof provider === "string" && provider.length > 0 && typeof model === "string" && model.length > 0) {
    return { provider, model };
  }
  return undefined;
}

function walkForModel(value: unknown, depth = 0): ModelRef | undefined {
  const direct = readModelPair(value);
  if (direct !== undefined) return direct;
  if (depth > 4) return undefined;
  const rec = asRecord(value);
  if (rec === undefined) return undefined;
  for (const key of ["config", "header", "prompt", "snapshot", "session", "options", "requestConfig", "lastRequest"]) {
    const found = walkForModel(rec[key], depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function currentModelFromSnapshots(session: unknown, conversation: unknown): ModelRef | undefined {
  return walkForModel(session) ?? walkForModel(conversation);
}

function snapshotOf(hook: unknown): unknown {
  if (typeof hook !== "function") return undefined;
  try {
    return hook((value: unknown) => value);
  } catch {
    try {
      return (hook as () => unknown)();
    } catch {
      return undefined;
    }
  }
}

function sessionBusy(session: unknown): boolean {
  const rec = asRecord(session);
  if (rec === undefined) return false;
  return rec.running === true || rec.status === "running" || rec.status === "busy";
}

function findRunCommand(
  props: SlotProps,
  chat?: { runCommand?: (name: string) => unknown },
): ((name: string) => unknown) | undefined {
  if (typeof props.runCommand === "function") return props.runCommand.bind(props);
  if (typeof props.command === "function") return props.command.bind(props);
  const actions = props.inputActions;
  if (typeof actions?.runCommand === "function") return actions.runCommand.bind(actions);
  if (typeof actions?.submitCommand === "function") return actions.submitCommand.bind(actions);
  if (typeof chat?.runCommand === "function") return chat.runCommand.bind(chat);
  return undefined;
}

const chipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 28,
  padding: "0 10px",
  border: "0.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,0.35))",
  borderRadius: 8,
  background: "var(--dsw-alias-interactive-bg-idle, transparent)",
  color: "var(--dsw-alias-label-primary, inherit)",
  font: "inherit",
  fontSize: 12,
  lineHeight: "20px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const popoverStyle: CSSProperties = {
  position: "absolute",
  bottom: "calc(100% + 8px)",
  left: 0,
  zIndex: 40,
  minWidth: 268,
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 12,
  borderRadius: 12,
  border: "0.5px solid var(--dsw-alias-border-l4, rgba(127,127,127,0.28))",
  background: "var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-1, #1c1c1c))",
  color: "var(--dsw-alias-label-primary, inherit)",
  boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const labelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--dsw-alias-label-secondary, inherit)",
};

const choiceRowStyle: CSSProperties = {
  display: "flex",
  gap: 6,
};

function choiceStyle(active: boolean, disabled: boolean): CSSProperties {
  return {
    flex: 1,
    height: 28,
    border: active
      ? "0.5px solid var(--dsw-alias-state-business-primary, #3b82f6)"
      : "0.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,0.35))",
    borderRadius: 8,
    background: active
      ? "var(--dsw-alias-interactive-bg-selected, rgba(59,130,246,0.16))"
      : "transparent",
    color: "var(--dsw-alias-label-primary, inherit)",
    font: "inherit",
    fontSize: 12,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}

const selectStyle: CSSProperties = {
  height: 30,
  borderRadius: 8,
  border: "0.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,0.35))",
  background: "var(--dsw-alias-bg-layer-1, transparent)",
  color: "inherit",
  font: "inherit",
  fontSize: 12,
  padding: "0 8px",
};

const compactStyle: CSSProperties = {
  height: 32,
  borderRadius: 8,
  border: "0.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,0.35))",
  background: "var(--dsw-alias-button-secondary-fill, transparent)",
  color: "inherit",
  font: "inherit",
  fontSize: 12,
  cursor: "pointer",
};

const errorStyle: CSSProperties = {
  fontSize: 11,
  color: "var(--dsw-alias-state-error-primary, #f87171)",
  margin: 0,
};

export function apply(ctx: ClientContext): void {
  function ContextPanel(props: SlotProps) {
    const session = snapshotOf(props.useSession);
    const conversation = snapshotOf(props.useConversation);
    const chat = typeof props.useChat === "function" ? snapshotOf(props.useChat) as { runCommand?: (name: string) => unknown } : undefined;
    const current = currentModelFromSnapshots(session, conversation);
    const busy = sessionBusy(session);

    const [open, setOpen] = useState(false);
    const [fixes, setFixes] = useState<FixesSettings>(() => parseFixesSettings(settingsGet(ctx, FIXES_NS)));
    const [catalog, setCatalog] = useState<CatalogModel[]>(() => catalogFromPiAi(settingsGet(ctx, PI_AI_NS)));
    const [error, setError] = useState("");
    const [compacting, setCompacting] = useState(false);
    const [draftPercent, setDraftPercent] = useState<number | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      const pull = () => {
        setFixes(parseFixesSettings(settingsGet(ctx, FIXES_NS)));
        setCatalog(catalogFromPiAi(settingsGet(ctx, PI_AI_NS)));
      };
      pull();
      return subscribeSettings(ctx, pull);
    }, []);

    useEffect(() => {
      if (!open) return;
      const onPointer = (event: PointerEvent) => {
        const root = rootRef.current;
        if (root !== null && event.target instanceof Node && !root.contains(event.target)) {
          setOpen(false);
        }
      };
      document.addEventListener("pointerdown", onPointer);
      return () => document.removeEventListener("pointerdown", onPointer);
    }, [open]);

    const storedWindow = current === undefined ? undefined : fixes.contextWindows[modelKey(current.provider, current.model)];
    const selectedWindow = storedWindow ?? (current === undefined ? undefined : nearestWindowChoice(500000));
    const percent = draftPercent ?? Math.round(fixes.thresholdRatio * 100);
    const windowDisabled = current === undefined;
    const compactDisabled = busy || compacting;
    const compactTitle = compacting ? "压缩进行中" : busy ? "忙碌" : undefined;
    const chipWindow = windowLabel(selectedWindow);

    const persist = (patch: Partial<FixesSettings>) => {
      const next: FixesSettings = {
        contextWindows: patch.contextWindows ?? fixes.contextWindows,
        summarization: patch.summarization !== undefined ? patch.summarization : fixes.summarization,
        thresholdRatio: patch.thresholdRatio ?? fixes.thresholdRatio,
      };
      setFixes(next);
      void settingsUpdate(ctx, FIXES_NS, next).catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    };

    const onWindow = (tokens: WindowChoice) => {
      if (current === undefined) return;
      persist({
        contextWindows: { ...fixes.contextWindows, [modelKey(current.provider, current.model)]: tokens },
      });
    };

    const onSummarizer = (value: string) => {
      if (value === "") {
        persist({ summarization: null });
        return;
      }
      const index = value.indexOf("/");
      if (index <= 0) return;
      persist({ summarization: { provider: value.slice(0, index), model: value.slice(index + 1) } });
    };

    const onCompact = () => {
      setError("");
      const run = findRunCommand(props, chat);
      if (run === undefined) {
        setError("请在输入框输入 /compact");
        return;
      }
      setCompacting(true);
      Promise.resolve(run("compact"))
        .catch((reason: unknown) => {
          setError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => {
          setCompacting(false);
        });
    };

    const summarizerValue = fixes.summarization === null ? "" : modelKey(fixes.summarization.provider, fixes.summarization.model);

    return createElement(
      "div",
      { ref: rootRef, style: { position: "relative", display: "inline-flex" } },
      createElement(
        "button",
        {
          type: "button",
          style: chipStyle,
          "aria-expanded": open,
          "aria-haspopup": "dialog",
          onClick: () => setOpen((value) => !value),
        },
        chipWindow ? `上下文 ${chipWindow}` : "上下文",
      ),
      open
        ? createElement(
            "div",
            { role: "dialog", style: popoverStyle },
            createElement(
              "div",
              { style: rowStyle },
              createElement("div", { style: labelStyle }, "上下文"),
              createElement(
                "div",
                { style: choiceRowStyle },
                ...WINDOW_CHOICES.map((choice) =>
                  createElement(
                    "button",
                    {
                      key: choice.label,
                      type: "button",
                      disabled: windowDisabled,
                      title: windowDisabled ? "当前对话模型未知" : choice.label,
                      style: choiceStyle(selectedWindow === choice.tokens, windowDisabled),
                      onClick: () => onWindow(choice.tokens),
                    },
                    choice.label,
                  ),
                ),
              ),
            ),
            createElement(
              "div",
              { style: rowStyle },
              createElement("label", { style: labelStyle }, "压缩模型"),
              createElement(
                "select",
                {
                  style: selectStyle,
                  value: summarizerValue,
                  onChange: (event: ChangeEvent<HTMLSelectElement>) => onSummarizer(event.target.value),
                },
                createElement("option", { value: "" }, "当前对话模型"),
                ...catalog.map((entry) =>
                  createElement(
                    "option",
                    { key: modelKey(entry.provider, entry.model), value: modelKey(entry.provider, entry.model) },
                    entry.label,
                  ),
                ),
              ),
            ),
            createElement(
              "div",
              { style: rowStyle },
              createElement("label", { style: labelStyle }, "自动压缩"),
              createElement("input", {
                type: "range",
                min: 20,
                max: 90,
                step: 5,
                value: percent,
                onChange: (event: ChangeEvent<HTMLInputElement>) => {
                  const next = Number(event.target.value);
                  setDraftPercent(next);
                },
                onPointerUp: () => {
                  const next = draftPercent ?? percent;
                  setDraftPercent(null);
                  persist({ thresholdRatio: next / 100 });
                },
                onKeyUp: () => {
                  const next = draftPercent ?? percent;
                  setDraftPercent(null);
                  persist({ thresholdRatio: next / 100 });
                },
              }),
              createElement("div", { style: { fontSize: 12 } }, `用到 ${percent}% 时压缩`),
            ),
            createElement(
              "button",
              {
                type: "button",
                style: { ...compactStyle, opacity: compactDisabled ? 0.55 : 1, cursor: compactDisabled ? "not-allowed" : "pointer" },
                disabled: compactDisabled,
                title: compactTitle,
                onClick: onCompact,
              },
              "压缩上下文",
            ),
            error ? createElement("p", { style: errorStyle }, error) : null,
          )
        : null,
    );
  }

  ctx.slots.inject("conversation.input.left", function () {
    return ctx.slots.register(
      {
        name: "conversation.input.left",
        id: "dsh-fixes-context",
        order: 0,
        label: "Context",
      },
      function (props) {
        return createElement(ContextPanel, props);
      },
    );
  });
}

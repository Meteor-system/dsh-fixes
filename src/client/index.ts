import {
  createElement,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

export const name = "dsh-fixes";
export const inject = ["slots", "settingsScope"];

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

type SettingsScope<T> = {
  getSnapshot(): { value?: T };
  subscribe(listener: () => void): () => void;
  set(field: string, value: unknown): Promise<void>;
};

type SettingsScopeBinder = {
  bind<T>(spec: { namespace: string; decode?: (section: unknown) => T | undefined }): SettingsScope<T>;
};

type SlotProps = {
  useSession?: (selector: (value: unknown) => unknown) => unknown;
  useInput?: (selector: (value: unknown) => unknown) => unknown;
  useProjection?: (key: string) => unknown;
  sessionId?: unknown;
  inputActions?: {
    setDraft?: (text: string) => void;
    submit?: () => void;
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
  settingsScope?: SettingsScopeBinder;
  get?(name: string): unknown;
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
  if (!isRecord(raw)) return { contextWindows: {}, summarization: null, thresholdRatio: 0.4 };
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

function settingsBinder(ctx: ClientContext): SettingsScopeBinder | undefined {
  if (ctx.settingsScope !== undefined && typeof ctx.settingsScope.bind === "function") {
    return ctx.settingsScope;
  }
  if (typeof ctx.get === "function") {
    const value = ctx.get("settingsScope");
    if (isRecord(value) && typeof value.bind === "function") {
      return value as SettingsScopeBinder;
    }
  }
  return undefined;
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
      const display = typeof entry.name === "string" && entry.name && entry.name !== model ? entry.name : model;
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
  const provider = rec.provider;
  const model = rec.model;
  if (typeof provider === "string" && provider.length > 0 && typeof model === "string" && model.length > 0) {
    return { provider, model };
  }
  return undefined;
}

function modelFromSelection(value: unknown): ModelRef | undefined {
  const rec = asRecord(value);
  if (rec === undefined) return undefined;
  return readModelPair(rec.next) ?? readModelPair(rec.lastUsed);
}

function useScopeValue<T>(scope: SettingsScope<T> | undefined, fallback: T): T {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (scope === undefined) return () => undefined;
      return scope.subscribe(onStoreChange);
    },
    () => scope?.getSnapshot().value ?? fallback,
    () => fallback,
  );
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
  const binder = settingsBinder(ctx);
  const fixesScope = binder?.bind({ namespace: FIXES_NS, decode: parseFixesSettings });
  const piAiScope = binder?.bind({ namespace: PI_AI_NS });

  function ContextPanel(props: SlotProps) {
    const selection = typeof props.useProjection === "function" ? props.useProjection("modelSelection") : undefined;
    const current = modelFromSelection(selection);
    const running = typeof props.useSession === "function"
      ? props.useSession((value) => isRecord(value) && value.running === true) === true
      : false;
    const draft = typeof props.useInput === "function"
      ? String(props.useInput((value) => (isRecord(value) && typeof value.draft === "string" ? value.draft : "")) ?? "")
      : "";

    const fixes = useScopeValue(fixesScope, DEFAULT_FIXES);
    const piAi = useScopeValue<unknown>(piAiScope, undefined);
    const catalog = catalogFromPiAi(piAi);

    const [open, setOpen] = useState(false);
    const [error, setError] = useState("");
    const [compacting, setCompacting] = useState(false);
    const [draftPercent, setDraftPercent] = useState<number | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      if (!open) return;
      const onPointer = (event: globalThis.PointerEvent) => {
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
    const compactDisabled = running || compacting;
    const compactTitle = compacting ? "压缩进行中" : running ? "忙碌" : undefined;
    const chipWindow = windowLabel(selectedWindow);

    const persistField = (field: string, value: unknown) => {
      if (fixesScope === undefined) {
        setError("settings unavailable");
        return;
      }
      setError("");
      void fixesScope.set(field, value).catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    };

    const onWindow = (tokens: WindowChoice) => {
      if (current === undefined) return;
      persistField("contextWindows", {
        ...fixes.contextWindows,
        [modelKey(current.provider, current.model)]: tokens,
      });
    };

    const onSummarizer = (value: string) => {
      if (value === "") {
        persistField("summarization", null);
        return;
      }
      const index = value.indexOf("/");
      if (index <= 0) return;
      persistField("summarization", { provider: value.slice(0, index), model: value.slice(index + 1) });
    };

    const commitThreshold = (raw: string) => {
      const next = Number(raw);
      setDraftPercent(null);
      if (!Number.isFinite(next)) return;
      persistField("thresholdRatio", next / 100);
    };

    const onCompact = () => {
      setError("");
      const actions = props.inputActions;
      if (typeof actions?.setDraft !== "function" || typeof actions.submit !== "function") {
        setError("请在输入框输入 /compact");
        return;
      }
      const saved = draft;
      setCompacting(true);
      try {
        actions.setDraft("/compact");
        actions.submit();
        actions.setDraft(saved);
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : String(reason));
        try {
          actions.setDraft(saved);
        } catch {
          // restore is best-effort
        }
      } finally {
        setCompacting(false);
      }
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
                  setDraftPercent(Number(event.currentTarget.value));
                },
                onPointerUp: (event: PointerEvent<HTMLInputElement>) => {
                  commitThreshold(event.currentTarget.value);
                },
                onKeyUp: (event: KeyboardEvent<HTMLInputElement>) => {
                  commitThreshold(event.currentTarget.value);
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

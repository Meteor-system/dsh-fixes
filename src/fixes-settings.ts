export const FIXES_NAMESPACE = "dsh-fixes";
export const WINDOW_CHOICES = [128000, 256000, 392000, 512000, 1000000] as const;
export type WindowChoice = (typeof WINDOW_CHOICES)[number];
export type Summarization = { provider: string; model: string };
export type SessionOverride = {
  window?: WindowChoice;
  autoCompactEnabled?: boolean;
};
export type FixesSettings = {
  contextWindows: Record<string, WindowChoice>;
  summarization: Summarization | null;
  thresholdRatio: number;
  autoCompactEnabled: boolean;
  sessionOverrides: Record<string, SessionOverride>;
};

export function modelKey(provider: string, model: string): string {
  return `${provider}/${model}`;
}

export function clampThresholdRatio(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.4;
  if (value < 0.2) return 0.2;
  if (value > 0.9) return 0.9;
  return value;
}

export function nearestWindowChoice(tokens: number): WindowChoice {
  let best: WindowChoice = 128000;
  let bestDelta = Infinity;
  for (const choice of WINDOW_CHOICES) {
    const delta = Math.abs(choice - tokens);
    if (delta < bestDelta) {
      best = choice;
      bestDelta = delta;
    }
  }
  return best;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSessionOverride(value: unknown): SessionOverride | undefined {
  if (!isRecord(value)) return undefined;
  const override: SessionOverride = {};
  if (typeof value.window === "number" && (WINDOW_CHOICES as readonly number[]).includes(value.window)) {
    override.window = value.window as WindowChoice;
  }
  if (typeof value.autoCompactEnabled === "boolean") {
    override.autoCompactEnabled = value.autoCompactEnabled;
  }
  return override.window !== undefined || override.autoCompactEnabled !== undefined ? override : undefined;
}

export function parseFixesSettings(raw: unknown): FixesSettings {
  if (!isRecord(raw)) {
    return {
      contextWindows: {},
      summarization: null,
      thresholdRatio: 0.4,
      autoCompactEnabled: true,
      sessionOverrides: {},
    };
  }
  const contextWindows: Record<string, WindowChoice> = {};
  if (isRecord(raw.contextWindows)) {
    for (const [key, tokens] of Object.entries(raw.contextWindows)) {
      if (typeof tokens === "number" && (WINDOW_CHOICES as readonly number[]).includes(tokens)) {
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
  const sessionOverrides: Record<string, SessionOverride> = {};
  if (isRecord(raw.sessionOverrides)) {
    for (const [sessionId, value] of Object.entries(raw.sessionOverrides)) {
      if (sessionId.length === 0) continue;
      const override = parseSessionOverride(value);
      if (override !== undefined) sessionOverrides[sessionId] = override;
    }
  }
  return {
    contextWindows,
    summarization,
    thresholdRatio: clampThresholdRatio(raw.thresholdRatio),
    autoCompactEnabled: raw.autoCompactEnabled !== false,
    sessionOverrides,
  };
}

export function resolveEffectiveWindow(
  fixes: FixesSettings,
  sessionId: string | undefined,
  key: string | undefined,
): WindowChoice | undefined {
  if (sessionId !== undefined) {
    const window = fixes.sessionOverrides[sessionId]?.window;
    if (window !== undefined) return window;
  }
  if (key === undefined) return undefined;
  return fixes.contextWindows[key];
}

export function resolveEffectiveAutoCompact(fixes: FixesSettings, sessionId: string | undefined): boolean {
  if (sessionId !== undefined) {
    const value = fixes.sessionOverrides[sessionId]?.autoCompactEnabled;
    if (value !== undefined) return value;
  }
  return fixes.autoCompactEnabled;
}

export function patchSessionOverride(
  overrides: Record<string, SessionOverride>,
  sessionId: string,
  patch: { window?: WindowChoice | null; autoCompactEnabled?: boolean | null },
): Record<string, SessionOverride> {
  const current = overrides[sessionId] ?? {};
  const next: SessionOverride = { ...current };
  if (patch.window === null) delete next.window;
  else if (patch.window !== undefined) next.window = patch.window;
  if (patch.autoCompactEnabled === null) delete next.autoCompactEnabled;
  else if (patch.autoCompactEnabled !== undefined) next.autoCompactEnabled = patch.autoCompactEnabled;
  const rest = { ...overrides };
  if (next.window === undefined && next.autoCompactEnabled === undefined) {
    delete rest[sessionId];
    return rest;
  }
  rest[sessionId] = next;
  return rest;
}

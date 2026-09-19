export const FIXES_NAMESPACE = "dsh-fixes";
export const WINDOW_CHOICES = [100000, 200000, 500000, 1000000] as const;
export type WindowChoice = (typeof WINDOW_CHOICES)[number];
export type Summarization = { provider: string; model: string };
export type FixesSettings = {
  contextWindows: Record<string, WindowChoice>;
  summarization: Summarization | null;
  thresholdRatio: number;
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
  let best: WindowChoice = 100000;
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

export function parseFixesSettings(raw: unknown): FixesSettings {
  if (!isRecord(raw)) {
    return { contextWindows: {}, summarization: null, thresholdRatio: 0.4 };
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
  return {
    contextWindows,
    summarization,
    thresholdRatio: clampThresholdRatio(raw.thresholdRatio),
  };
}

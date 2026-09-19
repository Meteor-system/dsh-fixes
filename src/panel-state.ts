import { modelKey, nearestWindowChoice, type FixesSettings, type WindowChoice } from "./fixes-settings.js";

export type PanelState = {
  provider: string;
  model: string;
  window: WindowChoice | undefined;
  summarization: { provider: string; model: string } | null;
  thresholdRatio: number;
  models: Array<{ provider: string; model: string }>;
};

export function resolveSelectedWindow(
  stored: WindowChoice | undefined,
  catalogTokens: number | undefined,
): WindowChoice | undefined {
  if (stored !== undefined) return stored;
  if (typeof catalogTokens === "number" && Number.isFinite(catalogTokens)) {
    return nearestWindowChoice(catalogTokens);
  }
  return undefined;
}

export function buildPanelState(input: {
  provider: string;
  model: string;
  llmContextWindow?: number;
  fixes: FixesSettings;
  catalog: Array<{ provider: string; model: string }>;
}): PanelState {
  const key = modelKey(input.provider, input.model);
  const stored = input.fixes.contextWindows[key];
  return {
    provider: input.provider,
    model: input.model,
    window: resolveSelectedWindow(stored, input.llmContextWindow),
    summarization: input.fixes.summarization,
    thresholdRatio: input.fixes.thresholdRatio,
    models: input.catalog,
  };
}

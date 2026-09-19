import { modelKey, nearestWindowChoice, type FixesSettings } from "./fixes-settings.js";

export type PanelState = {
  provider: string;
  model: string;
  window: number;
  summarization: { provider: string; model: string } | null;
  thresholdRatio: number;
  models: Array<{ provider: string; model: string }>;
};

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
    window: stored ?? nearestWindowChoice(input.llmContextWindow ?? 500000),
    summarization: input.fixes.summarization,
    thresholdRatio: input.fixes.thresholdRatio,
    models: input.catalog,
  };
}

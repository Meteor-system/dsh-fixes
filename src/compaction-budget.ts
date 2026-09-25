export const DEFAULT_SUMMARY_OUTPUT_TOKENS = 20_000;
export const DEFAULT_TOOL_RESULT_TOKENS = 13_000;

export type CompactionReserveOverride = {
  summaryOutputTokens?: number;
  toolResultTokens?: number;
};

export type CompactionBudget = {
  contextWindow: number;
  summaryOutputTokens: number;
  toolResultTokens: number;
  thresholdTokens: number;
};

function validReserve(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

export function resolveCompactionBudget(
  contextWindow: number,
  override?: CompactionReserveOverride,
): CompactionBudget | undefined {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return undefined;
  const window = Math.floor(contextWindow);
  if (window <= 0) return undefined;
  const summaryOutputTokens = validReserve(override?.summaryOutputTokens, DEFAULT_SUMMARY_OUTPUT_TOKENS);
  const toolResultTokens = validReserve(override?.toolResultTokens, DEFAULT_TOOL_RESULT_TOKENS);
  return {
    contextWindow: window,
    summaryOutputTokens,
    toolResultTokens,
    thresholdTokens: Math.max(Math.floor(window / 2), window - summaryOutputTokens - toolResultTokens),
  };
}

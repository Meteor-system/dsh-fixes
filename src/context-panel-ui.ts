const WINDOW_LABELS: Record<number, string> = {
  128000: "128k",
  256000: "256k",
  392000: "392k",
  512000: "512k",
  1000000: "1M",
};

export function popoverAnchorStyle(): {
  position: "absolute";
  right: number;
  left: "auto";
  bottom: string;
} {
  return {
    position: "absolute",
    right: 0,
    left: "auto",
    bottom: "calc(100% + 8px)",
  };
}

export function windowSurchargeNote(tokens: number | undefined): string | null {
  return tokens === 1_000_000 ? "1M 在部分模型上会额外计费" : null;
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  return `${Math.round(tokens / 1_000)}k`;
}

export function compactionThresholdLabel(
  budget: {
    thresholdTokens: number;
    summaryOutputTokens: number;
    toolResultTokens: number;
  } | undefined,
  autoEnabled = true,
): string {
  if (budget === undefined) return autoEnabled ? "无法计算自动压缩阈值" : "无法计算压缩阈值（自动压缩已关闭）";
  if (!autoEnabled) {
    return `压缩阈值约 ${formatTokenCount(budget.thresholdTokens)}（自动压缩已关闭；预留摘要 ${formatTokenCount(budget.summaryOutputTokens)} + 工具结果 ${formatTokenCount(budget.toolResultTokens)}）`;
  }
  return `约 ${formatTokenCount(budget.thresholdTokens)} 时压缩（预留摘要 ${formatTokenCount(budget.summaryOutputTokens)} + 工具结果 ${formatTokenCount(budget.toolResultTokens)}）`;
}

export function contextChipCopy(tokens: number | undefined): { label: string; title: string } {
  const window = tokens === undefined ? undefined : WINDOW_LABELS[tokens];
  if (window === undefined) return { label: "上下文", title: "上下文" };
  return { label: window, title: `上下文 ${window}` };
}

export function compactButtonStyle(state: { pressed: boolean; busy: boolean }): {
  background: string;
  color: string;
  opacity: number;
  cursor: string;
} {
  return {
    background: state.pressed
      ? "var(--dsw-alias-state-business-primary-active, #1d4ed8)"
      : "var(--dsw-alias-state-business-primary, #3b82f6)",
    color: "#fff",
    opacity: state.busy ? 0.72 : 1,
    cursor: state.busy ? "wait" : "pointer",
  };
}

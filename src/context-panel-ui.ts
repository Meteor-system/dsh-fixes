export function windowSurchargeNote(tokens: number | undefined): string | null {
  return tokens === 1_000_000 ? "1M 在部分模型上会额外计费" : null;
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

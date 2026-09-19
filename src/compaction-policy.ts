export type AutoCompactInput = {
  estimatedTokens: number;
  contextWindow: number;
  thresholdRatio: number;
  busy: boolean;
  locked: boolean;
};

export function shouldAutoCompact(input: AutoCompactInput): boolean {
  if (input.busy || input.locked) return false;
  if (!(input.contextWindow > 0) || !(input.estimatedTokens >= 0)) return false;
  return input.estimatedTokens >= input.contextWindow * input.thresholdRatio;
}

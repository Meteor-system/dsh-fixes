/** Context and output limits used when the gateway does not declare them. */
export const WORKING_WINDOW = 500_000;
export const WORKING_MAX_TOKENS = 500_000;

export type Capacity = {
  contextWindow: number;
  maxTokens: number;
};

const EXACT: Record<string, Capacity> = {
  "grok-4.3": { contextWindow: 1_000_000, maxTokens: 30_000 },
  "grok-4.5": { contextWindow: 500_000, maxTokens: 500_000 },
  "grok-4.6": { contextWindow: 500_000, maxTokens: 500_000 },
};

export function modelCapacity(modelId: string): Capacity | undefined {
  const id = modelId.trim();
  if (id.length === 0) return undefined;
  const exact = EXACT[id];
  if (exact !== undefined) return exact;
  if (/^grok-4(\.|-|$)/i.test(id)) return { contextWindow: 500_000, maxTokens: 500_000 };
  return { contextWindow: WORKING_WINDOW, maxTokens: WORKING_MAX_TOKENS };
}

/** Image input is allowed only for a `route/model` recorded as on. Missing or false means off. */
export function isImageAllowed(
  allow: Record<string, boolean>,
  route: string,
  modelId: string,
): boolean {
  return allow[`${route}/${modelId}`] === true;
}

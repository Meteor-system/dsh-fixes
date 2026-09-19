function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteTokens(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function modelId(entry: Record<string, unknown>): string {
  if (typeof entry.id === "string" && entry.id.length > 0) return entry.id;
  if (typeof entry.name === "string" && entry.name.length > 0) return entry.name;
  return "";
}

/** Read one model's catalog contextWindow from llm-pi-ai (models, then modelOverrides). */
export function readCatalogContextWindow(section: unknown, provider: string, model: string): number | undefined {
  if (!isRecord(section) || !isRecord(section.providers)) return undefined;
  const profile = section.providers[provider];
  if (!isRecord(profile)) return undefined;
  let tokens: number | undefined;
  if (Array.isArray(profile.models)) {
    for (const entry of profile.models) {
      if (!isRecord(entry) || modelId(entry) !== model) continue;
      const window = finiteTokens(entry.contextWindow);
      if (window !== undefined) tokens = window;
    }
  }
  const overrides = profile.modelOverrides;
  if (isRecord(overrides) && isRecord(overrides[model])) {
    const window = finiteTokens(overrides[model].contextWindow);
    if (window !== undefined) tokens = window;
  }
  return tokens;
}

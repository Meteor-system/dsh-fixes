function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function applyModelWindow(
  providers: unknown,
  provider: string,
  model: string,
  contextWindow: number,
): { providers: unknown; patched: boolean } {
  if (!isRecord(providers)) return { providers, patched: false };
  const profile = providers[provider];
  if (!isRecord(profile)) return { providers, patched: false };

  let nextProfile: Record<string, unknown> = profile;
  let patched = false;

  const models = profile.models;
  if (Array.isArray(models)) {
    let modelsDirty = false;
    const nextModels = models.map((entry) => {
      if (!isRecord(entry) || entry.id !== model) return entry;
      if (entry.contextWindow === contextWindow) return entry;
      modelsDirty = true;
      patched = true;
      return { ...entry, contextWindow };
    });
    if (modelsDirty) {
      nextProfile = { ...nextProfile, models: nextModels };
    }
  }

  const overrides = profile.modelOverrides;
  if (isRecord(overrides) && Object.prototype.hasOwnProperty.call(overrides, model)) {
    const entry = overrides[model];
    const record = isRecord(entry) ? entry : {};
    if (record.contextWindow !== contextWindow) {
      patched = true;
      nextProfile = {
        ...nextProfile,
        modelOverrides: { ...overrides, [model]: { ...record, contextWindow } },
      };
    }
  }

  if (!patched) return { providers, patched: false };
  return { providers: { ...providers, [provider]: nextProfile }, patched: true };
}

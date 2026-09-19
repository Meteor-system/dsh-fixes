const IMAGE = "image";
const TEXT = "text";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasImage(input: unknown): boolean {
  return Array.isArray(input) && input.includes(IMAGE);
}

function withImage(input: unknown): string[] {
  const next = Array.isArray(input)
    ? input.filter((item): item is string => typeof item === "string")
    : [];
  if (!next.includes(TEXT)) next.unshift(TEXT);
  if (!next.includes(IMAGE)) next.push(IMAGE);
  return next;
}

function patchNamedModel(modelId: string, entry: unknown): { entry: unknown; patched: boolean } {
  if (modelId.trim().length === 0) return { entry, patched: false };
  const record = isRecord(entry) ? entry : {};
  if (hasImage(record.input)) return { entry, patched: false };
  return {
    entry: {
      ...record,
      input: withImage(record.input),
    },
    patched: true,
  };
}

function patchModel(entry: unknown): { entry: unknown; patched: boolean } {
  if (!isRecord(entry) || typeof entry.id !== "string") {
    return { entry, patched: false };
  }
  return patchNamedModel(entry.id, entry);
}

export function patchProviders(providers: unknown): {
  providers: unknown;
  patched: number;
} {
  if (!isRecord(providers)) return { providers, patched: 0 };

  let patched = 0;
  let dirty = false;
  const next: Record<string, unknown> = {};

  for (const [route, profile] of Object.entries(providers)) {
    if (!isRecord(profile)) {
      next[route] = profile;
      continue;
    }

    let nextProfile: Record<string, unknown> = profile;

    if (!hasImage(profile.defaultInput)) {
      nextProfile = {
        ...nextProfile,
        defaultInput: withImage(profile.defaultInput),
      };
      patched += 1;
      dirty = true;
    }

    const models = profile.models;
    if (Array.isArray(models)) {
      let modelsDirty = false;
      const nextModels = models.map((model) => {
        const result = patchModel(model);
        if (result.patched) {
          patched += 1;
          modelsDirty = true;
        }
        return result.entry;
      });
      if (modelsDirty) {
        nextProfile = { ...nextProfile, models: nextModels };
        dirty = true;
      }
    }

    const overrides = profile.modelOverrides;
    if (isRecord(overrides)) {
      let overridesDirty = false;
      const nextOverrides: Record<string, unknown> = {};
      for (const [modelId, entry] of Object.entries(overrides)) {
        const result = patchNamedModel(modelId, entry);
        if (result.patched) {
          patched += 1;
          overridesDirty = true;
        }
        nextOverrides[modelId] = result.entry;
      }
      if (overridesDirty) {
        nextProfile = { ...nextProfile, modelOverrides: nextOverrides };
        dirty = true;
      }
    }

    next[route] = nextProfile;
  }

  return {
    providers: dirty ? next : providers,
    patched,
  };
}

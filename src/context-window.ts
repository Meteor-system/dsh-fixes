const SENTINEL_DEFAULT_WINDOWS = new Set([262144, 131072]);
const WORKING_WINDOW = 500_000;
const WORKING_MAX_TOKENS = 500_000;

type Capacity = {
  contextWindow: number;
  maxTokens: number;
};

const EXACT: Record<string, Capacity> = {
  "grok-4.3": { contextWindow: 1_000_000, maxTokens: 30_000 },
  "grok-4.5": { contextWindow: 500_000, maxTokens: 500_000 },
  "grok-4.6": { contextWindow: 500_000, maxTokens: 500_000 },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function modelCapacity(modelId: string): Capacity | undefined {
  const id = modelId.trim();
  if (id.length === 0) return undefined;
  const exact = EXACT[id];
  if (exact !== undefined) return exact;
  if (/^grok-4(\.|-|$)/i.test(id)) return { contextWindow: 500_000, maxTokens: 500_000 };
  return { contextWindow: WORKING_WINDOW, maxTokens: WORKING_MAX_TOKENS };
}

function applyCapacity(modelId: string, entry: unknown): { entry: unknown; patched: boolean } {
  const capacity = modelCapacity(modelId);
  if (capacity === undefined) return { entry, patched: false };
  const record = isRecord(entry) ? entry : {};
  const next = { ...record };
  let patched = false;
  if (typeof record.contextWindow !== "number") {
    next.contextWindow = capacity.contextWindow;
    patched = true;
  }
  if (typeof record.maxTokens !== "number") {
    next.maxTokens = capacity.maxTokens;
    patched = true;
  }
  return { entry: patched ? next : entry, patched };
}

function patchModel(entry: unknown): { entry: unknown; patched: boolean } {
  if (!isRecord(entry) || typeof entry.id !== "string") return { entry, patched: false };
  return applyCapacity(entry.id, entry);
}

export function patchContextWindows(providers: unknown): {
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

    if (SENTINEL_DEFAULT_WINDOWS.has(profile.defaultContextWindow as number)) {
      nextProfile = { ...nextProfile, defaultContextWindow: WORKING_WINDOW };
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
        const result = applyCapacity(modelId, entry);
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

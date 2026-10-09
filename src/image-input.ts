import { isImageAllowed } from "./model-capabilities.js";

const IMAGE = "image";
const TEXT = "text";

/** Per-model image records keyed by `route/model`. Only `true` lets a model receive images; a missing key means off. */
export type ImageAllowance = Record<string, boolean>;

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

function withoutImage(input: unknown): string[] {
  const next = Array.isArray(input)
    ? input.filter((item): item is string => typeof item === "string" && item !== IMAGE)
    : [];
  if (!next.includes(TEXT)) next.unshift(TEXT);
  return next;
}

function isOn(allow: ImageAllowance, route: string, modelId: string): boolean {
  return isImageAllowed(allow, route, modelId);
}

function patchNamedModel(
  modelId: string,
  entry: unknown,
  on: boolean,
): { entry: unknown; patched: boolean } {
  if (modelId.trim().length === 0) return { entry, patched: false };
  const record = isRecord(entry) ? entry : {};
  if (on) {
    if (hasImage(record.input)) return { entry, patched: false };
    return { entry: { ...record, input: withImage(record.input) }, patched: true };
  }
  // Already a non-empty text-only list: nothing to change. Anything else is pinned to text explicitly,
  // because an absent input would inherit the provider defaultInput.
  if (Array.isArray(record.input) && record.input.length > 0 && !hasImage(record.input)) {
    return { entry, patched: false };
  }
  return { entry: { ...record, input: withoutImage(record.input) }, patched: true };
}

function patchModel(
  route: string,
  entry: unknown,
  allow: ImageAllowance,
): { entry: unknown; patched: boolean } {
  if (!isRecord(entry) || typeof entry.id !== "string") {
    return { entry, patched: false };
  }
  return patchNamedModel(entry.id, entry, isOn(allow, route, entry.id));
}

/**
 * Image input is off by default. The provider defaultInput is kept text-only (this also removes the
 * image the earlier always-on default wrote), and only models recorded as on receive image.
 */
export function patchProviders(
  providers: unknown,
  allow: ImageAllowance = {},
): {
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
    const named = new Set<string>();

    if (hasImage(profile.defaultInput)) {
      nextProfile = {
        ...nextProfile,
        defaultInput: withoutImage(profile.defaultInput),
      };
      patched += 1;
      dirty = true;
    }

    const models = profile.models;
    if (Array.isArray(models)) {
      let modelsDirty = false;
      const nextModels = models.map((model) => {
        if (isRecord(model) && typeof model.id === "string") named.add(model.id);
        const result = patchModel(route, model, allow);
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
    const nextOverrides: Record<string, unknown> = isRecord(overrides) ? { ...overrides } : {};
    let overridesDirty = false;
    if (isRecord(overrides)) {
      for (const [modelId, entry] of Object.entries(overrides)) {
        named.add(modelId);
        const result = patchNamedModel(modelId, entry, isOn(allow, route, modelId));
        if (result.patched) {
          patched += 1;
          overridesDirty = true;
        }
        nextOverrides[modelId] = result.entry;
      }
    }

    // llm-pi-ai serves only the models a non-empty `models` list spells out, and it rejects modelOverrides
    // beside that list. A rejected write fails every patch in the same settings update, so a stale or
    // unlisted switch on such a route is skipped instead of written.
    const servesOwnList = Array.isArray(profile.models) && profile.models.length > 0;
    const prefix = `${route}/`;
    for (const [key, on] of Object.entries(allow)) {
      if (on !== true || !key.startsWith(prefix)) continue;
      const modelId = key.slice(prefix.length);
      if (modelId.length === 0 || named.has(modelId) || servesOwnList) continue;
      nextOverrides[modelId] = { input: [TEXT, IMAGE] };
      patched += 1;
      overridesDirty = true;
    }

    if (overridesDirty) {
      nextProfile = { ...nextProfile, modelOverrides: nextOverrides };
      dirty = true;
    }

    next[route] = nextProfile;
  }

  return {
    providers: dirty ? next : providers,
    patched,
  };
}

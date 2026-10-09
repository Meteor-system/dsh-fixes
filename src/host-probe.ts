export type ServiceSpec = {
  name: string;
  /** Methods the plugin calls on this service. A service missing any of them cannot be patched or used. */
  members: readonly string[];
};

export type ProbeReport = {
  ready: string[];
  missing: Array<{ name: string; reason: string }>;
};

/**
 * Checks, at startup, which Host services the plugin relies on are present and expose the methods it calls.
 * Each missing service is reported with a reason instead of failing later on an unrelated call.
 */
export function probeHostSurface(
  get: (name: string) => unknown,
  specs: readonly ServiceSpec[],
): ProbeReport {
  const ready: string[] = [];
  const missing: ProbeReport["missing"] = [];
  for (const spec of specs) {
    let service: unknown;
    try {
      service = get(spec.name);
    } catch (error) {
      missing.push({
        name: spec.name,
        reason: `lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    if (service === undefined || service === null) {
      missing.push({ name: spec.name, reason: "service unavailable" });
      continue;
    }
    const absent = spec.members.find(
      (member) => typeof (service as Record<string, unknown>)[member] !== "function",
    );
    if (absent !== undefined) {
      missing.push({ name: spec.name, reason: `missing method ${absent}` });
      continue;
    }
    ready.push(spec.name);
  }
  return { ready, missing };
}

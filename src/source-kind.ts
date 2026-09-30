type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** V4 forbids `kind: "plugin"`. Unknown plugins become `plugin:<name>`. */
const RENAMED_PRODUCERS: Record<string, string> = {
  compact: "compact-checkpoint",
  "tools-code-mode": "ptc-mode",
  "tools-ptc": "ptc-mode",
  "dsh-compaction-basic": "compact-basic",
  "@deepseek-ai/dsh-system-prompt": "runtime-context",
};

export const FIXES_PLUGIN = "dsh-fixes";
export const FIXES_SOURCE_KIND = `plugin:${FIXES_PLUGIN}`;

export function producerKindFromPlugin(plugin: string, role?: string): string {
  if (plugin === "@deepseek-ai/dsh-system-prompt" && role === "system") return "system-prompt";
  return RENAMED_PRODUCERS[plugin] ?? (plugin.includes(":") ? plugin : `plugin:${plugin}`);
}

export function sourcePluginName(source: unknown): string | undefined {
  if (!isRecord(source) || typeof source.kind !== "string") return undefined;
  if (source.kind === "plugin" && typeof source.plugin === "string") return source.plugin;
  if (source.kind === "compact-checkpoint") return "compact";
  if (source.kind.startsWith("plugin:")) return source.kind.slice("plugin:".length);
  return undefined;
}

export function rewriteRetiredPluginSource(source: unknown, role?: string): RecordValue | unknown {
  if (!isRecord(source) || source.kind !== "plugin") return source;
  const plugin = typeof source.plugin === "string" ? source.plugin : FIXES_PLUGIN;
  const rest = { ...source };
  delete rest.plugin;
  rest.kind = producerKindFromPlugin(plugin, role);
  return rest;
}

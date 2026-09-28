import z from "@deepseek-ai/schemastery";

/** 0.1.7 only projects `.volatile()` fields into editable forms. Older schemastery has no such method. */
function maybeVolatile<T>(schema: T): T {
  const candidate = schema as T & { volatile?: () => T };
  return typeof candidate.volatile === "function" ? candidate.volatile() : schema;
}

/**
 * Host Config schema for dsh 0.1.7. The profile entry id (`dsh-fixes`) is the
 * settings namespace; the client reads it through `ctx.configForms.get("dsh-fixes")`.
 */
export const Config = z.object({
  contextWindows: maybeVolatile(z.any().default({})),
  summarization: maybeVolatile(z.any().default(null)),
  compactionReserves: maybeVolatile(z.any().default({})),
  autoCompactEnabled: maybeVolatile(z.boolean().default(true)),
  sessionOverrides: maybeVolatile(z.any().default({})),
});

import { FIXES_SOURCE_KIND, rewriteRetiredPluginSource } from "./source-kind.js";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeUserMessage(value: unknown): value is RecordValue {
  return isRecord(value) && (
    isRecord(value.source)
    || Array.isArray(value.content)
    || typeof value.role === "string"
  );
}

const MISSING_SOURCE = {
  kind: FIXES_SOURCE_KIND,
  form: "missing-source",
} as const;

/**
 * `user/message` event data is the message itself.
 * Nested `{ message }` is the system/assistant/tool shape and leaves
 * `event.data.source` undefined — core then throws reading `kind`.
 */
export function unwrapUserMessageData(data: unknown): unknown {
  if (looksLikeUserMessage(data)) return data;
  if (isRecord(data) && looksLikeUserMessage(data.message)) return data.message;
  return data;
}

export function withUserMessageSource(data: unknown): RecordValue | unknown {
  const message = unwrapUserMessageData(data);
  if (!isRecord(message)) return data;
  if (isRecord(message.source)) {
    const source = rewriteRetiredPluginSource(message.source, typeof message.role === "string" ? message.role : undefined);
    return source === message.source ? message : { ...message, source };
  }
  return { ...message, source: { ...MISSING_SOURCE } };
}

export function userMessageAppendData(message: RecordValue): RecordValue {
  return withUserMessageSource(message) as RecordValue;
}

export function normalizeUserMessageEvent(event: unknown): unknown {
  if (!isRecord(event) || event.type !== "user/message") return event;
  const data = withUserMessageSource(event.data);
  return data === event.data ? event : { ...event, data };
}

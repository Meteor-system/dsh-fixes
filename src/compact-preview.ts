export type CompactPreviewNode = {
  seq: number;
  type: string;
  title: string;
  excerpt: string;
};

export type CompactPreview = {
  count: number;
  dropped: CompactPreviewNode[];
  line: string;
};

const EMPTY_LINE = "没有可压缩的较早消息";
const EXCERPT_LIMIT = 80;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function previewCompactDrop(nodes: CompactPreviewNode[]): CompactPreview {
  const firstIdx = nodes[0]?.type === "system/message" ? 1 : 0;
  const keepFromIdx = nodes.length - 1;
  if (keepFromIdx <= firstIdx) {
    return { count: 0, dropped: [], line: EMPTY_LINE };
  }
  const dropped = nodes.slice(firstIdx, keepFromIdx);
  return {
    count: dropped.length,
    dropped,
    line: `将压缩 ${dropped.length} 条较早消息`,
  };
}

function clipExcerpt(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= EXCERPT_LIMIT) return trimmed;
  return trimmed.slice(0, EXCERPT_LIMIT);
}

function eventText(event: unknown): string {
  if (!isRecord(event)) return "";
  const data = isRecord(event.data) ? event.data : event;
  if (typeof data.text === "string") return data.text;
  if (typeof data.content === "string") return data.content;
  return "";
}

function eventTitle(type: string): string {
  if (type === "system/message") return "系统";
  if (type === "user/message") return "用户";
  if (type === "assistant/message") return "助手";
  if (type === "tool/result" || type === "tool/call") return "工具";
  return type;
}

function roleToType(role: string): string {
  if (role === "system") return "system/message";
  if (role === "user") return "user/message";
  if (role === "assistant") return "assistant/message";
  if (role === "tool") return "tool/result";
  return role;
}

function nodesFromMessages(messages: unknown): CompactPreviewNode[] {
  if (!Array.isArray(messages)) return [];
  const result: CompactPreviewNode[] = [];
  for (const [index, message] of messages.entries()) {
    if (!isRecord(message)) continue;
    const role = typeof message.role === "string" ? message.role : "user";
    const type = role.includes("/") ? role : roleToType(role);
    result.push({
      seq: typeof message.seq === "number" ? message.seq : index,
      type,
      title: eventTitle(type),
      excerpt: clipExcerpt(eventText(message)),
    });
  }
  return result;
}

export function compactPreviewNodesFromSession(session: unknown): CompactPreviewNode[] {
  if (!isRecord(session)) return [];
  const surface = isRecord(session.surface) ? session.surface : undefined;
  const nodes = Array.isArray(surface?.nodes) ? surface.nodes : undefined;
  const eventAt = typeof session.eventAt === "function" ? session.eventAt : undefined;
  if (nodes !== undefined && eventAt !== undefined) {
    const result: CompactPreviewNode[] = [];
    for (const seqValue of nodes) {
      if (typeof seqValue !== "number") continue;
      const event = eventAt.call(session, seqValue);
      const type = isRecord(event) && typeof event.type === "string" ? event.type : "unknown";
      result.push({
        seq: seqValue,
        type,
        title: eventTitle(type),
        excerpt: clipExcerpt(eventText(event)),
      });
    }
    return result;
  }
  return nodesFromMessages(session.messages);
}

export function sessionIdOf(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (!isRecord(value)) return undefined;
  if (typeof value.id === "string" && value.id.length > 0) return value.id;
  if (typeof value.sessionId === "string" && value.sessionId.length > 0) return value.sessionId;
  return undefined;
}

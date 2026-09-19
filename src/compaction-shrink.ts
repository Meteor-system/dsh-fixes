const DEFAULT_BUDGET_CHARS = 120_000;
const MAX_BLOCK_CHARS = 8_000;
const IMAGE_PLACEHOLDER = "[image omitted for compaction]";
const TRUNCATION_MARK = "\n[truncated for compaction]";

type ContentBlock = { type?: string; text?: string; [key: string]: unknown };
type ChatMessage = { role?: string; content?: ContentBlock[] | string; [key: string]: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const keep = Math.max(0, maxChars - TRUNCATION_MARK.length);
  return `${text.slice(0, keep)}${TRUNCATION_MARK}`;
}

function shrinkBlock(block: ContentBlock): ContentBlock {
  if (block.type === "image") {
    return { type: "text", text: IMAGE_PLACEHOLDER };
  }
  if (block.type === "text" && typeof block.text === "string" && block.text.length > MAX_BLOCK_CHARS) {
    return { ...block, text: truncateText(block.text, MAX_BLOCK_CHARS) };
  }
  return block;
}

function shrinkMessage(message: ChatMessage): ChatMessage {
  if (typeof message.content === "string") {
    return {
      ...message,
      content: truncateText(message.content, MAX_BLOCK_CHARS),
    };
  }
  if (!Array.isArray(message.content)) return message;
  return {
    ...message,
    content: message.content.map((block) => (isRecord(block) ? shrinkBlock(block) : block)),
  };
}

function messageChars(message: ChatMessage): number {
  if (typeof message.content === "string") return message.content.length;
  if (!Array.isArray(message.content)) return 0;
  let total = 0;
  for (const block of message.content) {
    if (typeof block.text === "string") total += block.text.length;
  }
  return total;
}

function shrinkMessageToBudget(message: ChatMessage, budget: number): ChatMessage {
  if (messageChars(message) <= budget) return message;
  if (typeof message.content === "string") {
    return { ...message, content: truncateText(message.content, budget) };
  }
  if (!Array.isArray(message.content)) return message;
  let remaining = budget;
  const content: ContentBlock[] = [];
  for (const block of message.content) {
    if (typeof block.text !== "string") {
      content.push(block);
      continue;
    }
    if (remaining <= 0) break;
    content.push({ ...block, text: truncateText(block.text, remaining) });
    remaining -= Math.min(block.text.length, remaining);
  }
  return { ...message, content };
}

function fitBudget(messages: ChatMessage[], budget: number): ChatMessage[] {
  const kept: ChatMessage[] = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    const size = messageChars(message);
    if (kept.length > 0 && used + size > budget) break;
    if (size > budget - used) {
      kept.unshift(shrinkMessageToBudget(message, Math.max(0, budget - used)));
      break;
    }
    kept.unshift(message);
    used += size;
  }
  return kept.length > 0 ? kept : messages.slice(-1);
}

export function shrinkCompactionOptions<T extends { purpose?: string; messages?: unknown; tools?: unknown }>(
  options: T,
  budgetChars: number = DEFAULT_BUDGET_CHARS,
  summarization?: { provider: string; model: string } | null,
): T {
  if (options.purpose !== "compaction" || !Array.isArray(options.messages)) return options;
  const messages = (options.messages as ChatMessage[]).map(shrinkMessage);
  const fitted = fitBudget(messages, budgetChars);
  const next: T = { ...options, messages: fitted };
  delete (next as { tools?: unknown }).tools;
  if (summarization) {
    (next as T & { provider: string; model: string }).provider = summarization.provider;
    (next as T & { provider: string; model: string }).model = summarization.model;
  }
  return next;
}

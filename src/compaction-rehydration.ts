export const MAX_REHYDRATION_FILES = 20;
export const MAX_REHYDRATION_TOKENS = 20_000;

export type FileTouch = { path: string; order: number };
export type RehydrationItem = {
  kind: "file" | "todo" | "skill";
  name: string;
  text: string;
};

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// Dependency and out-of-workspace files are not the user's working context;
// the model reads them only when a tool call names them again.
export function isWorkspacePath(path: string, cwd: string | undefined): boolean {
  const normalized = path.replace(/\\/gu, "/");
  if (/(^|\/)node_modules\//u.test(normalized)) return false;
  if (/(^|\/)\.\.(\/|$)/u.test(normalized)) return false;
  const absolute = /^([a-zA-Z]:)?\//u.test(normalized);
  if (!absolute) return true;
  if (cwd === undefined || cwd.length === 0) return false;
  const root = cwd.replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
  return normalized.toLowerCase().startsWith(`${root}/`);
}

// The same file can be named with either separator or differing case; one entry per file.
function identityKey(path: string): string {
  return path.replace(/\\/gu, "/").toLowerCase();
}

export function selectRecentFileTouches(touches: readonly FileTouch[], cwd?: string): string[] {
  const newest = new Map<string, FileTouch>();
  for (const touch of touches) {
    if (!nonEmptyString(touch.path) || !Number.isFinite(touch.order)) continue;
    if (!isWorkspacePath(touch.path, cwd)) continue;
    const key = identityKey(touch.path);
    const previous = newest.get(key);
    if (previous === undefined || touch.order >= previous.order) newest.set(key, touch);
  }
  return [...newest.values()]
    .sort((left, right) => right.order - left.order)
    .slice(0, MAX_REHYDRATION_FILES)
    .map((touch) => touch.path);
}

export function todoItemsFromProjection(value: unknown): RehydrationItem | undefined {
  const todos = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.todos) ? value.todos : undefined;
  if (todos === undefined) return undefined;
  const lines: string[] = [];
  for (const todo of todos) {
    if (!isRecord(todo) || typeof todo.content !== "string" || todo.content.length === 0) continue;
    const status = todo.status === "pending" || todo.status === "in_progress" || todo.status === "completed" ? todo.status : "pending";
    lines.push(`[${status}] ${todo.content}`);
  }
  if (lines.length === 0) return undefined;
  return { kind: "todo", name: "current todos", text: lines.join("\n") };
}

const ITEM_PRIORITY: Record<RehydrationItem["kind"], number> = {
  file: 0,
  todo: 1,
  skill: 2,
};

function sectionFor(item: RehydrationItem): { name: string; text: string } {
  return { name: `${item.kind}:${item.name}`, text: item.text };
}

function tokenEstimate(text: string): number {
  return Math.ceil(text.length / 4);
}

export function renderRehydrationMessage(items: readonly RehydrationItem[], tokenLimit: number): unknown {
  if (!Number.isFinite(tokenLimit) || tokenLimit <= 0) return undefined;
  const ordered = items
    .filter((item) => item.name.length > 0 && item.text.length > 0)
    .map((item, index) => ({ item, index }))
    .sort((left, right) => ITEM_PRIORITY[left.item.kind] - ITEM_PRIORITY[right.item.kind] || left.index - right.index)
    .map(({ item }) => item);
  const header = "## Rehydration snapshot";
  const selected: Array<{ name: string; text: string }> = [];
  let used = tokenEstimate(`${header}\n`);
  for (const item of ordered) {
    const section = sectionFor(item);
    const rendered = `### ${section.name}\n${section.text}\n`;
    const cost = tokenEstimate(rendered);
    if (used + cost > tokenLimit) continue;
    selected.push(section);
    used += cost;
  }
  if (selected.length === 0) return undefined;
  // Bodies live only in `content`; `source` keeps section names so the log
  // stores each snapshot body once.
  const text = [header, ...selected.map((section) => `### ${section.name}\n${section.text}`)].join("\n\n");
  return {
    role: "user",
    content: [{ type: "text", text }],
    source: {
      kind: "plugin:dsh-fixes",
      form: "snapshot",
      sections: selected.map((section) => section.name),
    },
  };
}

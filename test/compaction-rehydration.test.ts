import { describe, expect, it } from "vitest";
import {
  MAX_REHYDRATION_FILES,
  renderRehydrationMessage,
  selectRecentFileTouches,
  todoItemsFromProjection,
  type RehydrationItem,
} from "../src/compaction-rehydration.ts";
import { fileTouchesFromEvents, skillItemsFromEvents } from "../src/compaction-history.ts";

describe("selectRecentFileTouches", () => {
  it("deduplicates by newest touch, newest first", () => {
    expect(selectRecentFileTouches([
      { path: "a.ts", order: 1 },
      { path: "b.ts", order: 2 },
      { path: "a.ts", order: 3 },
      { path: "c.ts", order: 4 },
    ])).toEqual(["c.ts", "a.ts", "b.ts"]);
  });

  it("treats one file named with different separators or case as a single entry", () => {
    expect(selectRecentFileTouches([
      { path: "D:\\Code\\Dsh\\dsh-fixes\\test\\a.test.ts", order: 1 },
      { path: "D:/Code/Dsh/dsh-fixes/test/a.test.ts", order: 2 },
      { path: "d:\\code\\dsh\\dsh-fixes\\TEST\\A.test.ts", order: 3 },
    ], "D:\\Code\\Dsh")).toEqual(["d:\\code\\dsh\\dsh-fixes\\TEST\\A.test.ts"]);
  });

  it("caps the list at the path budget", () => {
    const touches = Array.from({ length: MAX_REHYDRATION_FILES + 5 }, (_, index) => ({ path: `f${index}.ts`, order: index }));
    const selected = selectRecentFileTouches(touches);
    expect(selected).toHaveLength(MAX_REHYDRATION_FILES);
    expect(selected[0]).toBe(`f${MAX_REHYDRATION_FILES + 4}.ts`);
  });

  it("drops dependency files and paths outside the workspace", () => {
    const cwd = "D:\\Code\\Dsh\\dsh-fixes";
    expect(selectRecentFileTouches([
      { path: "C:\\Users\\Meteor\\AppData\\Local\\npm-cache\\_npx\\x\\node_modules\\@deepseek-ai\\dsh-commands\\lib\\index.js", order: 1 },
      { path: "D:\\Code\\Dsh\\dsh-fixes\\src\\index.ts", order: 2 },
      { path: "D:/Code/Dsh/dsh-fixes/test/a.ts", order: 3 },
      { path: "D:\\Code\\Other\\secret.ts", order: 4 },
      { path: "../outside.ts", order: 5 },
      { path: "src/compaction-history.ts", order: 6 },
      { path: "node_modules/pkg/index.js", order: 7 },
    ], cwd)).toEqual([
      "src/compaction-history.ts",
      "D:/Code/Dsh/dsh-fixes/test/a.ts",
      "D:\\Code\\Dsh\\dsh-fixes\\src\\index.ts",
    ]);
  });
});

const call = (seq: number, callId: string, name: string, args: unknown) => ({
  type: "tool/call",
  seq,
  data: { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) },
});
const result = (seq: number, callId: string, text: string, error?: unknown) => ({
  type: "tool/result",
  seq,
  data: {
    turn: 1,
    step: 1,
    message: { role: "tool", toolCallId: callId, content: [{ type: "text", text }] },
    ...(error === undefined ? {} : { error }),
  },
});

describe("fileTouchesFromEvents", () => {
  it("keeps successful read/write/edit calls in log order and drops failures", () => {
    expect(fileTouchesFromEvents([
      call(1, "c1", "read", { file_path: "a.ts" }), result(2, "c1", "ok"),
      call(3, "c2", "edit", { file_path: "b.ts" }), result(4, "c2", "boom", { name: "E", code: "x" }),
      call(5, "c3", "write", { file_path: "c.ts" }), result(6, "c3", "ok"),
      call(7, "c4", "bash", { command: "ls" }), result(8, "c4", "ok"),
    ])).toEqual([
      { path: "a.ts", order: 1 },
      { path: "c.ts", order: 5 },
    ]);
  });

  it("ignores calls whose result never arrived", () => {
    expect(fileTouchesFromEvents([call(1, "c1", "read", { file_path: "a.ts" })])).toEqual([]);
  });
});

describe("skillItemsFromEvents", () => {
  it("returns the latest successful load per skill, even when the call is older than a compaction", () => {
    expect(skillItemsFromEvents([
      { type: "compaction/end", seq: 0, data: { compactionId: "x" } },
      call(1, "s1", "skill", { name: "tdd" }), result(2, "s1", "<skill_content name=\"tdd\">v1</skill_content>"),
      call(3, "s2", "skill", { name: "old" }), result(4, "s2", "old body"),
      call(5, "s3", "skill", { name: "tdd" }), result(6, "s3", "<skill_content name=\"tdd\">v2</skill_content>"),
      call(7, "s4", "skill", { name: "broken" }), result(8, "s4", "nope", { name: "E", code: "x" }),
    ])).toEqual([
      { kind: "skill", name: "old", text: "old body" },
      { kind: "skill", name: "tdd", text: "<skill_content name=\"tdd\">v2</skill_content>" },
    ]);
  });

  it("reads durable skill-invocation user messages from the log", () => {
    expect(skillItemsFromEvents([
      {
        type: "user/message",
        seq: 1,
        data: {
          source: { kind: "skill-invocation", name: "pdf", form: "instructions" },
          content: [{ type: "text", text: "pdf body" }],
        },
      },
    ])).toEqual([{ kind: "skill", name: "pdf", text: "pdf body" }]);
  });
});
describe("todoItemsFromProjection", () => {
  it("renders the latest todo projection as one item", () => {
    expect(todoItemsFromProjection({
      todos: [
        { content: "implement", status: "in_progress" },
        { content: "verify", status: "pending" },
      ],
    })).toEqual({
      kind: "todo",
      name: "current todos",
      text: "[in_progress] implement\n[pending] verify",
    });
    expect(todoItemsFromProjection({ todos: [] })).toBeUndefined();
  });
});

describe("renderRehydrationMessage", () => {
  it("keeps stable priority sections in one snapshot message", () => {
    const result = renderRehydrationMessage([
      { kind: "skill", name: "tdd", text: "skill body" },
      { kind: "file", name: "src/index.ts", text: "file body" },
      { kind: "todo", name: "current todos", text: "[pending] verify" },
    ], 1000) as {
      role: string;
      content: Array<{ type: string; text: string }>;
      source: { form: string; sections: string[] };
    };
    expect(result.role).toBe("user");
    expect(result.source.form).toBe("snapshot");
    expect((result.source as { kind: string }).kind).toBe("plugin:dsh-fixes");
    expect(result.source.sections).toEqual([
      "file:src/index.ts",
      "todo:current todos",
      "skill:tdd",
    ]);
    expect(result.content[0]?.text).toContain("## Rehydration snapshot");
  });

  it("stores section bodies only in the message text, not duplicated in source", () => {
    const result = renderRehydrationMessage([
      { kind: "file", name: "src/index.ts", text: "UNIQUE_BODY_MARKER" },
    ], 1000) as { content: Array<{ text: string }>; source: unknown };
    expect(result.content[0]?.text).toContain("UNIQUE_BODY_MARKER");
    expect(JSON.stringify(result.source)).not.toContain("UNIQUE_BODY_MARKER");
  });

  it("omits items that do not fit the shared token budget", () => {
    const items: RehydrationItem[] = [
      { kind: "file", name: "huge.ts", text: "x".repeat(1000) },
      { kind: "todo", name: "current todos", text: "small" },
    ];
    const result = renderRehydrationMessage(items, 20) as {
      source: { sections: string[] };
    } | undefined;
    expect(result?.source.sections).toEqual(["todo:current todos"]);
    expect(renderRehydrationMessage([{ kind: "file", name: "huge.ts", text: "x".repeat(1000) }], 1)).toBeUndefined();
  });
});

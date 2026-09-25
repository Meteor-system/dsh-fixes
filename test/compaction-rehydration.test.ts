import { describe, expect, it } from "vitest";
import {
  renderRehydrationMessage,
  selectRecentFileTouches,
  skillBodiesFromSession,
  todoItemsFromProjection,
  type RehydrationItem,
} from "../src/compaction-rehydration.ts";

describe("selectRecentFileTouches", () => {
  it("deduplicates by newest touch and caps the result at five files", () => {
    expect(selectRecentFileTouches([
      { path: "a.ts", order: 1 },
      { path: "b.ts", order: 2 },
      { path: "a.ts", order: 3 },
      { path: "c.ts", order: 4 },
      { path: "d.ts", order: 5 },
      { path: "e.ts", order: 6 },
      { path: "f.ts", order: 7 },
    ])).toEqual(["f.ts", "e.ts", "d.ts", "c.ts", "a.ts"]);
  });
});

describe("skillBodiesFromSession", () => {
  it("extracts persisted instruction bodies without reading the workspace", () => {
    expect(skillBodiesFromSession({
      deriveMessages: () => [
        {
          source: { kind: "skill-invocation", name: "old", form: "instructions" },
          content: [{ type: "text", text: "old body" }],
        },
        {
          source: { kind: "skill-invocation", name: "tdd", form: "instructions" },
          content: [{ type: "text", text: "tdd body" }],
        },
      ],
    })).toEqual([
      { kind: "skill", name: "old", text: "old body" },
      { kind: "skill", name: "tdd", text: "tdd body" },
    ]);
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
      source: { form: string; sections: Array<{ name: string; text: string }> };
    };
    expect(result.role).toBe("user");
    expect(result.source.form).toBe("snapshot");
    expect(result.source.sections.map((section) => section.name)).toEqual([
      "file:src/index.ts",
      "todo:current todos",
      "skill:tdd",
    ]);
    expect(result.content[0]?.text).toContain("## Rehydration snapshot");
  });

  it("omits items that do not fit the shared token budget", () => {
    const items: RehydrationItem[] = [
      { kind: "file", name: "huge.ts", text: "x".repeat(1000) },
      { kind: "todo", name: "current todos", text: "small" },
    ];
    const result = renderRehydrationMessage(items, 20) as {
      source: { sections: Array<{ name: string }> };
    } | undefined;
    expect(result?.source.sections.map((section) => section.name)).toEqual(["todo:current todos"]);
    expect(renderRehydrationMessage([{ kind: "file", name: "huge.ts", text: "x".repeat(1000) }], 1)).toBeUndefined();
  });
});

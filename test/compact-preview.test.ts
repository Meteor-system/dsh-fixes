import { describe, expect, it } from "vitest";
import {
  compactPreviewNodesFromSession,
  previewCompactDrop,
  sessionIdOf,
  type CompactPreviewNode,
} from "../src/compact-preview.ts";

function node(seq: number, type: string, title: string): CompactPreviewNode {
  return { seq, type, title, excerpt: title };
}

describe("previewCompactDrop", () => {
  it("keeps a leading system message and the last node", () => {
    const nodes = [
      node(0, "system/message", "系统"),
      node(1, "user/message", "第一问"),
      node(2, "assistant/message", "第一答"),
      node(3, "user/message", "第二问"),
    ];
    const preview = previewCompactDrop(nodes);
    expect(preview.count).toBe(2);
    expect(preview.dropped.map((item) => item.title)).toEqual(["第一问", "第一答"]);
    expect(preview.line).toBe("将压缩 2 条较早消息");
  });

  it("reports nothing to drop when only a system head and one message remain", () => {
    const preview = previewCompactDrop([node(0, "system/message", "系统"), node(1, "user/message", "仅一条")]);
    expect(preview.count).toBe(0);
    expect(preview.dropped).toEqual([]);
    expect(preview.line).toBe("没有可压缩的较早消息");
  });
});

describe("compactPreviewNodesFromSession", () => {
  it("reads surface nodes and event text", () => {
    const events = [
      { type: "system/message", data: { text: "you are helpful" } },
      { type: "user/message", data: { text: "hello world from a long prompt that should be clipped" } },
      { type: "assistant/message", data: { text: "hi" } },
    ];
    const session = {
      surface: { nodes: [0, 1, 2] },
      eventAt: (seq: number) => events[seq],
    };
    const nodes = compactPreviewNodesFromSession(session);
    expect(nodes.map((item) => item.type)).toEqual(["system/message", "user/message", "assistant/message"]);
    expect(nodes[1]?.title).toBe("用户");
    expect(nodes[1]?.excerpt.length).toBeGreaterThan(0);
    expect(nodes[1]?.excerpt.length).toBeLessThanOrEqual(80);
  });

  it("falls back to a messages array when the live surface is missing", () => {
    const nodes = compactPreviewNodesFromSession({
      messages: [
        { role: "system", text: "sys" },
        { role: "user", text: "hello" },
        { role: "assistant", text: "hi" },
      ],
    });
    expect(nodes.map((item) => item.type)).toEqual(["system/message", "user/message", "assistant/message"]);
  });
});

describe("sessionIdOf", () => {
  it("reads a string id from the session or slot", () => {
    expect(sessionIdOf("sess-1")).toBe("sess-1");
    expect(sessionIdOf({ id: "sess-2" })).toBe("sess-2");
    expect(sessionIdOf({ sessionId: "sess-3" })).toBe("sess-3");
    expect(sessionIdOf({})).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import {
  normalizeUserMessageEvent,
  unwrapUserMessageData,
  userMessageAppendData,
  withUserMessageSource,
} from "../src/user-message-event.ts";

describe("unwrapUserMessageData", () => {
  it("keeps the canonical user/message payload", () => {
    const message = { role: "user", content: [], source: { kind: "user" } };
    expect(unwrapUserMessageData(message)).toBe(message);
  });

  it("unwraps the nested system-message-shaped payload", () => {
    const message = { role: "user", content: [{ type: "text", text: "snap" }], source: { kind: "plugin" } };
    expect(unwrapUserMessageData({ message })).toBe(message);
  });
});

describe("withUserMessageSource", () => {
  it("rewrites retired v3 plugin wrappers to producer-owned kinds", () => {
    expect(withUserMessageSource({
      role: "user",
      content: [],
      source: { kind: "plugin", plugin: "dsh-fixes", form: "snapshot" },
    })).toEqual({
      role: "user",
      content: [],
      source: { kind: "plugin:dsh-fixes", form: "snapshot" },
    });
  });

  it("fills a missing source so core can read kind", () => {
    expect(withUserMessageSource({ role: "user", content: [] })).toEqual({
      role: "user",
      content: [],
      source: { kind: "plugin:dsh-fixes", form: "missing-source" },
    });
  });
});

describe("userMessageAppendData", () => {
  it("does not nest the message under data.message", () => {
    const message = {
      role: "user",
      content: [{ type: "text", text: "snap" }],
      source: { kind: "plugin:dsh-fixes", form: "snapshot" },
    };
    expect(userMessageAppendData(message)).toEqual(message);
    expect(userMessageAppendData(message)).not.toHaveProperty("message");
  });
});

describe("normalizeUserMessageEvent", () => {
  it("makes hasPromptRequest-style source.kind reads safe", () => {
    const event = normalizeUserMessageEvent({
      type: "user/message",
      data: { message: { role: "user", content: [{ type: "text", text: "snap" }] } },
    }) as { data: { source: { kind: string } } };
    expect(event.data.source.kind).toBe("plugin:dsh-fixes");
  });

  it("leaves other event types alone", () => {
    const event = { type: "assistant/message", data: { message: { role: "assistant" } } };
    expect(normalizeUserMessageEvent(event)).toBe(event);
  });
});

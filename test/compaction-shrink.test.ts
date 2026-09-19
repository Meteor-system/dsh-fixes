import { describe, expect, it } from "vitest";
import { shrinkCompactionOptions } from "../src/compaction-shrink.ts";

describe("shrinkCompactionOptions", () => {
  it("is a no-op for non-compaction calls", () => {
    const options = {
      purpose: "chat",
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    };
    expect(shrinkCompactionOptions(options)).toBe(options);
  });

  it("replaces image blocks so an overflowed multimodal session can still summarize", () => {
    const result = shrinkCompactionOptions({
      purpose: "compaction",
      tools: [{ name: "read_image" }],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "image", attachment: { attachmentId: "a" } },
          ],
        },
      ],
    });

    expect(result.tools).toBeUndefined();
    expect(result.messages[0].content).toEqual([
      { type: "text", text: "look" },
      { type: "text", text: "[image omitted for compaction]" },
    ]);
  });

  it("truncates oversized text so the summarizer request fits", () => {
    const huge = "x".repeat(80_000);
    const result = shrinkCompactionOptions({
      purpose: "compaction",
      messages: [
        { role: "user", content: [{ type: "text", text: huge }] },
        { role: "user", content: [{ type: "text", text: "COMPACT NOW" }] },
      ],
    }, 20_000);

    const texts = result.messages.flatMap((message: { content: Array<{ text?: string }> }) =>
      message.content.map((block) => block.text ?? ""),
    );
    expect(texts.at(-1)).toBe("COMPACT NOW");
    expect(texts.join("").length).toBeLessThan(25_000);
    expect(texts.some((text: string) => text.includes("[truncated for compaction]"))).toBe(true);
  });

  it("routes compaction calls to the configured summarizer", () => {
    const result = shrinkCompactionOptions(
      {
        purpose: "compaction",
        provider: "routincodex",
        model: "grok-4.6",
        messages: [{ role: "user", content: [{ type: "text", text: "sum" }] }],
      },
      undefined,
      { provider: "routincodex", model: "gpt-5.4-mini" },
    );
    expect(result.provider).toBe("routincodex");
    expect(result.model).toBe("gpt-5.4-mini");
  });
});

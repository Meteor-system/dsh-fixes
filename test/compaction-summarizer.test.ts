import { describe, expect, it } from "vitest";
import {
  applyCompactionRoute,
  hasVisibleStreamOutput,
  isPromptTooLongFailure,
  retryCompactionStream,
  trimOldestCompleteTurns,
  type CompactionStreamOptions,
} from "../src/compaction-summarizer.ts";

async function collect(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const values: unknown[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

function stream(values: unknown[], failure?: unknown): (options: CompactionStreamOptions) => AsyncIterable<unknown> {
  return async function* () {
    for (const value of values) yield value;
    if (failure !== undefined) throw failure;
  };
}

const system = { role: "system", content: [{ type: "text", text: "system" }] };
const finalInstruction = { role: "user", content: [{ type: "text", text: "COMPACT NOW" }] };

function completeToolTurn() {
  return [
    { role: "user", content: [{ type: "text", text: "first request" }] },
    {
      role: "assistant",
      content: [{ type: "tool-call", id: "call-1", name: "read", arguments: "{}" }],
    },
    {
      role: "user",
      source: { kind: "tool", callId: "call-1" },
      content: [{ type: "tool-result", callId: "call-1", content: [{ type: "text", text: "file" }], isError: false }],
    },
    { role: "assistant", content: [{ type: "text", text: "first answer" }] },
  ];
}

describe("applyCompactionRoute", () => {
  it("leaves non-compaction options untouched", () => {
    const options = { purpose: "chat", messages: [system] };
    expect(applyCompactionRoute(options, { provider: "p", model: "m" })).toBe(options);
  });

  it("routes compaction calls to the configured summarizer without changing messages or tools", () => {
    const messages = [system, finalInstruction];
    const tools = [{ name: "read" }];
    const options = { purpose: "compaction", provider: "old-p", model: "old-m", messages, tools };
    const result = applyCompactionRoute(options, { provider: "new-p", model: "new-m" });
    expect(result).not.toBe(options);
    expect(result.provider).toBe("new-p");
    expect(result.model).toBe("new-m");
    expect(result.messages).toBe(messages);
    expect(result.tools).toBe(tools);
  });
});

describe("isPromptTooLongFailure", () => {
  it("recognizes canonical codes and conservative messages", () => {
    expect(isPromptTooLongFailure({ code: "CONTEXT_WINDOW_EXCEEDED" })).toBe(true);
    expect(isPromptTooLongFailure({ code: "PROMPT_TOO_LONG" })).toBe(true);
    expect(isPromptTooLongFailure({ cause: { message: "maximum context length exceeded" } })).toBe(true);
    expect(isPromptTooLongFailure({ message: "provider authentication failed" })).toBe(false);
  });
});

describe("hasVisibleStreamOutput", () => {
  it("counts text, reasoning, and tool-call output but not control chunks", () => {
    expect(hasVisibleStreamOutput({ type: "usage", usage: {} })).toBe(false);
    expect(hasVisibleStreamOutput({ type: "finish", reason: "error" })).toBe(false);
    expect(hasVisibleStreamOutput({ type: "text-delta", text: "answer" })).toBe(true);
    expect(hasVisibleStreamOutput({ type: "reasoning-delta", text: "thinking" })).toBe(true);
    expect(hasVisibleStreamOutput({ type: "tool-call-delta", id: "call-1", argumentsDelta: "{}" })).toBe(true);
    expect(hasVisibleStreamOutput({ type: "text-delta", text: "" })).toBe(false);
  });
});

describe("trimOldestCompleteTurns", () => {
  it("removes the oldest complete turn while preserving the final instruction and tool pair", () => {
    const messages = [system, ...completeToolTurn(), finalInstruction];
    const trimmed = trimOldestCompleteTurns(messages);
    expect(trimmed).toEqual([system, finalInstruction]);
  });

  it("removes an ordinary oldest turn", () => {
    expect(trimOldestCompleteTurns([
      system,
      { role: "user", content: [{ type: "text", text: "old" }] },
      { role: "assistant", content: [{ type: "text", text: "answer" }] },
      finalInstruction,
    ])).toEqual([system, finalInstruction]);
  });

  it("returns the original messages when no complete turn can be removed", () => {
    const messages = [system, finalInstruction];
    expect(trimOldestCompleteTurns(messages)).toEqual(messages);
  });
});

describe("retryCompactionStream", () => {
  it("keeps the first compaction request complete and retries once after a zero-output overflow", async () => {
    const messages = [system, ...completeToolTurn(), finalInstruction];
    const tools = [{ name: "read" }];
    const attempts: CompactionStreamOptions[] = [];
    const original = (options: CompactionStreamOptions) => {
      attempts.push(options);
      if (attempts.length === 1) return stream([], { code: "CONTEXT_WINDOW_EXCEEDED" })(options);
      return stream([{ type: "finish", reason: "stop" }])(options);
    };

    const output = await collect(retryCompactionStream(original, {
      purpose: "compaction",
      messages,
      tools,
    }));

    expect(output).toEqual([{ type: "finish", reason: "stop" }]);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.messages).toBe(messages);
    expect(attempts[0]?.tools).toBe(tools);
    expect(attempts[1]?.messages).toEqual([system, finalInstruction]);
    expect(attempts[1]?.tools).toBe(tools);
  });

  it("does not retry after partial output", async () => {
    let calls = 0;
    const original = (options: CompactionStreamOptions) => {
      calls += 1;
      return stream([{ type: "text-delta", text: "partial" }], { code: "PROMPT_TOO_LONG" })(options);
    };

    await expect(collect(retryCompactionStream(original, {
      purpose: "compaction",
      messages: [system, ...completeToolTurn(), finalInstruction],
    }))).rejects.toMatchObject({ code: "PROMPT_TOO_LONG" });
    expect(calls).toBe(1);
  });

  it("does not retry unrelated failures or an untrimable request", async () => {
    let calls = 0;
    const original = (options: CompactionStreamOptions) => {
      calls += 1;
      return stream([], { code: "AUTH_FAILED" })(options);
    };
    await expect(collect(retryCompactionStream(original, {
      purpose: "compaction",
      messages: [system, finalInstruction],
    }))).rejects.toMatchObject({ code: "AUTH_FAILED" });
    expect(calls).toBe(1);
  });
});

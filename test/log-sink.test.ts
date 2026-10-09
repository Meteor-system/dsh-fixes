import { describe, expect, it } from "vitest";
import { createLogSink, formatDiag, formatLogArgs, resolveLogFile, type FsLike } from "../src/log.ts";

function fakeFs(initialSize?: number) {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const fs: FsLike = {
    append: (path, text) => {
      calls.push({ op: "append", args: [path, text] });
    },
    size: (path) => {
      calls.push({ op: "size", args: [path] });
      return initialSize;
    },
    rotate: (from, to) => {
      calls.push({ op: "rotate", args: [from, to] });
    },
    ensureDir: (dir) => {
      calls.push({ op: "ensureDir", args: [dir] });
    },
  };
  return { fs, calls };
}

describe("resolveLogFile", () => {
  it("places the log under the profile logs directory when DSH_PROFILE_DIR is set", () => {
    expect(resolveLogFile({ DSH_PROFILE_DIR: "C:\\profiles\\web" })).toBe(
      "C:\\profiles\\web\\logs\\dsh-fixes.log",
    );
  });

  it("returns nothing when no profile directory is known", () => {
    expect(resolveLogFile({})).toBeUndefined();
  });
});

describe("createLogSink", () => {
  it("does not touch the filesystem when no file is configured", () => {
    const { fs, calls } = fakeFs();
    const sink = createLogSink({ file: undefined, fs });
    sink.write("hello");
    expect(calls).toEqual([]);
  });

  it("appends one newline-terminated line per write", () => {
    const { fs, calls } = fakeFs(0);
    const sink = createLogSink({ file: "x/dsh-fixes.log", fs });
    sink.write("first");
    sink.write("second");
    const appends = calls.filter((call) => call.op === "append").map((call) => call.args);
    expect(appends).toEqual([
      ["x/dsh-fixes.log", "first\n"],
      ["x/dsh-fixes.log", "second\n"],
    ]);
  });

  it("rotates the file once it reaches the size limit", () => {
    const { fs, calls } = fakeFs(10);
    const sink = createLogSink({ file: "x/dsh-fixes.log", maxBytes: 10, fs });
    sink.write("after rotation");
    const rotate = calls.find((call) => call.op === "rotate");
    expect(rotate?.args).toEqual(["x/dsh-fixes.log", "x/dsh-fixes.log.1"]);
    expect(calls.findIndex((call) => call.op === "rotate")).toBeLessThan(
      calls.findIndex((call) => call.op === "append"),
    );
  });

  it("reports a failure once, never throws, and stops attempting the file afterwards", () => {
    const reports: string[] = [];
    let attempts = 0;
    const fs: FsLike = {
      append: () => {
        attempts += 1;
        throw new Error("disk full");
      },
      size: () => 0,
      rotate: () => undefined,
      ensureDir: () => undefined,
    };
    const sink = createLogSink({
      file: "x/dsh-fixes.log",
      fs,
      onFailure: (message) => reports.push(message),
    });
    expect(() => {
      sink.write("one");
      sink.write("two");
      sink.write("three");
    }).not.toThrow();
    expect(reports).toEqual(["disk full"]);
    expect(attempts).toBe(1);
  });
});

describe("formatLogArgs and formatDiag", () => {
  it("joins plain values and reads the message of an Error", () => {
    expect(formatLogArgs(["fill error:", new Error("timed out")])).toBe("fill error: timed out");
  });

  it("renders a diagnostic as a stage followed by JSON detail", () => {
    expect(formatDiag("postCompaction", { committed: true })).toBe(
      '[diag] postCompaction {"committed":true}',
    );
  });
});

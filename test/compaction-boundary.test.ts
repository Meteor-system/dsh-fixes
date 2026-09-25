import { describe, expect, it } from "vitest";
import {
  findActiveCompactionBoundary,
  isCompactBoundarySource,
  surfaceCutBeforeBoundary,
} from "../src/compaction-boundary.ts";

type TestEvent = {
  type: string;
  data?: { source?: unknown; text?: string };
};

function session(events: Record<number, TestEvent>, nodes: number[] = Object.keys(events).map(Number)) {
  return {
    surface: { nodes },
    eventAt: (seq: number) => events[seq],
  };
}

describe("isCompactBoundarySource", () => {
  it("recognizes legacy and future plugin sources", () => {
    expect(isCompactBoundarySource({ kind: "plugin", plugin: "compact", compactionId: "compact-1" })).toBe(true);
    expect(
      isCompactBoundarySource({
        kind: "plugin",
        plugin: "compact_boundary",
        boundaryId: "boundary-1",
        formatVersion: 1,
        coveredStartSeq: 4,
        coveredEndSeq: 12,
      }),
    ).toBe(true);
    expect(isCompactBoundarySource({ kind: "plugin", plugin: "compact_boundary" })).toBe(true);
  });

  it("rejects unrelated and malformed sources", () => {
    expect(isCompactBoundarySource({ kind: "tool", plugin: "compact", compactionId: "compact-1" })).toBe(false);
    expect(isCompactBoundarySource({ kind: "plugin", plugin: "other", compactionId: "compact-1" })).toBe(false);
    expect(isCompactBoundarySource({ kind: "plugin", plugin: "compact", compactionId: "" })).toBe(false);
    expect(isCompactBoundarySource({ kind: "plugin", plugin: "compact_boundary", boundaryId: "" })).toBe(false);
    expect(isCompactBoundarySource({ kind: "plugin", plugin: "compact_boundary", formatVersion: "1" })).toBe(false);
    expect(isCompactBoundarySource({ kind: "plugin", plugin: "compact_boundary", coveredStartSeq: -1 })).toBe(false);
    expect(
      isCompactBoundarySource({
        kind: "plugin",
        plugin: "compact_boundary",
        coveredStartSeq: 12,
        coveredEndSeq: 4,
      }),
    ).toBe(false);
    expect(isCompactBoundarySource(null)).toBe(false);
  });
});

describe("findActiveCompactionBoundary", () => {
  it("selects the newest valid boundary on the current surface", () => {
    const result = findActiveCompactionBoundary(
      session({
        0: { type: "system/message" },
        1: { type: "user/message", data: { source: { kind: "plugin", plugin: "compact", compactionId: "legacy" } } },
        2: {
          type: "user/message",
          data: {
            source: {
              kind: "plugin",
              plugin: "compact_boundary",
              boundaryId: "boundary-1",
              formatVersion: 1,
              coveredStartSeq: 1,
              coveredEndSeq: 1,
            },
          },
        },
        3: { type: "user/message", data: { source: { kind: "plugin", plugin: "compact_boundary", boundaryId: "" } } },
      }),
    );
    expect(result).toEqual({
      seq: 2,
      boundaryId: "boundary-1",
      formatVersion: 1,
      coveredStartSeq: 1,
      coveredEndSeq: 1,
      legacy: false,
    });
  });

  it("reads a message source from a structural messages snapshot", () => {
    expect(
      findActiveCompactionBoundary({
        messages: [
          { role: "system", seq: 4 },
          { role: "user", seq: 9, source: { kind: "plugin", plugin: "compact", compactionId: "legacy" } },
        ],
      }),
    ).toEqual({ seq: 9, legacy: true });
  });

  it("reads the source from the actual user/message event shape", () => {
    expect(
      findActiveCompactionBoundary(
        session({
          0: { type: "system/message" },
          1: {
            type: "user/message",
            data: {
              message: {
                source: { kind: "plugin", plugin: "compact_boundary", boundaryId: "boundary-1", formatVersion: 1 },
              },
            },
          },
        }, [0, 1]),
      ),
    ).toEqual({ seq: 1, boundaryId: "boundary-1", formatVersion: 1, legacy: false });
  });

  it("fails closed when the session surface cannot be read", () => {
    expect(findActiveCompactionBoundary({ surface: { nodes: [1] }, eventAt: () => { throw new Error("gone"); } })).toBeUndefined();
    expect(findActiveCompactionBoundary({ surface: { nodes: [1] } })).toBeUndefined();
  });
});

describe("surfaceCutBeforeBoundary", () => {
  it("keeps a leading system head before the current boundary cut", () => {
    const value = session({
      4: { type: "system/message" },
      9: { type: "user/message", data: { source: { kind: "plugin", plugin: "compact_boundary", boundaryId: "boundary-1" } } },
      12: { type: "assistant/message" },
    }, [4, 9, 12]);
    expect(surfaceCutBeforeBoundary(value)).toBe(1);
  });

  it("uses the system-head cut when no boundary is present", () => {
    expect(surfaceCutBeforeBoundary(session({ 4: { type: "system/message" }, 12: { type: "user/message" } }, [4, 12]))).toBe(1);
    expect(surfaceCutBeforeBoundary(session({ 4: { type: "user/message" } }, [4]))).toBe(0);
  });

  it("returns an empty cut for an empty surface", () => {
    expect(surfaceCutBeforeBoundary({ surface: { nodes: [] }, eventAt: () => undefined })).toBe(0);
  });
});

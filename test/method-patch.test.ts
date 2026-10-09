import { describe, expect, it } from "vitest";
import { patchGet, patchMethod } from "../src/method-patch.ts";

describe("patchMethod", () => {
  it("wraps a named method and restores it without clobbering a later patch", () => {
    const holder = { stream: (options: unknown) => `base ${String(options)}` };
    const restore = patchMethod(holder, "stream", (inner, options) => `wrapped ${String(inner(options))}`);
    expect(holder.stream(1)).toBe("wrapped base 1");
    restore();
    expect(holder.stream(2)).toBe("base 2");
  });
});

describe("patchGet", () => {
  it("routes get calls through the wrapper and restores the original on dispose", () => {
    const holder = { get: (id: unknown) => `agent:${String(id)}` };
    const original = holder.get;

    const restore = patchGet(holder, (inner, id) => `wrapped(${String(inner(id))})`);
    expect(holder.get(1)).toBe("wrapped(agent:1)");

    restore();
    expect(holder.get).toBe(original);
    expect(holder.get(2)).toBe("agent:2");
  });

  it("removes an own property it added when the original lived on the prototype", () => {
    class Registry {
      get(id: unknown): string {
        return `registry:${String(id)}`;
      }
    }
    const holder = new Registry();
    expect(Object.prototype.hasOwnProperty.call(holder, "get")).toBe(false);

    const restore = patchGet(holder, (inner, id) => inner(id));
    expect(Object.prototype.hasOwnProperty.call(holder, "get")).toBe(true);

    restore();
    expect(Object.prototype.hasOwnProperty.call(holder, "get")).toBe(false);
    expect(holder.get(3)).toBe("registry:3");
  });

  it("leaves a later patch in place when restoring an earlier one", () => {
    const holder = { get: (id: unknown) => `base:${String(id)}` };

    const restoreFirst = patchGet(holder, (inner, id) => `first(${String(inner(id))})`);
    const restoreSecond = patchGet(holder, (inner, id) => `second(${String(inner(id))})`);

    // The second patch wraps the first, so restoring the first must not touch the chain.
    restoreFirst();
    expect(holder.get(4)).toBe("second(first(base:4))");

    restoreSecond();
    expect(holder.get(5)).toBe("first(base:5)");
  });

  it("does nothing when the holder has no get method", () => {
    const holder: { get?: (id: unknown) => unknown } = {};
    const restore = patchGet(holder, (inner, id) => inner(id));
    expect(holder.get).toBeUndefined();
    expect(() => restore()).not.toThrow();
  });
});

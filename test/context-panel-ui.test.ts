import { describe, expect, it } from "vitest";
import { compactButtonStyle, contextChipCopy, windowSurchargeNote } from "../src/context-panel-ui.ts";

describe("windowSurchargeNote", () => {
  it("warns only when the selected window is 1M", () => {
    expect(windowSurchargeNote(1_000_000)).toBe("1M 在部分模型上会额外计费");
    expect(windowSurchargeNote(100_000)).toBeNull();
    expect(windowSurchargeNote(200_000)).toBeNull();
    expect(windowSurchargeNote(500_000)).toBeNull();
    expect(windowSurchargeNote(undefined)).toBeNull();
  });
});

describe("contextChipCopy", () => {
  it("shows only the window on the chip and the full label in the title", () => {
    expect(contextChipCopy(200_000)).toEqual({ label: "200k", title: "上下文 200k" });
    expect(contextChipCopy(1_000_000)).toEqual({ label: "1M", title: "上下文 1M" });
    expect(contextChipCopy(undefined)).toEqual({ label: "上下文", title: "上下文" });
  });
});

describe("compactButtonStyle", () => {
  it("uses a bright fill when idle", () => {
    const idle = compactButtonStyle({ pressed: false, busy: false });
    expect(idle.background).toContain("#3b82f6");
    expect(idle.color).toBe("#fff");
    expect(idle.opacity).toBe(1);
    expect(idle.cursor).toBe("pointer");
  });

  it("darkens the fill while pressed", () => {
    const idle = compactButtonStyle({ pressed: false, busy: false });
    const pressed = compactButtonStyle({ pressed: true, busy: false });
    expect(pressed.background).not.toBe(idle.background);
    expect(pressed.background).toContain("#1d4ed8");
    expect(pressed.color).toBe("#fff");
  });

  it("dims while busy", () => {
    const busy = compactButtonStyle({ pressed: false, busy: true });
    expect(busy.opacity).toBeLessThan(1);
    expect(busy.cursor).toBe("wait");
  });
});

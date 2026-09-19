import { describe, expect, it } from "vitest";
import { compactButtonStyle, windowSurchargeNote } from "../src/context-panel-ui.ts";

describe("windowSurchargeNote", () => {
  it("warns only when the selected window is 1M", () => {
    expect(windowSurchargeNote(1_000_000)).toBe("1M 在部分模型上会额外计费");
    expect(windowSurchargeNote(100_000)).toBeNull();
    expect(windowSurchargeNote(200_000)).toBeNull();
    expect(windowSurchargeNote(500_000)).toBeNull();
    expect(windowSurchargeNote(undefined)).toBeNull();
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

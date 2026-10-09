import { describe, expect, it } from "vitest";
import {
  compactButtonStyle,
  compactionThresholdLabel,
  contextChipCopy,
  popoverAnchorStyle,
  windowSurchargeNote,
} from "../src/context-panel-ui.ts";

describe("compactionThresholdLabel", () => {
  it("shows the reserve formula threshold", () => {
    expect(compactionThresholdLabel({
      thresholdTokens: 239_000,
      summaryOutputTokens: 20_000,
      toolResultTokens: 13_000,
    })).toBe("约 239k 时压缩（预留摘要 20k + 工具结果 13k）");
  });

  it("explains when the current model window is unavailable", () => {
    expect(compactionThresholdLabel(undefined)).toBe("无法计算自动压缩阈值");
  });

  it("keeps the threshold visible when automatic compaction is disabled", () => {
    expect(compactionThresholdLabel({
      thresholdTokens: 239_000,
      summaryOutputTokens: 20_000,
      toolResultTokens: 13_000,
    }, false)).toBe("压缩阈值约 239k（自动压缩已关闭；预留摘要 20k + 工具结果 13k）");
  });
});

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
    expect(contextChipCopy(128_000)).toEqual({ label: "128k", title: "上下文 128k" });
    expect(contextChipCopy(256_000)).toEqual({ label: "256k", title: "上下文 256k" });
    expect(contextChipCopy(392_000)).toEqual({ label: "392k", title: "上下文 392k" });
    expect(contextChipCopy(512_000)).toEqual({ label: "512k", title: "上下文 512k" });
    expect(contextChipCopy(1_000_000)).toEqual({ label: "1M", title: "上下文 1M" });
    expect(contextChipCopy(262_144)).toEqual({ label: "262k", title: "上下文 262k" });
    expect(contextChipCopy(undefined)).toEqual({ label: "上下文", title: "上下文" });
  });
});

describe("popoverAnchorStyle", () => {
  it("anchors above the chip instead of using viewport-fixed coordinates", () => {
    const style = popoverAnchorStyle();
    expect(style.position).toBe("absolute");
    expect(style.right).toBe(0);
    expect(style.bottom).toContain("100%");
    expect(style.left).toBe("auto");
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

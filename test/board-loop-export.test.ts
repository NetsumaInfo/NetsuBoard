import { describe, expect, it } from "vitest";
import { loopExportable, loopFileName, loopSpan } from "../src/components/reference/boardLoopExport";

describe("board loop export", () => {
  it("offers the export on videos the core can read as a file", () => {
    expect(loopExportable({ kind: "video", ref: "C:/rush/a.mp4" })).toBe(true);
    expect(loopExportable({ kind: "video", ref: "https://example.com/a.mp4" })).toBe(true);
    expect(loopExportable({ kind: "video", ref: "blob:abc" })).toBe(false);
    expect(loopExportable({ kind: "image", ref: "C:/rush/a.png" })).toBe(false);
  });

  it("covers the loop bounds, else the whole file", () => {
    expect(loopSpan({ trimIn: 2, trimOut: 5, dur: 30 })).toEqual({ in: 2, end: 5, sec: 3 });
    expect(loopSpan({ dur: 30 })).toEqual({ in: undefined, end: undefined, sec: 30 });
    expect(loopSpan({ trimIn: 4, dur: 30 })).toEqual({ in: 4, end: undefined, sec: 26 });
    expect(loopSpan({}).sec).toBeNull();
  });

  it("proposes a file name without the source extension or forbidden characters", () => {
    expect(loopFileName("cut: 01.mp4", "webp")).toBe("cut_ 01.webp");
    expect(loopFileName(undefined, "gif")).toBe("loop.gif");
  });
});

import { loopRuns } from "../src/components/reference/boardLoopRender";
import type { BoardItem } from "../src/components/reference/referenceShared";

describe("whole-board loop export", () => {
  const item = (id: string, kind: string, z: number, ref = `C:/m/${id}`) =>
    ({ id, kind, z, ref, x: 0, y: 0, w: 10, h: 10 }) as unknown as BoardItem;

  it("cuts the z order at each video the core can play", () => {
    const items = [
      item("top", "text", 5), item("v2", "video", 4), item("mid", "image", 3),
      item("v1", "video", 2), item("bg", "image", 1), item("ink", "draw", 9),
    ];
    const runs = loopRuns(items);
    expect(runs.map((r) => [r.still, r.clip?.id])).toEqual([
      [["bg"], "v1"], [["mid"], "v2"], [["top"], undefined],
    ]);
  });

  it("paints a video it cannot play as a still, and honours the selection scope", () => {
    const items = [item("remote", "video", 1, "https://example.com/a.mp4"), item("v", "video", 2), item("img", "image", 3)];
    expect(loopRuns(items).map((r) => [r.still, r.clip?.id])).toEqual([[["remote"], "v"], [["img"], undefined]]);
    expect(loopRuns(items, new Set(["img"]))).toEqual([{ still: ["img"] }]);
  });
});

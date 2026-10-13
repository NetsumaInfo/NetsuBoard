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

import { describe, expect, it } from "vitest";
import { PDF_RE, pageAtOffset, pageCanvasSize, stepZoom, thumbScale } from "@/components/reference/boardPdf";

describe("board pdf helpers", () => {
  it("recognises pdf names only", () => {
    expect(PDF_RE.test("C:\docs\Brief.PDF")).toBe(true);
    expect(PDF_RE.test("brief.pdf.png")).toBe(false);
  });

  it("brings the long side of a page to the thumbnail size", () => {
    expect(thumbScale(612, 792, 1024)).toBeCloseTo(1024 / 792);
    expect(thumbScale(1000, 500, 1000)).toBe(1);
    expect(thumbScale(0, 0)).toBe(1);
  });

  it("sizes a page canvas from the card width and the pixel density", () => {
    const s = pageCanvasSize(600, 800, 300, 2);
    expect(s).toMatchObject({ cssW: 300, cssH: 400, pxW: 600, pxH: 800 });
    expect(pageCanvasSize(600, 800, 300, 0.5).pxW).toBe(300);
  });

  it("steps the zoom without leaving the range", () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(3, 1)).toBe(3);
    expect(stepZoom(0.5, -1)).toBe(0.5);
    expect(stepZoom(1.1, 1)).toBe(1.25);
  });

  it("finds the page under the reading line", () => {
    const tops = [0, 100, 200, 300];
    expect(pageAtOffset(tops, 0)).toBe(0);
    expect(pageAtOffset(tops, 150)).toBe(1);
    expect(pageAtOffset(tops, 9999)).toBe(3);
    expect(pageAtOffset([], 10)).toBe(0);
  });
});

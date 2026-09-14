// Group selection of drawn strokes.
//
// The draw layer is ONE singleton board item of zero size carrying every stroke, so the marquee's
// item-box test could never match it: dragging a rectangle over a wall of arrows selected nothing
// at all, while the same gesture over images worked. What carries an extent is the SHAPE, and the
// selection therefore has to be a list.

import { describe, expect, it } from "vitest";
import { shapeBBox } from "@/components/reference/drawGeometry";
import { resolveShapes } from "@/components/reference/drawAnchor";
import type { BoardItem, DrawShape } from "@/components/reference/referenceShared";

const stroke = (id: string, x: number, y: number): DrawShape =>
  ({ id, t: "line", p: [x, y, x + 20, y + 20], c: "#fff", w: 2 }) as unknown as DrawShape;

// The exact predicate ReferenceBoard applies when a marquee is released, over world coordinates.
function inMarquee(shapes: DrawShape[], a: { x: number; y: number }, b: { x: number; y: number }) {
  return shapes
    .filter((shape) => {
      const [x0, y0, x1, y1] = shapeBBox(shape);
      return x0 < b.x && x1 > a.x && y0 < b.y && y1 > a.y;
    })
    .map((shape) => shape.id);
}

describe("marquee over drawn strokes", () => {
  it("takes every stroke the rectangle crosses", () => {
    const shapes = [stroke("a", 0, 0), stroke("b", 40, 40), stroke("c", 400, 400)];
    expect(inMarquee(shapes, { x: -10, y: -10 }, { x: 100, y: 100 })).toEqual(["a", "b"]);
  });

  it("takes none when the rectangle lands on empty board", () => {
    const shapes = [stroke("a", 0, 0), stroke("b", 40, 40)];
    expect(inMarquee(shapes, { x: 900, y: 900 }, { x: 1000, y: 1000 })).toEqual([]);
  });

  it("measures an anchored stroke where it is DRAWN, not where it is stored", () => {
    // A stroke bound to an image is persisted in that image's own frame. Testing the stored
    // coordinates would hand the marquee a box that is nowhere on screen.
    const image = {
      id: "img", kind: "image", ref: "", src: "", x: 500, y: 500, w: 100, h: 100, rotation: 0, z: 1,
    } as BoardItem;
    const anchored = {
      ...stroke("anchored", 0, 0),
      a1: { id: "img", fx: 0.25, fy: 0.25 },
      a2: { id: "img", fx: 0.75, fy: 0.75 },
    } as unknown as DrawShape;
    const resolved = resolveShapes([anchored], [image]);
    const [x0, y0] = shapeBBox(resolved[0]);
    expect(x0).toBeGreaterThan(400);
    expect(y0).toBeGreaterThan(400);
    expect(inMarquee(resolved, { x: 450, y: 450 }, { x: 650, y: 650 })).toEqual(["anchored"]);
    expect(inMarquee(resolved, { x: -10, y: -10 }, { x: 100, y: 100 })).toEqual([]);
  });
});

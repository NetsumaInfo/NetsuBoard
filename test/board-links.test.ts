// Pure model of board links (links/model.ts): anchors (auto and fixed), side choice, routing, label
// layout, hit-testing, and how the drawing code resolves links.

import { describe, expect, it } from "vitest";
import {
  autoAnchor, connectedIds, edgeDistance, elbowPoints, hasLink, headsOf, headsPatch, hitLink, isAutoAnchor, isLink,
  isOrphanLink, labelLayout, linkGeo, linkKey, linkOnLevel, makeLink, nearestSide, pruneLinks, resolveEnds, reverseShape,
  routePath, sideAnchor, sidePoint, sideToward, widthLevel, LABEL_MAX_PX, LABEL_PAD_X, type LinkBox, type LinkEnd,
} from "@/components/reference/links/model";
import { indexItems, reanchorShape, resolveShape } from "@/components/reference/drawAnchor";
import type { DrawShape } from "@/components/reference/referenceShared";

const box = (id: string, x: number, y: number, w = 100, h = 60, rotation = 0): LinkBox & { kind: "image"; z: number } =>
  ({ id, kind: "image", z: 1, x, y, w, h, rotation, flipH: false, flipV: false });

const end = (x: number, y: number, dx: number, dy: number): LinkEnd => ({ x, y, dx, dy, side: null });

describe("sides", () => {
  it("returns the middle of each side, rotation honoured", () => {
    const a = box("a", 0, 0);
    expect(sidePoint(a, "top")).toEqual({ x: 50, y: 0 });
    expect(sidePoint(a, "right")).toEqual({ x: 100, y: 30 });
    expect(sidePoint(a, "bottom")).toEqual({ x: 50, y: 60 });
    expect(sidePoint(a, "left")).toEqual({ x: 0, y: 30 });
    const r = sidePoint(box("r", 0, 0, 100, 60, 90), "top"); // the top side now faces right
    expect(r.x).toBeCloseTo(80, 5);
    expect(r.y).toBeCloseTo(30, 5);
  });

  it("picks the side midpoint nearest to a point", () => {
    const b = box("b", 300, 0);
    expect(nearestSide(b, { x: 100, y: 30 })).toBe("left");
    expect(nearestSide(b, { x: 350, y: -200 })).toBe("top");
  });

  it("measures the distance to an item's edge (negative inside)", () => {
    const a = box("a", 0, 0);
    expect(edgeDistance(a, { x: 110, y: 30 })).toBeCloseTo(10);
    expect(edgeDistance(a, { x: 95, y: 30 })).toBeCloseTo(-5);
  });
});

describe("auto side choice", () => {
  it("faces the target along the box diagonals, not the raw axis", () => {
    const wide = box("w", 0, 0, 400, 40); // centre (200, 20)
    // Target up and to the right, steeper than the box diagonal → top side.
    expect(sideToward(wide, { x: 300, y: -200 })).toBe("top");
    expect(sideToward(wide, { x: 700, y: 30 })).toBe("right");
    expect(sideToward(wide, { x: 200, y: 400 })).toBe("bottom");
    expect(sideToward(wide, { x: -300, y: 20 })).toBe("left");
  });

  it("re-picks the sides as items move", () => {
    const a = box("a", 0, 0), b = box("b", 300, 0);
    const [e0, e1] = resolveEnds(a, autoAnchor("a"), b, autoAnchor("b"));
    expect([e0.side, e1.side]).toEqual(["right", "left"]);
    expect([e0.x, e0.y, e1.x, e1.y]).toEqual([100, 30, 300, 30]);
    const below = box("b", 0, 400);
    const [f0, f1] = resolveEnds(a, autoAnchor("a"), below, autoAnchor("b"));
    expect([f0.side, f1.side]).toEqual(["bottom", "top"]);
  });

  it("follows the rotation of the item", () => {
    const a = box("a", 0, 0, 100, 60, 90), b = box("b", 300, 0);
    const [e0] = resolveEnds(a, autoAnchor("a"), b, autoAnchor("b"));
    // Rotated 90°, the physical side facing right is "top".
    expect(e0.side).toBe("top");
    expect(e0.dx).toBeCloseTo(1, 5);
  });

  it("uses the centre as the auto sentinel, inside the 0..1 range collaboration accepts", () => {
    const a = autoAnchor("x");
    expect(isAutoAnchor(a)).toBe(true);
    expect(a.fx >= 0 && a.fx <= 1 && a.fy >= 0 && a.fy <= 1).toBe(true);
    expect(isAutoAnchor(sideAnchor(box("x", 0, 0), "right"))).toBe(false);
  });
});

describe("fixed anchors (older links, pinned sides)", () => {
  it("keeps a pinned side whatever the position of the other item", () => {
    const a = box("a", 0, 0), b = box("b", 300, 0);
    const [e0, e1] = resolveEnds(a, sideAnchor(a, "bottom"), b, autoAnchor("b"));
    expect(e0.side).toBe("bottom");
    expect([e0.x, e0.y]).toEqual([50, 60]);
    // The auto end faces the pinned point, not the other centre.
    expect(e1.side).toBe("left");
  });

  it("keeps an arbitrary point of an older hand-drawn arrow and leaves along its closest side", () => {
    const a = box("a", 0, 0), b = box("b", 300, 0);
    const [e0] = resolveEnds(a, { id: "a", fx: 0.9, fy: 0.3 }, b, { id: "b", fx: 0.1, fy: 0.5 });
    expect([e0.x, e0.y]).toEqual([90, 18]);
    expect(e0.side).toBe("right");
  });

  it("honours a flipped item: a pinned side stays the same physical side", () => {
    const a = { ...box("a", 0, 0), flipH: true };
    const anchor = sideAnchor(a, "right");
    expect(anchor.fx).toBe(0);
    const [e0] = resolveEnds(a, anchor, box("b", 300, 0), autoAnchor("b"));
    expect(e0.side).toBe("right");
    expect(e0.x).toBeCloseTo(100);
  });

  it("is resolved by the drawing code with both ends together", () => {
    const a = box("a", 0, 0), b = box("b", 0, 400);
    const link = makeLink("l", autoAnchor("a"), autoAnchor("b"), [0, 0, 0, 0]);
    const solved = resolveShape(link, indexItems([a, b]));
    expect(solved.p).toEqual([50, 60, 50, 400]);
    expect(solved.a1).toEqual(link.a1);
  });

  it("is never re-anchored from its points (auto ends stay auto)", () => {
    const a = box("a", 0, 0), b = box("b", 300, 0);
    const link = makeLink("l", autoAnchor("a"), autoAnchor("b"), [100, 30, 300, 30]);
    expect(reanchorShape(link, indexItems([a, b]))).toBe(link);
    expect(reanchorShape(link, indexItems([a]))).toBe(link);
  });
});

describe("routing", () => {
  const e0 = end(100, 30, 1, 0), e1 = end(300, 30, -1, 0);

  it("draws a smooth S leaving each side along its normal, midpoint centred", () => {
    const p = routePath("curved", e0, e1);
    expect(p.d.startsWith("M 100 30 C")).toBe(true);
    expect(p.mid.x).toBeCloseTo(200, 5);
    expect(p.mid.y).toBeCloseTo(30, 5);
    expect(p.endAng).toBeCloseTo(0, 5);
  });

  it("draws a straight segment", () => {
    const p = routePath("straight", e0, end(300, 130, -1, 0));
    expect(p.d).toBe("M 100 30 L 300 130");
    expect(p.mid).toEqual({ x: 200, y: 80 });
  });

  it("routes an elbow orthogonally between facing sides", () => {
    const pts = elbowPoints(e0, end(300, 130, -1, 0));
    expect(pts).toEqual([{ x: 100, y: 30 }, { x: 200, y: 30 }, { x: 200, y: 130 }, { x: 300, y: 130 }]);
    const p = routePath("elbow", e0, end(300, 130, -1, 0));
    expect(p.d).toContain("Q 200 30");
    expect(p.mid).toEqual({ x: 200, y: 80 });
  });

  it("routes an elbow between perpendicular sides through one corner", () => {
    const pts = elbowPoints(end(100, 30, 1, 0), end(300, 200, 0, 1));
    expect(pts[pts.length - 1]).toEqual({ x: 300, y: 200 });
    for (let i = 1; i < pts.length; i++) {
      const horizontal = pts[i].y === pts[i - 1].y, vertical = pts[i].x === pts[i - 1].x;
      expect(horizontal || vertical).toBe(true);
    }
  });

  it("trims the drawn path for a head but keeps the tip-to-tip geometry", () => {
    const p = routePath("straight", e0, e1, { trim1: 10 });
    expect(p.d).toBe("M 100 30 L 290 30");
    expect(p.pts).toEqual([100, 30, 300, 30]);
  });

  it("caches by geometry: an unrelated change gives the same key, a move a new one", () => {
    const a = box("a", 0, 0), b = box("b", 300, 0);
    const link = makeLink("l", autoAnchor("a"), autoAnchor("b"), [0, 0, 0, 0]);
    expect(linkKey(link, a, b, 1)).toBe(linkKey({ ...link, c: "#fff" }, a, b, 1));
    expect(linkKey(link, a, b, 1)).not.toBe(linkKey(link, { ...a, x: 5 }, b, 1));
  });

  it("scales the stroke with the chrome factor, not with the stored zoom", () => {
    const a = box("a", 0, 0), b = box("b", 300, 0);
    const link = makeLink("l", autoAnchor("a"), autoAnchor("b"), [0, 0, 0, 0]);
    expect(linkGeo(link, a, b, 1).strokeW).toBe(2);
    expect(linkGeo(link, a, b, 0.5).strokeW).toBe(1);
    expect(widthLevel(2.5)).toBe("normal");
    expect(widthLevel(1)).toBe("thin");
    expect(widthLevel(5)).toBe("bold");
  });
});

describe("hit-testing", () => {
  it("hits near the path and misses away from it", () => {
    const p = routePath("elbow", end(100, 30, 1, 0), end(300, 130, -1, 0));
    expect(hitLink(p, 200, 80, 4)).toBe(true);
    expect(hitLink(p, 150, 32, 4)).toBe(true);
    expect(hitLink(p, 150, 80, 4)).toBe(false);
    expect(hitLink(p, 1000, 1000, 4)).toBe(false);
  });
});

describe("labels", () => {
  const measure = (s: string) => s.length * 6;
  const inner = LABEL_MAX_PX - LABEL_PAD_X * 2;

  it("keeps a short label on one line, sized to its text", () => {
    const l = labelLayout("hello", measure);
    expect(l.lines).toEqual(["hello"]);
    expect(l.w).toBe(30 + LABEL_PAD_X * 2);
  });

  it("wraps to two lines then ends with an ellipsis", () => {
    const text = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    const l = labelLayout(text, measure);
    expect(l.lines.length).toBe(2);
    expect(l.lines[1].endsWith("…")).toBe(true);
    for (const line of l.lines) expect(measure(line)).toBeLessThanOrEqual(inner);
    expect(l.w).toBeLessThanOrEqual(LABEL_MAX_PX);
  });

  it("cuts a single word wider than the pill", () => {
    const l = labelLayout("x".repeat(80), measure);
    expect(l.lines.length).toBe(2);
    for (const line of l.lines) expect(measure(line)).toBeLessThanOrEqual(inner);
  });
});

describe("identity helpers", () => {
  const a = box("a", 0, 0), b = box("b", 300, 0), c = box("c", 0, 300);
  const ab = makeLink("ab", autoAnchor("a"), autoAnchor("b"), [0, 0, 0, 0]);
  const bc = makeLink("bc", sideAnchor(b, "bottom"), sideAnchor(c, "right"), [0, 0, 0, 0]);
  const free: DrawShape = { id: "free", t: "arrow", c: "#fff", w: 2, p: [0, 0, 10, 10] };

  it("detects links, duplicates and reverses cleanly", () => {
    expect(isLink(ab)).toBe(true);
    expect(isLink(free)).toBe(false);
    expect(hasLink([ab], ab.a1!, ab.a2!)).toBe(true);
    expect(hasLink([ab], ab.a2!, ab.a1!)).toBe(false);
    const r = reverseShape(ab);
    expect(r.a1).toEqual(ab.a2);
    expect(headsOf(r)).toBe("end");
    expect(headsOf({ ...ab, ...headsPatch("both") })).toBe("both");
    expect(headsOf({ ...ab, ...headsPatch("none") })).toBe("none");
  });

  it("lists the links of an item and the items at their other ends", () => {
    const r = connectedIds([ab, bc, free], "b");
    expect([...r.shapeIds].sort()).toEqual(["ab", "bc"]);
    expect([...r.itemIds].sort()).toEqual(["a", "c"]);
  });

  it("removes the links of a deleted item and keeps identity when nothing goes", () => {
    const shapes = [ab, bc, free];
    expect(pruneLinks(shapes, new Set(["a"])).map((s) => s.id)).toEqual(["bc", "free"]);
    expect(pruneLinks(shapes, new Set(["nobody"]))).toBe(shapes);
  });

  it("hides a link whose end is not on the level on screen (folded folder, deleted item)", () => {
    const level = new Set(["a", "b"]);
    expect(linkOnLevel(ab, level)).toBe(true);
    expect(linkOnLevel(bc, level)).toBe(false);
    expect(isOrphanLink(bc, level)).toBe(true);
    expect(isOrphanLink(free, level)).toBe(false);
  });
});

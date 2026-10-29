// Link routing (links/model.ts, links/resolve.ts, links/labelPlace.ts): side choice as a PAIR, spreading
// of the ports that share a side, floating straight ends, elbows that go around their boxes, adaptive
// curves and the slide of a label off the items that would hide it.

import { describe, expect, it } from "vitest";
import {
  autoAnchor, boxRect, cubicBetween, elbowPoints, makeLink, pairSides, resolveEnds, routePath, segmentHitsRect, sideAnchor,
  type LinkBox, type LinkEnd, type Pt,
} from "@/components/reference/links/model";
import { portOffsets, resolveLinkGeos } from "@/components/reference/links/resolve";
import { labelPoint } from "@/components/reference/links/labelPlace";
import type { DrawShape } from "@/components/reference/referenceShared";

const box = (id: string, x: number, y: number, w = 100, h = 60, rotation = 0): LinkBox => ({ id, x, y, w, h, rotation, flipH: false, flipV: false });
const P: [number, number, number, number] = [0, 0, 0, 0];
const link = (id: string, a: string, b: string, extra: Partial<DrawShape> = {}): DrawShape => ({ ...makeLink(id, autoAnchor(a), autoAnchor(b), P), ...extra });
const sides = (a: LinkBox, b: LinkBox) => resolveEnds(a, autoAnchor(a.id), b, autoAnchor(b.id)).map((e) => e.side);
const clean = (pts: Pt[], ...boxes: LinkBox[]) => {
  for (let i = 1; i < pts.length; i++) for (const b of boxes) expect(segmentHitsRect(pts[i - 1], pts[i], boxRect(b)!)).toBe(false);
};

describe("pair side choice", () => {
  it("uses the facing left/right sides when the boxes are separated horizontally", () => {
    // Far more apart on x than on y, though the centres are not aligned.
    expect(sides(box("a", 0, 0), box("b", 400, 80))).toEqual(["right", "left"]);
    expect(sides(box("b", 400, 80), box("a", 0, 0))).toEqual(["left", "right"]);
  });

  it("uses the facing top/bottom sides when the boxes are separated vertically", () => {
    expect(sides(box("a", 0, 0), box("b", 60, 300))).toEqual(["bottom", "top"]);
    expect(sides(box("b", 60, 300), box("a", 0, 0))).toEqual(["top", "bottom"]);
  });

  it("follows the larger gap even when the centres suggest the other axis", () => {
    // Tall boxes side by side: the centres are further apart vertically, the gap is horizontal.
    const a = box("a", 0, 0, 40, 400), b = box("b", 100, 300, 40, 400);
    expect(sides(a, b)).toEqual(["right", "left"]);
  });

  it("picks a clean pair when the boxes overlap on both axes", () => {
    const a = box("a", 0, 0, 200, 100), b = box("b", 150, 60, 200, 100);
    const [e0, e1] = resolveEnds(a, autoAnchor("a"), b, autoAnchor("b"));
    // Never an end pointing away from the other, never a run through a box.
    expect((e1.x - e0.x) * e0.dx + (e1.y - e0.y) * e0.dy).toBeGreaterThanOrEqual(0);
    expect(-(e1.x - e0.x) * e1.dx - (e1.y - e0.y) * e1.dy).toBeGreaterThanOrEqual(0);
    expect(segmentHitsRect(e0, e1, boxRect(a)!)).toBe(false);
    expect(segmentHitsRect(e0, e1, boxRect(b)!)).toBe(false);
  });

  it("faces a pinned end from the side that sees its point", () => {
    const a = box("a", 0, 0), b = box("b", 150, 300);
    // b pinned on its top side: a faces it from its bottom, the vertical gap being the larger.
    const [e0] = resolveEnds(a, autoAnchor("a"), b, sideAnchor(b, "top"));
    expect(e0.side).toBe("bottom");
    const [t0] = pairSides({ box: a, fixed: null }, { box: null, fixed: { x: 500, y: 20, dx: 0, dy: 0, side: null } });
    expect(t0).toBe("right");
  });

  it("keeps the diagonal rule for a rotated item", () => {
    const a = box("a", 0, 0, 100, 60, 90), b = box("b", 300, 0);
    expect(resolveEnds(a, autoAnchor("a"), b, autoAnchor("b"))[0].side).toBe("top");
  });
});

describe("port spreading", () => {
  const hub = box("hub", 0, 100, 100, 300);
  const t1 = box("t1", 400, 0), t2 = box("t2", 400, 200), t3 = box("t3", 400, 400);
  const items = new Map([hub, t1, t2, t3].map((b) => [b.id, b]));

  it("spreads the auto ends of one side, ordered by where their other end lies", () => {
    // Declared out of order: the wires must still not cross.
    const links = [link("l2", "hub", "t2"), link("l3", "hub", "t3"), link("l1", "hub", "t1")];
    const r = resolveLinkGeos(links, items, 1);
    const y = (id: string) => r.byId.get(id)!.e0.y;
    expect(y("l1")).toBeLessThan(y("l2"));
    expect(y("l2")).toBeLessThan(y("l3"));
    // Centred on the side midpoint, all on the right side, within the middle 70%.
    expect((y("l1") + y("l3")) / 2).toBeCloseTo(250, 5);
    for (const id of ["l1", "l2", "l3"]) {
      expect(r.byId.get(id)!.e0.x).toBe(100);
      expect(Math.abs(y(id) - 250)).toBeLessThanOrEqual(0.35 * 300 + 1e-6);
    }
  });

  it("leaves a lone link on the side midpoint", () => {
    const r = resolveLinkGeos([link("l1", "hub", "t1")], items, 1);
    expect(r.byId.get("l1")!.e0.y).toBe(250);
  });

  it("never spreads beyond the middle of a short side", () => {
    const small = box("s", 0, 0, 100, 40);
    const m = new Map([small, box("u", 400, 0), box("v", 400, 100), box("w", 400, 200), box("x", 400, 300)].map((b) => [b.id, b]));
    const links = ["u", "v", "w", "x"].map((t) => link(`l${t}`, "s", t));
    const off = portOffsets(new Map(links.map((l) => [l.id, l])), m, 1);
    for (const [a, b] of off.values()) expect(Math.abs(a)).toBeLessThanOrEqual(0.35 * 40 + 1e-6 + Math.abs(b));
    expect(Math.max(...[...off.values()].map(([a]) => Math.abs(a)))).toBeLessThanOrEqual(0.35 * 40 + 1e-6);
  });

  it("keeps the two links of one bundle from crossing", () => {
    const a = box("a", 0, 0), b = box("b", 400, 0);
    const r = resolveLinkGeos([link("x", "a", "b"), link("y", "a", "b")], new Map([a, b].map((q) => [q.id, q])), 1);
    const gx = r.byId.get("x")!, gy = r.byId.get("y")!;
    expect(Math.sign(gx.e0.y - gy.e0.y)).toBe(Math.sign(gx.e1.y - gy.e1.y));
    expect(gx.e0.y).not.toBe(gy.e0.y);
  });

  it("rebuilds only the links of the moved item and those sharing its side", () => {
    const links = [link("l1", "hub", "t1"), link("l2", "hub", "t2"), link("o", "t3", "t3x")];
    const m = new Map(items);
    m.set("t3x", box("t3x", 800, 400));
    const r1 = resolveLinkGeos(links, m, 1);
    const moved = new Map(m).set("t3x", box("t3x", 800, 500));
    const r2 = resolveLinkGeos(links, moved, 1, r1.cache);
    expect(r2.byId.get("l1")).toBe(r1.byId.get("l1"));
    expect(r2.byId.get("l2")).toBe(r1.byId.get("l2"));
    expect(r2.byId.get("o")).not.toBe(r1.byId.get("o"));
  });
});

describe("straight links", () => {
  it("float on the centre-to-centre line", () => {
    const a = box("a", 0, 0, 100, 100), b = box("b", 300, 300, 100, 100);
    const [e0, e1] = resolveEnds(a, autoAnchor("a"), b, autoAnchor("b"), { route: "straight" });
    // Centres (50,50) and (350,350): the line leaves the corners of the boxes.
    expect(e0.x).toBeCloseTo(100, 5);
    expect(e0.y).toBeCloseTo(100, 5);
    expect(e1.x).toBeCloseTo(300, 5);
    expect(e1.y).toBeCloseTo(300, 5);
  });

  it("aim at the centre of the other item for any angle", () => {
    const a = box("a", 0, 0, 200, 100), b = box("b", 500, -300, 100, 100);
    const [e0, e1] = resolveEnds(a, autoAnchor("a"), b, autoAnchor("b"), { route: "straight" });
    const ca = { x: 100, y: 50 }, cb = { x: 550, y: -250 };
    const cross = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    expect(Math.abs(cross(ca, cb, e0))).toBeLessThan(1e-6);
    expect(Math.abs(cross(ca, cb, e1))).toBeLessThan(1e-6);
    // On the outlines.
    expect(e0.x === 200 || e0.y === 0).toBe(true);
    expect(e1.x === 500 || e1.y === -200).toBe(true);
  });

  it("go through resolveLinkGeos and are not spread", () => {
    const a = box("a", 0, 0), b = box("b", 400, 0), c = box("c", 400, 200);
    const links = [link("s1", "a", "b", { route: "straight" }), link("s2", "a", "c", { route: "straight" })];
    const r = resolveLinkGeos(links, new Map([a, b, c].map((q) => [q.id, q])), 1);
    expect(r.byId.get("s1")!.path.d.startsWith("M 100 30")).toBe(true);
  });
});

describe("elbow around boxes", () => {
  it("does not cut through the source when its end faces away from the target", () => {
    const a = box("a", 0, 0), b = box("b", -300, 100);
    const e0: LinkEnd = { x: 100, y: 30, dx: 1, dy: 0, side: "right" };
    const e1: LinkEnd = { x: -250, y: 100, dx: 0, dy: -1, side: "top" };
    const plain = elbowPoints(e0, e1);
    expect(plain.some((p, i) => i > 0 && segmentHitsRect(plain[i - 1], p, boxRect(a)!))).toBe(true);
    const pts = elbowPoints(e0, e1, undefined, [boxRect(a), boxRect(b)]);
    clean(pts, a, b);
    expect(pts[0]).toEqual({ x: 100, y: 30 });
    expect(pts[pts.length - 1]).toEqual({ x: -250, y: 100 });
    for (let i = 1; i < pts.length; i++) expect(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y).toBe(true);
  });

  it("goes around the target when both ends leave the same way", () => {
    const a = box("a", 0, 0), b = box("b", 300, 0);
    const e0: LinkEnd = { x: 100, y: 30, dx: 1, dy: 0, side: "right" };
    const e1: LinkEnd = { x: 400, y: 30, dx: 1, dy: 0, side: "right" };
    const pts = elbowPoints(e0, e1, undefined, [boxRect(a), boxRect(b)]);
    clean(pts, a, b);
    expect(pts.some((p) => p.x > 400)).toBe(true);
  });

  it("keeps the plain route when it is already clean", () => {
    const a = box("a", 0, 0), b = box("b", 300, 100);
    const e0: LinkEnd = { x: 100, y: 30, dx: 1, dy: 0, side: "right" };
    const e1: LinkEnd = { x: 300, y: 130, dx: -1, dy: 0, side: "left" };
    expect(elbowPoints(e0, e1, undefined, [boxRect(a), boxRect(b)])).toEqual(elbowPoints(e0, e1));
  });

  it("is routed around the boxes by routePath and by resolveLinkGeos", () => {
    const a = box("a", 0, 0), b = box("b", -300, 100);
    const l = { ...makeLink("l", { id: "a", fx: 1, fy: 0.5 }, { id: "b", fx: 0.5, fy: 0 }, P), route: "elbow" as const };
    const g = resolveLinkGeos([l], new Map([a, b].map((q) => [q.id, q])), 1).byId.get("l")!;
    const pts: Pt[] = [];
    for (let i = 0; i < g.path.pts.length; i += 2) pts.push({ x: g.path.pts[i], y: g.path.pts[i + 1] });
    clean(pts, a, b);
    expect(routePath("elbow", g.e0, g.e1).pts.length).toBeGreaterThan(0);
  });
});

describe("adaptive curves", () => {
  it("stays short between close facing sides (no control point past the other end)", () => {
    const c = cubicBetween({ x: 100, y: 30 }, { dx: 1, dy: 0 }, { x: 140, y: 30 }, { dx: -1, dy: 0 });
    expect(c[2]).toBeLessThanOrEqual(140);
    expect(c[4]).toBeGreaterThanOrEqual(100);
  });

  it("swings out when the other end is behind the side", () => {
    const c = cubicBetween({ x: 100, y: 30 }, { dx: 1, dy: 0 }, { x: 0, y: 130 }, { dx: -1, dy: 0 });
    expect(c[2]).toBeGreaterThan(130);
    expect(c[4]).toBeLessThan(-30);
  });
});

describe("label placement", () => {
  const a = box("a", 0, 0), b = box("b", 600, 0);
  const geo = resolveLinkGeos([{ ...link("l", "a", "b", { route: "straight", text: "x" }) }], new Map([a, b].map((q) => [q.id, q])), 1).byId.get("l")!;
  const item = (id: string, x: number, y: number, w = 80, h = 60) => ({ id, kind: "image", x, y, w, h, rotation: 0 });

  it("stays on the middle when nothing covers it", () => {
    expect(labelPoint(geo, { w: 60, h: 22 }, 1, [item("far", 300, 400)])).toEqual(geo.path.mid);
  });

  it("slides along the path off an item in the middle", () => {
    const mid = geo.path.mid;
    const p = labelPoint(geo, { w: 60, h: 22 }, 1, [item("block", mid.x - 40, mid.y - 30)]);
    expect(p).not.toEqual(mid);
    expect(Math.abs(p.x - mid.x)).toBeGreaterThan(40);
  });

  it("ignores the two linked items and frames", () => {
    const mid = geo.path.mid;
    expect(labelPoint(geo, { w: 60, h: 22 }, 1, [item("a", mid.x - 40, mid.y - 30), { ...item("f", mid.x - 40, mid.y - 30), kind: "frame" }])).toEqual(mid);
  });
});

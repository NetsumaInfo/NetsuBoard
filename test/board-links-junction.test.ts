// Junctions (links/junction.ts, links/resolve.ts, links/gestureModel.ts): a link end attached to
// another link — resolution (nested, cycles), tangent start, sliding, cascade delete / re-root,
// downstream / upstream traversal and layouts through junctions.

import { describe, expect, it } from "vitest";
import {
  JUNCTION_MAX_DEPTH, JUNCTION_T_MAX, JUNCTION_T_MIN, canAttach, collapsedHidden, detachBranch, downstreamOf, itemEdges,
  junctionAnchor, linkIndex, linksOnLevel, mirrorJunctions, pointAt, projectOnPath, pruneLinks, removeShapes,
  rootSource, rootTarget, splitJunctions, upstreamOf,
} from "@/components/reference/links/junction";
import { resolveLinkGeos } from "@/components/reference/links/resolve";
import { applyLinkEnd, findLinkTarget, gestureBase, linkTargetFilter } from "@/components/reference/links/gestureModel";
import { insertIntoLink, linksWithin, organiseLayout, remapLinks, type NodeBox } from "@/components/reference/links/graph";
import { autoAnchor, connectedIds, makeLink, type LinkBox } from "@/components/reference/links/model";
import type { DrawShape, ShapeAnchor } from "@/components/reference/referenceShared";

const P: [number, number, number, number] = [0, 0, 0, 0];
const link = (id: string, a: string | ShapeAnchor, b: string | ShapeAnchor, extra: Partial<DrawShape> = {}): DrawShape =>
  ({ ...makeLink(id, typeof a === "string" ? autoAnchor(a) : a, typeof b === "string" ? autoAnchor(b) : b, P), ...extra });
const J = junctionAnchor;
const box = (id: string, x: number, y: number, w = 100, h = 60): LinkBox => ({ id, x, y, w, h });
const boxes = (...b: LinkBox[]) => new Map(b.map((x) => [x.id, x]));
let n = 0;
const newId = () => `new${++n}`;

// A at the left, B at the right on the same row, C below the middle.
const A = box("A", 0, 0), B = box("B", 600, 0), C = box("C", 300, 400), D = box("D", 300, -400);
const items = boxes(A, B, C, D);

describe("junction encoding and checks", () => {
  it("clamps t into the editable range and keeps fy inside 0..1", () => {
    expect(J("L", 0)).toEqual({ id: "L", fx: JUNCTION_T_MIN, fy: 0.5 });
    expect(J("L", 2).fx).toBe(JUNCTION_T_MAX);
    expect(J("L", Number.NaN).fx).toBe(0.5);
  });

  it("refuses self, descendants and over-deep chains", () => {
    const shapes = [link("ab", "A", "B"), link("br", J("ab", 0.5), "C"), link("br2", J("br", 0.5), "D")];
    const idx = linkIndex(shapes);
    expect(canAttach(idx, "ab", "ab")).toBe(false);
    expect(canAttach(idx, "ab", "br")).toBe(false);   // br hangs from ab
    expect(canAttach(idx, "ab", "br2")).toBe(false);  // and br2 from br
    expect(canAttach(idx, "br2", "ab")).toBe(true);
    expect(canAttach(idx, null, "br2")).toBe(true);
    expect(canAttach(idx, null, "missing")).toBe(false);
    const chain: DrawShape[] = [link("l0", "A", "B")];
    for (let i = 1; i <= JUNCTION_MAX_DEPTH; i++) chain.push(link(`l${i}`, J(`l${i - 1}`, 0.5), "C"));
    expect(canAttach(linkIndex(chain), null, `l${JUNCTION_MAX_DEPTH - 1}`)).toBe(true);
    expect(canAttach(linkIndex(chain), null, `l${JUNCTION_MAX_DEPTH}`)).toBe(false);
  });

  it("finds the root items of a flow through junctions", () => {
    const shapes = [link("ab", "A", "B"), link("fork", J("ab", 0.3), "C"), link("merge", "D", J("ab", 0.7)), link("deep", J("fork", 0.5), "D")];
    const idx = linkIndex(shapes);
    expect(rootSource(idx, idx.get("fork")!)).toBe("A");
    expect(rootTarget(idx, idx.get("merge")!)).toBe("B");
    expect(rootSource(idx, idx.get("deep")!)).toBe("A");
    expect(itemEdges(shapes).map((e) => `${e.from}>${e.to}`)).toEqual(["A>B", "A>C", "D>B", "A>D"]);
  });
});

describe("resolution", () => {
  it("places a fork on its parent's path, leaving along the parent's tangent toward its target", () => {
    const shapes = [link("ab", "A", "B", { route: "curved" }), link("br", J("ab", 0.5), "C")];
    const r = resolveLinkGeos(shapes, items, 1);
    expect(r.geos.map((g) => g.shape.id)).toEqual(["ab", "br"]);
    const parent = r.byId.get("ab")!, br = r.byId.get("br")!;
    const at = pointAt(parent.path.pts, 0.5);
    expect(br.e0.x).toBeCloseTo(at.x, 6);
    expect(br.e0.y).toBeCloseTo(at.y, 6);
    expect(br.j0).toBe("ab");
    expect(br.j1).toBeUndefined();
    // Tangent: parallel to the parent there (cross product 0), facing the target side.
    expect(Math.abs(br.e0.dx * at.dy - br.e0.dy * at.dx)).toBeLessThan(1e-9);
    const c = { x: C.x + C.w / 2, y: C.y + C.h / 2 };
    expect((c.x - at.x) * br.e0.dx + (c.y - at.y) * br.e0.dy).toBeGreaterThanOrEqual(0);
    // No arrowhead at a junction, the item end keeps its head.
    expect(br.head0).toBeNull();
    expect(br.head1).not.toBeNull();
  });

  it("orients the tangent backwards when the target lies behind the junction", () => {
    const left = box("L", -900, 0);
    const shapes = [link("ab", "A", "B", { route: "straight" }), link("br", J("ab", 0.5), "L")];
    const br = resolveLinkGeos(shapes, boxes(A, B, left), 1).byId.get("br")!;
    expect(br.e0.dx).toBeLessThan(0);
  });

  it("never draws a head on a merge end", () => {
    const shapes = [link("ab", "A", "B"), link("m", "D", J("ab", 0.5), { h1: "arrow", h2: "arrow" })];
    const m = resolveLinkGeos(shapes, items, 1).byId.get("m")!;
    expect(m.j1).toBe("ab");
    expect(m.head1).toBeNull();
    expect(m.head0).not.toBeNull();
  });

  it("resolves nested branches parents first, whatever the stored order", () => {
    const shapes = [link("deep", J("br", 0.5), "D"), link("br", J("ab", 0.5), "C"), link("ab", "A", "B")];
    const r = resolveLinkGeos(shapes, items, 1);
    expect(r.geos.map((g) => g.shape.id)).toEqual(["ab", "br", "deep"]);
    expect(r.byId.get("deep")!.j0).toBe("br");
  });

  it("leaves out cycles, self-attachment and branches of a missing parent (it arrives later)", () => {
    const shapes = [
      link("x", "A", J("y", 0.5)), link("y", "B", J("x", 0.5)),
      link("self", "A", J("self", 0.5)),
      link("orphan", J("later", 0.5), "C"),
      link("ok", "A", "B"),
    ];
    expect(resolveLinkGeos(shapes, items, 1).geos.map((g) => g.shape.id)).toEqual(["ok"]);
    // The parent shows up (a collaborator's edit arriving after its branch): the branch resolves.
    const later = [...shapes, link("later", "C", "D")];
    expect(resolveLinkGeos(later, items, 1).byId.has("orphan")).toBe(true);
  });

  it("follows the parent's live geometry and reuses unchanged geometry", () => {
    const shapes = [link("ab", "A", "B"), link("br", J("ab", 0.5), "C"), link("cd", "C", "D")];
    const r1 = resolveLinkGeos(shapes, items, 1);
    const same = resolveLinkGeos(shapes, items, 1, r1.cache);
    expect(same.byId.get("br")).toBe(r1.byId.get("br"));
    // B moves: its link and the branch hanging from it change, the unrelated link does not.
    const moved = resolveLinkGeos(shapes, boxes(A, { ...B, y: 300 }, C, D), 1, r1.cache);
    expect(moved.byId.get("ab")).not.toBe(r1.byId.get("ab"));
    expect(moved.byId.get("br")).not.toBe(r1.byId.get("br"));
    expect(moved.byId.get("cd")).toBe(r1.byId.get("cd"));
    expect(moved.byId.get("br")!.e0.y).not.toBeCloseTo(r1.byId.get("br")!.e0.y, 3);
  });

  it("knows which links can be drawn on a level", () => {
    const shapes = [link("ab", "A", "B"), link("br", J("ab", 0.5), "C"), link("gone", J("br", 0.5), "Z")];
    expect([...linksOnLevel(shapes, new Set(["A", "B", "C"]))]).toEqual(["ab", "br"]);
    expect([...linksOnLevel(shapes, new Set(["A", "C"]))]).toEqual([]);
  });
});

describe("path helpers", () => {
  it("projects a point to its arc-length fraction", () => {
    const pts = [0, 0, 100, 0, 100, 100];
    expect(projectOnPath(pts, 50, 10)).toEqual({ t: 0.25, dist: 10 });
    expect(projectOnPath(pts, 120, 50).t).toBeCloseTo(0.75, 6);
    expect(pointAt(pts, 0.75)).toEqual({ x: 100, y: 50, dx: 0, dy: 1 });
  });
});

describe("gestures", () => {
  const shapes = [link("ab", "A", "B", { c: "#f87171", w: 3.5, dash: "dashed", text: "label" }), link("br", J("ab", 0.4), "C")];

  it("branches a link: the new link starts on a junction and copies the parent's style, not its label", () => {
    const next = applyLinkEnd(shapes, { kind: "branch", linkId: "ab", t: 0.3 }, autoAnchor("D"), P, {}, newId)!;
    const added = next[next.length - 1];
    expect(added.a1).toEqual(J("ab", 0.3));
    expect(added.a2!.id).toBe("D");
    expect(added.c).toBe("#f87171");
    expect(added.dash).toBe("dashed");
    expect(added.text).toBeUndefined();
    expect(applyLinkEnd(shapes, { kind: "branch", linkId: "ab", t: 0.3 }, J("ab", 0.6), P, {}, newId)).toBeNull();
  });

  it("merges: a new link or a re-attached end can land on a link", () => {
    const merged = applyLinkEnd(shapes, { kind: "connect", fromId: "D" }, J("ab", 0.8), P, {}, newId)!;
    expect(merged[merged.length - 1].a2).toEqual(J("ab", 0.8));
    const moved = applyLinkEnd(shapes, { kind: "reattach", linkId: "br", end: 2 }, J("ab", 0.9), P, {}, newId);
    expect(moved).toBeNull(); // both ends on the same parent
  });

  it("slides a junction along its parent (clamped), and refuses a cycle", () => {
    const slid = applyLinkEnd(shapes, { kind: "reattach", linkId: "br", end: 1 }, J("ab", 0.99), P, {}, newId)!;
    expect(slid.find((s) => s.id === "br")!.a1).toEqual({ id: "ab", fx: JUNCTION_T_MAX, fy: 0.5 });
    // ab cannot hang from its own branch.
    expect(applyLinkEnd(shapes, { kind: "reattach", linkId: "ab", end: 2 }, J("br", 0.5), P, {}, newId)).toBeNull();
  });

  it("filters the links a dragged end may target", () => {
    const base = gestureBase({ kind: "reattach", linkId: "ab", end: 2 }, shapes)!;
    const allow = linkTargetFilter({ kind: "reattach", linkId: "ab", end: 2 }, base, linkIndex(shapes));
    expect(allow("ab")).toBe(false);
    expect(allow("br")).toBe(false);
    const geos = resolveLinkGeos(shapes, items, 1).geos;
    const mid = pointAt(geos[0].path.pts, 0.8);
    const free = findLinkTarget(geos, mid.x, mid.y + 3, 10, () => true);
    expect(free).toMatchObject({ kind: "link", id: "ab" });
    expect((free as { t: number }).t).toBeCloseTo(0.8, 1);
    expect(findLinkTarget(geos, mid.x, mid.y + 3, 10, (id) => id !== "ab")).toBeNull();
  });
});

describe("cascade delete and re-root", () => {
  it("re-roots a fork on the parent's source and a merge on the parent's target, keeping style", () => {
    const shapes = [link("ab", "A", "B"), link("fork", J("ab", 0.5), "C", { c: "#4ade80" }), link("merge", "D", J("ab", 0.5))];
    const next = removeShapes(shapes, new Set(["ab"]));
    expect(next.map((s) => s.id)).toEqual(["fork", "merge"]);
    expect(next[0].a1).toEqual(autoAnchor("A"));
    expect(next[0].c).toBe("#4ade80");
    expect(next[1].a2).toEqual(autoAnchor("B"));
  });

  it("removes a branch with nowhere to go, and cascades down nested branches", () => {
    const shapes = [link("ab", "A", "B"), link("br", J("ab", 0.5), "C"), link("deep", J("br", 0.5), "D")];
    // Deleting item A removes ab; br re-roots on B (its source A is gone); deep keeps hanging from br.
    const pruned = pruneLinks(shapes, new Set(["A"]));
    expect(pruned.map((s) => `${s.id}:${s.a1!.id}`)).toEqual(["br:B", "deep:br"]);
    // A and B gone: br cannot re-root, so it goes; deep falls back on br's target item, C.
    expect(pruneLinks(shapes, new Set(["A", "B"])).map((s) => `${s.id}:${s.a1!.id}>${s.a2!.id}`)).toEqual(["deep:C>D"]);
    expect(pruneLinks(shapes, new Set(["A", "B", "C"]))).toEqual([]);
    // A fork never re-roots on its own target: it takes the parent's other end, or goes.
    const loop = [link("ab", "A", "C"), link("br", J("ab", 0.5), "A")];
    expect(removeShapes(loop, new Set(["ab"])).map((s) => `${s.a1!.id}>${s.a2!.id}`)).toEqual(["C>A"]);
    expect(removeShapes(loop, new Set(["ab"]), new Set(["C"]))).toEqual([]);
    expect(removeShapes(shapes, new Set())).toBe(shapes);
  });

  it("detaches a branch to the closer end of its parent", () => {
    const shapes = [link("ab", "A", "B"), link("near", J("ab", 0.2), "C"), link("far", J("ab", 0.8), "C")];
    const a = detachBranch(shapes, "near", 1).find((s) => s.id === "near")!;
    const b = detachBranch(shapes, "far", 1).find((s) => s.id === "far")!;
    expect(a.a1!.id).toBe("A");
    expect(b.a1!.id).toBe("B");
  });
});

describe("edits that keep junctions in place", () => {
  it("mirrors branches of a reversed link", () => {
    const shapes = [link("ab", "A", "B"), link("br", J("ab", 0.3), "C")];
    expect(mirrorJunctions(shapes, new Set(["ab"]))[1].a1!.fx).toBeCloseTo(0.7, 9);
  });

  it("moves branches of the second half when an item is inserted into the link", () => {
    const shapes = [link("ab", "A", "B"), link("b1", J("ab", 0.25), "C"), link("b2", J("ab", 0.75), "D")];
    const next = insertIntoLink(shapes, "ab", "X", "xb")!;
    expect(next.find((s) => s.id === "b1")!.a1).toEqual(J("ab", 0.5));
    expect(next.find((s) => s.id === "b2")!.a1).toEqual(J("xb", 0.5));
    expect(splitJunctions(shapes, "zz", "yy")).toEqual(shapes);
  });

  it("copies branches along with their parent", () => {
    const shapes = [link("ab", "A", "B"), link("br", J("ab", 0.5), "C"), link("out", J("ab", 0.5), "Z")];
    expect(linksWithin(shapes, new Set(["A", "B", "C"])).map((s) => s.id)).toEqual(["ab", "br"]);
    const copies = remapLinks(linksWithin(shapes, new Set(["A", "B", "C"])), new Map([["A", "A2"], ["B", "B2"], ["C", "C2"]]), newId);
    const [ab2, br2] = copies;
    expect(br2.a1!.id).toBe(ab2.id);
    expect(br2.a1!.fx).toBe(0.5);
    expect(ab2.a1!.id).toBe("A2");
  });
});

describe("node logic through junctions", () => {
  const shapes = [link("ab", "A", "B"), link("fork", J("ab", 0.5), "C"), link("merge", "D", J("ab", 0.5)), link("ce", "C", "E")];

  it("selects downstream and upstream following direction and junctions", () => {
    expect([...downstreamOf(shapes, ["A"])].sort()).toEqual(["B", "C", "E"]);
    expect([...downstreamOf(shapes, ["D"])]).toEqual(["B"]);
    expect([...upstreamOf(shapes, ["B"])].sort()).toEqual(["A", "D"]);
    expect([...upstreamOf(shapes, ["E"])].sort()).toEqual(["A", "C"]);
    expect(connectedIds(shapes, "A").shapeIds).toEqual(new Set(["ab", "fork"]));
  });

  it("hides the downstream subtree of a collapsed node, not the node", () => {
    expect([...collapsedHidden(shapes, ["C"])]).toEqual(["E"]);
    const loop = [link("ab", "A", "B"), link("ba", "B", "A")];
    expect([...collapsedHidden(loop, ["A"])]).toEqual(["B"]);
  });

  it("organises a branch as a child of the parent's source", () => {
    const nodes: NodeBox[] = [
      { id: "A", x: 0, y: 0, w: 100, h: 60 }, { id: "B", x: 50, y: 300, w: 100, h: 60 }, { id: "C", x: 500, y: -200, w: 100, h: 60 },
    ];
    const pos = organiseLayout(nodes, [link("ab", "A", "B"), link("fork", J("ab", 0.5), "C")], "A", "tree-right", 20);
    // B and C are both children of A: same column, right of A.
    expect(pos.get("B")!.x).toBe(pos.get("C")!.x);
    expect(pos.get("B")!.x).toBeGreaterThan(100);
  });
});

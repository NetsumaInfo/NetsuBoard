// Pure link graph (links/graph.ts) and the link style helpers of links/model.ts: chain and star
// linking, insert-into-link, link copies on duplicate, the Organise layouts, label style encoding.

import { describe, expect, it } from "vitest";
import {
  chainPairs, componentOf, insertIntoLink, linksForPairs, linksWithin, neighboursOf, organiseLayout, remapLinks, starPairs,
  type NodeBox,
} from "@/components/reference/links/graph";
import {
  autoAnchor, formatLabelStyle, labelLayout, linkWidthPx, makeLink, parseLabelStyle, styleOf, widthPreset,
  LINK_WIDTH_MAX,
} from "@/components/reference/links/model";
import type { DrawShape } from "@/components/reference/referenceShared";

const P: [number, number, number, number] = [0, 0, 0, 0];
const link = (id: string, a: string, b: string, extra: Partial<DrawShape> = {}): DrawShape =>
  ({ ...makeLink(id, autoAnchor(a), autoAnchor(b), P), ...extra });
const ends = (s: DrawShape) => `${s.a1!.id}>${s.a2!.id}`;
const node = (id: string, x: number, y: number, w = 100, h = 60): NodeBox => ({ id, x, y, w, h });

const overlaps = (a: NodeBox, b: NodeBox) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
function placed(nodes: NodeBox[], pos: Map<string, { x: number; y: number }>): NodeBox[] {
  return nodes.map((n) => ({ ...n, ...(pos.get(n.id) ?? {}) }));
}
function noOverlap(boxes: NodeBox[]) {
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j])).toBe(false);
}

describe("connections", () => {
  const shapes = [link("1", "a", "b"), link("2", "b", "c"), link("3", "x", "y")];

  it("finds direct neighbours in both directions", () => {
    expect([...neighboursOf(shapes, ["b"])].sort()).toEqual(["a", "c"]);
  });

  it("walks the whole connected group", () => {
    expect([...componentOf(shapes, ["a"])].sort()).toEqual(["a", "b", "c"]);
    expect([...componentOf(shapes, ["y"])].sort()).toEqual(["x", "y"]);
  });
});

describe("chain and star", () => {
  const make = (a: string, b: string) => link(`${a}${b}`, a, b);

  it("links a selection in order as a chain", () => {
    expect(chainPairs(["a", "b", "c"])).toEqual([["a", "b"], ["b", "c"]]);
    expect(linksForPairs([], chainPairs(["a", "b", "c"]), make).map(ends)).toEqual(["a>b", "b>c"]);
  });

  it("links the first item to every other one as a star", () => {
    expect(starPairs(["hub", "a", "b"])).toEqual([["hub", "a"], ["hub", "b"]]);
  });

  it("never duplicates an existing link, whatever its direction", () => {
    const existing = [link("1", "b", "a")];
    expect(linksForPairs(existing, [["a", "b"], ["a", "c"], ["a", "c"], ["c", "c"]], make).map(ends)).toEqual(["a>c"]);
  });
});

describe("insert into a link", () => {
  it("turns A→B into A→X→B, keeping the label and style on the first half", () => {
    const shapes = [link("l", "a", "b", { text: "why", c: "#f87171", w: 3.5, dash: "dashed" })];
    const next = insertIntoLink(shapes, "l", "x", "new")!;
    expect(next.map(ends)).toEqual(["a>x", "x>b"]);
    expect(next[0].id).toBe("l");
    expect(next[0].text).toBe("why");
    expect(next[1].text).toBeUndefined();
    expect(next[1]).toMatchObject({ c: "#f87171", w: 3.5, dash: "dashed" });
  });

  it("refuses an end of the link or an item already linked to an end", () => {
    const shapes = [link("l", "a", "b"), link("m", "x", "b")];
    expect(insertIntoLink(shapes, "l", "a", "n")).toBeNull();
    expect(insertIntoLink(shapes, "l", "x", "n")).toBeNull();
  });
});

describe("copies keep their links", () => {
  it("re-anchors links between copied items onto the copies", () => {
    const shapes = [link("1", "a", "b", { a1: { id: "a", fx: 1, fy: 0.5 } }), link("2", "b", "c")];
    let n = 0;
    const copies = remapLinks(shapes, new Map([["a", "A"], ["b", "B"]]), () => `n${++n}`);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ id: "n1", a1: { id: "A", fx: 1, fy: 0.5 }, a2: { id: "B" } });
    expect(shapes[0].a1!.id).toBe("a");
  });

  it("keeps only the links inside a set", () => {
    const shapes = [link("1", "a", "b"), link("2", "b", "c")];
    expect(linksWithin(shapes, new Set(["a", "b"])).map((s) => s.id)).toEqual(["1"]);
  });
});

describe("organise", () => {
  const nodes = [node("r", 0, 0), node("a", 500, 300), node("b", 40, -400), node("c", 900, 900, 200, 120), node("d", -300, 50)];
  const shapes = [link("1", "r", "a"), link("2", "r", "b"), link("3", "a", "c"), link("4", "d", "r")];

  it("lays out a left-to-right tree: root fixed, one column per level, no overlap", () => {
    const pos = organiseLayout(nodes, shapes, "r", "tree-right", 20);
    const out = placed(nodes, pos);
    expect(pos.get("r")).toEqual({ x: 0, y: 0 });
    const x = (id: string) => out.find((n) => n.id === id)!.x;
    expect(x("a")).toBeGreaterThan(100);
    expect(x("b")).toBeCloseTo(x("a"));
    expect(x("c")).toBeGreaterThan(x("a") + 100);
    noOverlap(out);
    // Sizes are never touched.
    expect(out.find((n) => n.id === "c")).toMatchObject({ w: 200, h: 120 });
  });

  it("keeps the current order of siblings", () => {
    const out = placed(nodes, organiseLayout(nodes, shapes, "r", "tree-right", 20));
    const y = (id: string) => out.find((n) => n.id === id)!.y;
    // b sat above d, which sat above a.
    expect(y("b")).toBeLessThan(y("d"));
    expect(y("d")).toBeLessThan(y("a"));
  });

  it("lays out a top-down tree", () => {
    const out = placed(nodes, organiseLayout(nodes, shapes, "r", "tree-down", 20));
    const at = (id: string) => out.find((n) => n.id === id)!;
    expect(at("a").y).toBeGreaterThan(60);
    expect(at("c").y).toBeGreaterThan(at("a").y + 60);
    noOverlap(out);
  });

  it("lays out a mind map on rings around the root", () => {
    const pos = organiseLayout(nodes, shapes, "r", "radial", 20);
    const out = placed(nodes, pos);
    expect(pos.get("r")).toEqual({ x: 0, y: 0 });
    const dist = (id: string) => {
      const n = out.find((m) => m.id === id)!;
      return Math.hypot(n.x + n.w / 2 - 50, n.y + n.h / 2 - 30);
    };
    expect(dist("a")).toBeCloseTo(dist("b"));
    expect(dist("a")).toBeCloseTo(dist("d"));
    expect(dist("c")).toBeGreaterThan(dist("a"));
    noOverlap(out);
  });

  it("does nothing for an unlinked item or a root off the level", () => {
    expect(organiseLayout(nodes, [], "r", "tree-right", 20).size).toBe(0);
    expect(organiseLayout(nodes, shapes, "zz", "radial", 20).size).toBe(0);
  });
});

describe("link style", () => {
  it("encodes the label style in the synced fill field and reads it back", () => {
    const st = { bg: "transparent", color: "#ffffff", size: 15, bold: true, italic: true, font: "'Caveat', cursive" };
    const fill = formatLabelStyle(st)!;
    expect(fill.length).toBeLessThanOrEqual(128);
    expect(parseLabelStyle(fill)).toEqual(st);
    expect(formatLabelStyle({})).toBeUndefined();
    expect(parseLabelStyle(undefined)).toEqual({});
    expect(parseLabelStyle("#ff0000")).toEqual({});
  });

  it("cuts a long font family to stay within the document limit", () => {
    const fill = formatLabelStyle({ bg: "rgba(255, 255, 255, 0.50)", font: "x".repeat(300) })!;
    expect(fill.length).toBe(128);
  });

  it("clamps a custom width and recognises presets", () => {
    expect(linkWidthPx(40)).toBe(LINK_WIDTH_MAX);
    expect(linkWidthPx(4.5)).toBe(4.5);
    expect(widthPreset(2)).toBe("normal");
    expect(widthPreset(2.2)).toBeNull();
  });

  it("creates links with a given style, copied by styleOf", () => {
    const l = makeLink("x", autoAnchor("a"), autoAnchor("b"), P, { c: "#000", route: "elbow", h2: "none", op: 0.5 });
    expect(l).toMatchObject({ c: "#000", route: "elbow", h2: "none", op: 0.5, w: 2 });
    expect(styleOf(l)).toMatchObject({ c: "#000", route: "elbow", h2: "none", op: 0.5 });
  });

  it("grows the label line height with its font size", () => {
    const measure = (s: string) => s.length * 6;
    expect(labelLayout("hi", measure).h).toBe(16 + 6);
    expect(labelLayout("hi", measure, 200, 24).h).toBe(32 + 6);
  });
});

// Pure graph operations on board links: who is connected to whom, linking a selection as a chain or
// a star, dropping an item into the middle of a link, copying the links of a duplicated set, and
// the "Organise" layouts (trees and mind map) computed from the links. No store, no DOM.
//
// The links form an UNDIRECTED graph for grouping and organising: a mood board link is read in both
// directions there; only its arrowheads show a direction (downstream / upstream selection, in
// junction.ts, follows it). A branch through a junction counts as an edge between the items its flow
// joins (see `itemEdges`).

import type { DrawShape } from "../referenceShared";
import { autoAnchor, isLink, makeLink, styleOf } from "./model";
import { itemEdges, linkIndex, splitJunctions } from "./junction";

export interface NodeBox { id: string; x: number; y: number; w: number; h: number }
export interface Placement { x: number; y: number }
export type OrganiseMode = "tree-right" | "tree-down" | "radial";
export const ORGANISE_MODES: readonly OrganiseMode[] = ["tree-right", "tree-down", "radial"];

// Distance between two levels of a tree, as a multiple of the sibling gap: room for the link.
const LEVEL_GAP_FACTOR = 3;

type Pair = [string, string];
type MakeLink = (from: string, to: string) => DrawShape;

// ---------------------------------------------------------------------------------------------
// Adjacency
// ---------------------------------------------------------------------------------------------

export function adjacency(shapes: readonly DrawShape[], within?: ReadonlySet<string>): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    let set = adj.get(a);
    if (!set) adj.set(a, (set = new Set()));
    set.add(b);
  };
  for (const { from: a, to: b } of itemEdges(shapes)) {
    if (within && (!within.has(a) || !within.has(b))) continue;
    add(a, b);
    add(b, a);
  }
  return adj;
}

// Items directly linked to any of `ids`, the starting items excluded.
export function neighboursOf(shapes: readonly DrawShape[], ids: Iterable<string>): Set<string> {
  const adj = adjacency(shapes);
  const start = new Set(ids);
  const out = new Set<string>();
  for (const id of start) for (const n of adj.get(id) ?? []) if (!start.has(n)) out.add(n);
  return out;
}

// Every item reachable from `ids` through links, the starting items included.
export function componentOf(shapes: readonly DrawShape[], ids: Iterable<string>, within?: ReadonlySet<string>): Set<string> {
  const adj = adjacency(shapes, within);
  const seen = new Set(ids);
  const queue = [...seen];
  while (queue.length) {
    const id = queue.shift()!;
    for (const n of adj.get(id) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return seen;
}

// Links whose flow starts or ends at an item (branches through junctions included), in board order.
export function linksOfItem(shapes: readonly DrawShape[], itemId: string): DrawShape[] {
  const touching = new Set(itemEdges(shapes).filter((e) => e.from === itemId || e.to === itemId).map((e) => e.link.id));
  return shapes.filter((s) => touching.has(s.id));
}

export function linkedEitherWay(shapes: readonly DrawShape[], a: string, b: string): boolean {
  return itemEdges(shapes).some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
}

// ---------------------------------------------------------------------------------------------
// Linking a selection
// ---------------------------------------------------------------------------------------------

// a→b, b→c, c→d… in the given order.
export function chainPairs(ids: readonly string[]): Pair[] {
  const out: Pair[] = [];
  for (let i = 1; i < ids.length; i++) out.push([ids[i - 1], ids[i]]);
  return out;
}

// First item to every other one.
export function starPairs(ids: readonly string[]): Pair[] {
  return ids.slice(1).map((id) => [ids[0], id] as Pair);
}

// New links for pairs that are not linked yet (in either direction), never an item to itself.
export function linksForPairs(shapes: readonly DrawShape[], pairs: readonly Pair[], make: MakeLink): DrawShape[] {
  const added: DrawShape[] = [];
  for (const [a, b] of pairs) {
    if (a === b || linkedEitherWay(shapes, a, b) || linkedEitherWay(added, a, b)) continue;
    added.push(make(a, b));
  }
  return added;
}

// ---------------------------------------------------------------------------------------------
// Editing links
// ---------------------------------------------------------------------------------------------

// A→B becomes A→X→B: the first half keeps the link (id, style, label, start anchor), the second
// half copies its style; branches on the second half move to it. Null when the item is already an
// end of the link, or is linked to an end.
export function insertIntoLink(shapes: readonly DrawShape[], linkId: string, itemId: string, newId: string): DrawShape[] | null {
  const link = shapes.find((s) => s.id === linkId);
  if (!link || !isLink(link)) return null;
  const a = link.a1!.id, b = link.a2!.id;
  if (itemId === a || itemId === b) return null;
  if (linkedEitherWay(shapes, a, itemId) || linkedEitherWay(shapes, itemId, b)) return null;
  const mid = autoAnchor(itemId);
  const second = makeLink(newId, mid, link.a2!, [...link.p] as [number, number, number, number], styleOf(link));
  return splitJunctions([...shapes.map((s) => (s.id === linkId ? { ...s, a2: mid } : s)), second], linkId, newId);
}

// Links of `shapes` whose every end is an item of `ids` or another such link (branches come along
// with their parent).
function closedLinks(shapes: readonly DrawShape[], ids: (id: string) => boolean): Set<string> {
  const links = linkIndex(shapes);
  const kept = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of links.values()) {
      if (kept.has(s.id)) continue;
      const ok = (id: string) => ids(id) || kept.has(id);
      if (ok(s.a1!.id) && ok(s.a2!.id)) { kept.add(s.id); grew = true; }
    }
  }
  return kept;
}

// Copies of the links whose ends were copied, re-anchored onto the copies (same fractions); a
// branch whose parent link is copied too hangs from the parent's copy.
export function remapLinks(shapes: readonly DrawShape[], idMap: ReadonlyMap<string, string>, newId: () => string): DrawShape[] {
  const kept = closedLinks(shapes, (id) => idMap.has(id));
  const linkMap = new Map<string, string>();
  for (const id of kept) linkMap.set(id, newId());
  const map = (id: string) => idMap.get(id) ?? linkMap.get(id)!;
  const out: DrawShape[] = [];
  for (const s of shapes) {
    if (!kept.has(s.id)) continue;
    out.push({ ...s, id: linkMap.get(s.id)!, p: [...s.p], a1: { ...s.a1!, id: map(s.a1!.id) }, a2: { ...s.a2!, id: map(s.a2!.id) } });
  }
  return out;
}

// Links between items of the set, with the branches between them (what a copy of the set carries).
export function linksWithin(shapes: readonly DrawShape[], ids: ReadonlySet<string>): DrawShape[] {
  const kept = closedLinks(shapes, (id) => ids.has(id));
  return shapes.filter((s) => kept.has(s.id));
}

// ---------------------------------------------------------------------------------------------
// Organise
// ---------------------------------------------------------------------------------------------

interface Tree {
  root: string;
  children: Map<string, string[]>;
  depth: Map<string, number>;
}

const centre = (n: NodeBox) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });

// Breadth-first spanning tree from the root. Siblings keep the order they already have on the
// board along `order`, so organising twice changes nothing and the user's own order is kept.
function spanningTree(nodes: ReadonlyMap<string, NodeBox>, adj: Map<string, Set<string>>, root: string, order: (n: NodeBox) => number): Tree {
  const children = new Map<string, string[]>();
  const depth = new Map<string, number>([[root, 0]]);
  const queue = [root];
  while (queue.length) {
    const id = queue.shift()!;
    const next = [...(adj.get(id) ?? [])].filter((n) => nodes.has(n) && !depth.has(n));
    next.sort((p, q) => order(nodes.get(p)!) - order(nodes.get(q)!));
    for (const n of next) depth.set(n, depth.get(id)! + 1);
    children.set(id, next);
    queue.push(...next);
  }
  return { root, children, depth };
}

// Classic tidy tree: each subtree takes the room of its children along the cross axis, and every
// level is a column (tree-right) or a row (tree-down) as wide as its widest item.
function treeLayout(nodes: ReadonlyMap<string, NodeBox>, tree: Tree, down: boolean, gap: number): Map<string, Placement> {
  const main = (n: NodeBox) => (down ? n.h : n.w);
  const cross = (n: NodeBox) => (down ? n.w : n.h);
  const extent = new Map<string, number>();
  const measure = (id: string): number => {
    const kids = tree.children.get(id) ?? [];
    const sum = kids.reduce((acc, k) => acc + measure(k), 0) + gap * Math.max(0, kids.length - 1);
    const e = Math.max(cross(nodes.get(id)!), sum);
    extent.set(id, e);
    return e;
  };
  measure(tree.root);

  const levelSize: number[] = [];
  for (const [id, d] of tree.depth) levelSize[d] = Math.max(levelSize[d] ?? 0, main(nodes.get(id)!));
  const rootBox = nodes.get(tree.root)!;
  const levelStart: number[] = [down ? rootBox.y : rootBox.x];
  for (let d = 1; d < levelSize.length; d++) levelStart[d] = levelStart[d - 1] + levelSize[d - 1] + gap * LEVEL_GAP_FACTOR;

  const out = new Map<string, Placement>();
  const place = (id: string, start: number) => {
    const n = nodes.get(id)!;
    const d = tree.depth.get(id)!;
    const e = extent.get(id)!;
    const c = start + (e - cross(n)) / 2;
    const m = levelStart[d] + (levelSize[d] - main(n)) / 2;
    out.set(id, down ? { x: c, y: m } : { x: m, y: c });
    const kids = tree.children.get(id) ?? [];
    const total = kids.reduce((acc, k) => acc + extent.get(k)!, 0) + gap * Math.max(0, kids.length - 1);
    let at = start + (e - total) / 2;
    for (const k of kids) {
      place(k, at);
      at += extent.get(k)! + gap;
    }
  };
  const rc = centre(rootBox);
  place(tree.root, (down ? rc.x : rc.y) - extent.get(tree.root)! / 2);
  // The root does not move: shift the whole tree back under it along the main axis too.
  const r = out.get(tree.root)!;
  const dx = rootBox.x - r.x, dy = rootBox.y - r.y;
  for (const [id, p] of out) out.set(id, { x: p.x + dx, y: p.y + dy });
  return out;
}

// Mind map: the root stays, each level is a ring around it, and every subtree gets a wedge of the
// circle in proportion to its number of leaves.
function radialLayout(nodes: ReadonlyMap<string, NodeBox>, tree: Tree, gap: number): Map<string, Placement> {
  const diag = (n: NodeBox) => Math.hypot(n.w, n.h);
  const leaves = new Map<string, number>();
  const count = (id: string): number => {
    const kids = tree.children.get(id) ?? [];
    const n = kids.length ? kids.reduce((acc, k) => acc + count(k), 0) : 1;
    leaves.set(id, n);
    return n;
  };
  count(tree.root);

  const ring: { maxDiag: number; sum: number }[] = [];
  for (const [id, d] of tree.depth) {
    const r = (ring[d] ??= { maxDiag: 0, sum: 0 });
    const dg = diag(nodes.get(id)!);
    r.maxDiag = Math.max(r.maxDiag, dg);
    r.sum += dg + gap;
  }
  const radius: number[] = [0];
  for (let d = 1; d < ring.length; d++) {
    const out = radius[d - 1] + ring[d - 1].maxDiag / 2 + ring[d].maxDiag / 2 + gap * LEVEL_GAP_FACTOR;
    radius[d] = Math.max(out, ring[d].sum / (2 * Math.PI));
  }

  const c = centre(nodes.get(tree.root)!);
  const out = new Map<string, Placement>();
  const place = (id: string, from: number, to: number) => {
    const n = nodes.get(id)!;
    const d = tree.depth.get(id)!;
    const ang = (from + to) / 2;
    const r = radius[d];
    out.set(id, { x: c.x + Math.cos(ang) * r - n.w / 2, y: c.y + Math.sin(ang) * r - n.h / 2 });
    const kids = tree.children.get(id) ?? [];
    const total = leaves.get(id)!;
    let at = from;
    for (const k of kids) {
      const span = ((to - from) * leaves.get(k)!) / total;
      place(k, at, at + span);
      at += span;
    }
  };
  const start = -Math.PI / 2;
  place(tree.root, start, start + Math.PI * 2);
  return out;
}

// New top-left positions of the items linked to `rootId` (directly or not), sizes untouched. Items
// absent from `nodes` (another level, a folded folder) are skipped. The root never moves.
export function organiseLayout(nodes: readonly NodeBox[], shapes: readonly DrawShape[], rootId: string, mode: OrganiseMode, gap: number): Map<string, Placement> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (!byId.has(rootId)) return new Map();
  const ids = new Set(byId.keys());
  const adj = adjacency(shapes, ids);
  const rc = centre(byId.get(rootId)!);
  const order = mode === "tree-right"
    ? (n: NodeBox) => centre(n).y
    : mode === "tree-down"
      ? (n: NodeBox) => centre(n).x
      : (n: NodeBox) => {
        const p = centre(n);
        // Angle measured from the top, clockwise, to match where the radial layout starts.
        const a = Math.atan2(p.y - rc.y, p.x - rc.x) + Math.PI / 2;
        return a < 0 ? a + Math.PI * 2 : a;
      };
  const tree = spanningTree(byId, adj, rootId, order);
  if (tree.depth.size < 2) return new Map();
  return mode === "radial" ? radialLayout(byId, tree, gap) : treeLayout(byId, tree, mode === "tree-down", gap);
}

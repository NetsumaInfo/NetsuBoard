// Junctions: a link end attached to ANOTHER LINK, node-editor style — one wire that splits in two
// (fork) or two wires that join (merge). Pure topology: no store, no DOM, no geometry beyond the
// sampled polyline of a path. Runtime imports stay out of model.ts (model re-exports from here).
//
// Encoding — no new document field. A link end is a `ShapeAnchor { id, fx, fy }` like any other:
//   - `id` is an ITEM id  → the end sits on that item (AUTO or FIXED, see model.ts);
//   - `id` is a LINK id   → the end is a junction on that parent link, `fx` = position along the
//                           parent's path (arc-length fraction, clamped JUNCTION_T_MIN..MAX), and
//                           `fy` = 0.5 (unused, kept inside the 0..1 range the document validates).
// Item ids and shape ids come from the same generator and never collide, so the parent lookup alone
// tells the two apart. A junction may hang from another branch (nested), up to JUNCTION_MAX_DEPTH;
// a link never hangs from itself or from one of its own descendants (no cycle).

import type { DrawShape, ShapeAnchor } from "../referenceShared";
import type { Dir, Pt } from "./model";

export const JUNCTION_T_MIN = 0.05;
export const JUNCTION_T_MAX = 0.95;
export const JUNCTION_FY = 0.5;
// Branches of branches stop here: deeper chains are not resolved (and cannot be created).
export const JUNCTION_MAX_DEPTH = 8;

const isLinkShape = (s: DrawShape) => (s.t === "arrow" || s.t === "line") && !!s.a1 && !!s.a2;
const autoEnd = (id: string): ShapeAnchor => ({ id, fx: 0.5, fy: 0.5 });

export type LinkIndex = ReadonlyMap<string, DrawShape>;

export function clampT(t: number): number {
  if (!Number.isFinite(t)) return 0.5;
  return Math.min(JUNCTION_T_MAX, Math.max(JUNCTION_T_MIN, t));
}

export function junctionAnchor(parentId: string, t: number): ShapeAnchor {
  return { id: parentId, fx: clampT(t), fy: JUNCTION_FY };
}

// Links of a shape list by id.
export function linkIndex(shapes: readonly DrawShape[]): Map<string, DrawShape> {
  const m = new Map<string, DrawShape>();
  for (const s of shapes) if (isLinkShape(s)) m.set(s.id, s);
  return m;
}

export function isJunction(a: ShapeAnchor | undefined, links: LinkIndex): boolean {
  return !!a && links.has(a.id);
}

// The link has at least one end on another link.
export function isBranch(s: DrawShape, links: LinkIndex): boolean {
  return isJunction(s.a1, links) || isJunction(s.a2, links);
}

// Ids of the links `s` hangs from directly.
export function parentIds(s: DrawShape, links: LinkIndex): string[] {
  const out: string[] = [];
  if (isJunction(s.a1, links)) out.push(s.a1!.id);
  if (isJunction(s.a2, links) && s.a2!.id !== s.a1!.id) out.push(s.a2!.id);
  return out;
}

// Number of junction levels above a link (0 = both ends on items). Infinity on a cycle.
export function junctionDepth(links: LinkIndex, id: string, seen: Set<string> = new Set()): number {
  const s = links.get(id);
  if (!s) return 0;
  if (seen.has(id) || seen.size > JUNCTION_MAX_DEPTH) return Infinity;
  seen.add(id);
  let d = 0;
  for (const p of parentIds(s, links)) d = Math.max(d, 1 + junctionDepth(links, p, seen));
  seen.delete(id);
  return d;
}

// `id` hangs (directly or not) from `ancestor`, or is it.
export function dependsOn(links: LinkIndex, id: string, ancestor: string): boolean {
  const stack = [id];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === ancestor) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const s = links.get(cur);
    if (s) stack.push(...parentIds(s, links));
  }
  return false;
}

// Can an end of link `linkId` (null = a link not created yet) be attached to `parentId`?
export function canAttach(links: LinkIndex, linkId: string | null, parentId: string): boolean {
  if (!links.has(parentId) || parentId === linkId) return false;
  if (linkId && dependsOn(links, parentId, linkId)) return false;
  return junctionDepth(links, parentId) + 1 <= JUNCTION_MAX_DEPTH;
}

// The ITEM a link's flow starts from: its start item, or (through junctions) the start item of the
// link it forks from. Null on a cycle or a missing parent.
export function rootSource(links: LinkIndex, s: DrawShape): string | null {
  return rootAlong(links, s, 1);
}

// The ITEM a link's flow ends in: its end item, or the end item of the link it merges into.
export function rootTarget(links: LinkIndex, s: DrawShape): string | null {
  return rootAlong(links, s, 2);
}

function rootAlong(links: LinkIndex, s: DrawShape, end: 1 | 2): string | null {
  let cur: DrawShape | undefined = s;
  for (let i = 0; cur && i <= JUNCTION_MAX_DEPTH; i++) {
    const a: ShapeAnchor | undefined = end === 1 ? cur.a1 : cur.a2;
    if (!a) return null;
    if (!links.has(a.id)) return a.id;
    cur = links.get(a.id);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Item graph through junctions
// ---------------------------------------------------------------------------------------------

// One directed item→item edge per link: a branch counts as an edge from the flow's source item to
// its target item (a fork: parent's source → branch target; a merge: branch source → parent's
// target).
export interface ItemEdge { from: string; to: string; link: DrawShape }

export function itemEdges(shapes: readonly DrawShape[]): ItemEdge[] {
  const links = linkIndex(shapes);
  const out: ItemEdge[] = [];
  for (const s of links.values()) {
    const from = rootSource(links, s), to = rootTarget(links, s);
    if (from && to && from !== to) out.push({ from, to, link: s });
  }
  return out;
}

function reach(shapes: readonly DrawShape[], ids: Iterable<string>, dir: "down" | "up", within?: ReadonlySet<string>): Set<string> {
  const next = new Map<string, string[]>();
  for (const e of itemEdges(shapes)) {
    const [a, b] = dir === "down" ? [e.from, e.to] : [e.to, e.from];
    if (within && (!within.has(a) || !within.has(b))) continue;
    let list = next.get(a);
    if (!list) next.set(a, (list = []));
    list.push(b);
  }
  const start = new Set(ids);
  const seen = new Set<string>();
  const queue = [...start];
  while (queue.length) {
    const id = queue.shift()!;
    for (const n of next.get(id) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  for (const id of start) seen.delete(id);
  return seen;
}

// Items reached by following links forward (through junctions), the starting items excluded.
export function downstreamOf(shapes: readonly DrawShape[], ids: Iterable<string>, within?: ReadonlySet<string>): Set<string> {
  return reach(shapes, ids, "down", within);
}

// Items that lead to any of `ids` (through junctions), the starting items excluded.
export function upstreamOf(shapes: readonly DrawShape[], ids: Iterable<string>, within?: ReadonlySet<string>): Set<string> {
  return reach(shapes, ids, "up", within);
}

// Items hidden by collapsed nodes: everything downstream of each, the collapsed nodes themselves
// excluded unless another collapsed node hides them.
export function collapsedHidden(shapes: readonly DrawShape[], collapsed: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const id of collapsed) for (const n of downstreamOf(shapes, [id])) if (n !== id) out.add(n);
  return out;
}

// Links that can be drawn on a level: every end on an item of `ids`, or on a link that can itself
// be drawn (nested junctions resolved, cycles excluded).
export function linksOnLevel(shapes: readonly DrawShape[], ids: ReadonlySet<string>): Set<string> {
  const links = linkIndex(shapes);
  const memo = new Map<string, boolean>();
  const ok = (id: string): boolean => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    const s = links.get(id);
    if (!s) return false;
    memo.set(id, false); // provisional: a cycle through `id` resolves to false
    const end = (a: ShapeAnchor) => ids.has(a.id) || (links.has(a.id) && ok(a.id));
    const r = end(s.a1!) && end(s.a2!) && junctionDepth(links, id) <= JUNCTION_MAX_DEPTH;
    memo.set(id, r);
    return r;
  };
  const out = new Set<string>();
  for (const id of links.keys()) if (ok(id)) out.add(id);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Edits that keep junctions consistent
// ---------------------------------------------------------------------------------------------

// Item a branch end falls back to when its parent link goes: a fork (end 1) re-roots on the
// parent's source item, a merge (end 2) on the parent's target item, then the other one.
function rerootItem(links: LinkIndex, parent: DrawShape, end: 1 | 2, gone: ReadonlySet<string>, avoid: string | null): string | null {
  const order = end === 1 ? [rootSource(links, parent), rootTarget(links, parent)] : [rootTarget(links, parent), rootSource(links, parent)];
  for (const id of order) if (id && !gone.has(id) && id !== avoid) return id;
  return null;
}

// Removes shapes (any kind) and the links of removed items, then repairs what hung from a removed
// link: each orphaned branch end is re-rooted onto the parent's source (fork) or target (merge)
// item, keeping its style; a branch with nowhere to go is removed too, and so on down the tree.
// Returns the SAME array when nothing changes.
export function removeShapes(shapes: DrawShape[], goneShapes: ReadonlySet<string>, goneItems: ReadonlySet<string> = new Set()): DrawShape[] {
  if (!goneShapes.size && !goneItems.size) return shapes;
  const links = linkIndex(shapes);
  const dead = new Set<string>();
  for (const s of shapes) {
    if (goneShapes.has(s.id)) dead.add(s.id);
    else if (isLinkShape(s) && ((!links.has(s.a1!.id) && goneItems.has(s.a1!.id)) || (!links.has(s.a2!.id) && goneItems.has(s.a2!.id)))) dead.add(s.id);
  }
  if (!dead.size) return shapes;
  const patched = new Map<string, DrawShape>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const orig of links.values()) {
      if (dead.has(orig.id)) continue;
      const s = patched.get(orig.id) ?? orig;
      for (const end of [1, 2] as const) {
        const a = end === 1 ? s.a1! : s.a2!;
        if (!dead.has(a.id)) continue;
        const other = end === 1 ? s.a2! : s.a1!;
        const avoid = links.has(other.id) ? null : other.id;
        const item = rerootItem(links, links.get(a.id)!, end, goneItems, avoid);
        if (!item) {
          dead.add(s.id);
          changed = true;
          break;
        }
        patched.set(s.id, { ...(patched.get(s.id) ?? s), [end === 1 ? "a1" : "a2"]: autoEnd(item) });
        changed = true;
      }
    }
  }
  return shapes.filter((s) => !dead.has(s.id)).map((s) => patched.get(s.id) ?? s);
}

// Drops the links anchored to any of the removed items, cascading to their branches. Returns the
// SAME array when none is.
export function pruneLinks(shapes: DrawShape[], removed: ReadonlySet<string>): DrawShape[] {
  return removeShapes(shapes, new Set(), removed);
}

// "Detach branch": the junction end goes to the item of the parent it is closest to along the
// wire (source before the middle, target after), or the other one; with neither available the
// branch is deleted.
export function detachBranch(shapes: DrawShape[], linkId: string, end: 1 | 2): DrawShape[] {
  const links = linkIndex(shapes);
  const s = links.get(linkId);
  const a = s ? (end === 1 ? s.a1 : s.a2) : undefined;
  const parent = a ? links.get(a.id) : undefined;
  if (!s || !a || !parent) return shapes;
  const other = end === 1 ? s.a2! : s.a1!;
  const avoid = links.has(other.id) ? null : other.id;
  const order = a.fx < 0.5 ? [rootSource(links, parent), rootTarget(links, parent)] : [rootTarget(links, parent), rootSource(links, parent)];
  const item = order.find((id) => id && id !== avoid) ?? null;
  if (!item) return removeShapes(shapes, new Set([linkId]));
  return shapes.map((x) => (x.id === linkId ? { ...x, [end === 1 ? "a1" : "a2"]: autoEnd(item) } : x));
}

// The junction end of a branch (1 or 2), the first one when both are; null for a plain link.
export function junctionEndOf(s: DrawShape, links: LinkIndex): 1 | 2 | null {
  if (isJunction(s.a1, links)) return 1;
  if (isJunction(s.a2, links)) return 2;
  return null;
}

// Junction anchors pointing at a reversed link are mirrored (t → 1 − t): reversing a parent keeps
// its branches where they were on screen.
export function mirrorJunctions(shapes: DrawShape[], reversed: ReadonlySet<string>): DrawShape[] {
  const flip = (a: ShapeAnchor | undefined) => (a && reversed.has(a.id) ? { ...a, fx: clampT(1 - a.fx) } : a);
  return shapes.map((s) => {
    if (!isLinkShape(s) || (!reversed.has(s.a1!.id) && !reversed.has(s.a2!.id))) return s;
    return { ...s, a1: flip(s.a1), a2: flip(s.a2) };
  });
}

// Branches of a link cut in two at its middle (A→B becoming A→X→B): those on the first half stay on
// the link (t doubled), those on the second half move to the new second link.
export function splitJunctions(shapes: DrawShape[], linkId: string, secondId: string): DrawShape[] {
  const move = (a: ShapeAnchor | undefined): ShapeAnchor | undefined => {
    if (!a || a.id !== linkId) return a;
    return a.fx <= 0.5 ? junctionAnchor(linkId, a.fx * 2) : junctionAnchor(secondId, (a.fx - 0.5) * 2);
  };
  return shapes.map((s) => {
    if (!isLinkShape(s) || (s.a1!.id !== linkId && s.a2!.id !== linkId)) return s;
    return { ...s, a1: move(s.a1), a2: move(s.a2) };
  });
}

// ---------------------------------------------------------------------------------------------
// Along a path
// ---------------------------------------------------------------------------------------------

export interface PathPoint extends Pt, Dir {}

// Point at arc-length fraction `t` of a polyline, with the unit tangent there (path direction).
export function pointAt(pts: readonly number[], t: number): PathPoint {
  const n = pts.length / 2;
  if (n < 2) return { x: pts[0] ?? 0, y: pts[1] ?? 0, dx: 1, dy: 0 };
  let total = 0;
  for (let i = 1; i < n; i++) total += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
  let left = Math.min(1, Math.max(0, t)) * total;
  let last: PathPoint = { x: pts[0], y: pts[1], dx: 1, dy: 0 };
  for (let i = 1; i < n; i++) {
    const ax = pts[i * 2 - 2], ay = pts[i * 2 - 1], bx = pts[i * 2], by = pts[i * 2 + 1];
    const seg = Math.hypot(bx - ax, by - ay);
    if (seg <= 0) continue;
    const dx = (bx - ax) / seg, dy = (by - ay) / seg;
    if (left <= seg) return { x: ax + dx * left, y: ay + dy * left, dx, dy };
    left -= seg;
    last = { x: bx, y: by, dx, dy };
  }
  return last;
}

// Closest point of a polyline to (x, y): its arc-length fraction and the distance to it.
export function projectOnPath(pts: readonly number[], x: number, y: number): { t: number; dist: number } {
  const n = pts.length / 2;
  if (n < 2) return { t: 0, dist: Math.hypot(x - (pts[0] ?? 0), y - (pts[1] ?? 0)) };
  let total = 0, bestD = Infinity, bestAt = 0;
  for (let i = 1; i < n; i++) {
    const ax = pts[i * 2 - 2], ay = pts[i * 2 - 1], bx = pts[i * 2], by = pts[i * 2 + 1];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const seg = Math.sqrt(l2);
    const u = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const d = Math.hypot(x - (ax + dx * u), y - (ay + dy * u));
    if (d < bestD) { bestD = d; bestAt = total + seg * u; }
    total += seg;
  }
  return { t: total > 0 ? bestAt / total : 0, dist: bestD };
}

// Geometry of every link of a board, junctions included. Pure, shared by the links layer
// (useLinkScene, gestures) and the export (boardRender).
//
// A junction end sits on its parent's LIVE path, so links resolve in topological order (parents
// first, recursively, cycles and over-deep chains left out). A branch leaves its parent along the
// parent's tangent, oriented toward the branch's other end: the wire reads as one line splitting in
// two (fork) or two lines joining (merge).
//
// PORTS — several auto ends on one side of an item would pile up on its midpoint: they are spread
// along that side (see `portOffsets`), ordered by where their other end lies so the wires do not
// cross. A link with a junction end, or a straight link (it floats on the centre line), takes no
// part. PERF — each link's geometry is cached by a key of everything it depends on, its parent's key
// included: moving an item re-builds the links of that item and the branches hanging from them,
// and nothing else.

import type { DrawShape, ShapeAnchor } from "../referenceShared";
import { fromItemSpace } from "../boardArrange";
import {
  boxRect, centerOf, fixedEnd, freeEnd, isAutoAnchor, isLink, linkGeoFromEnds, linkRoute, placeItemEnds, portOffset, sideLength,
  sideTangent, type EndsOpts, type LinkBox, type LinkEnd, type LinkGeo, type Pt, type Side, type SideTarget,
} from "./model";
import { JUNCTION_MAX_DEPTH, clampT, pointAt, type PathPoint } from "./junction";

// Where one end of a link comes from, before it is placed against the other end.
export type EndSource =
  | { kind: "item"; box: LinkBox; a: ShapeAnchor }
  | { kind: "junction"; parentId: string; t: number; at: PathPoint }
  | { kind: "free"; p: Pt };

// The point an end is aimed at from the other end.
function refPoint(s: EndSource): Pt {
  if (s.kind === "junction") return s.at;
  if (s.kind === "free") return s.p;
  return isAutoAnchor(s.a) ? centerOf(s.box) : fromItemSpace(s.box, s.a.fx, s.a.fy);
}

// A junction end leaves along the parent's tangent, the way that faces `toward`.
export function junctionEnd(at: PathPoint, toward: Pt): LinkEnd {
  const sign = (toward.x - at.x) * at.dx + (toward.y - at.y) * at.dy >= 0 ? 1 : -1;
  return { x: at.x, y: at.y, dx: at.dx * sign, dy: at.dy * sign, side: null };
}

// Both ends of a link from their sources. Two items behave exactly like `resolveEnds`: the auto
// sides are picked as a pair. A junction or a free end faces the other end.
export function resolveSources(s0: EndSource, s1: EndSource, opts: EndsOpts = {}): [LinkEnd, LinkEnd] {
  const target = (s: EndSource): SideTarget => {
    if (s.kind === "item") return { box: s.box, fixed: isAutoAnchor(s.a) ? null : fixedEnd(s.box, s.a) };
    const p = refPoint(s);
    return { box: null, fixed: { x: p.x, y: p.y, dx: 0, dy: 0, side: null } };
  };
  const [i0, i1] = placeItemEnds(target(s0), target(s1), opts);
  const place = (s: EndSource, other: EndSource, placed: LinkEnd | null): LinkEnd => {
    if (placed) return placed;
    const toward = refPoint(other);
    return s.kind === "junction" ? junctionEnd(s.at, toward) : freeEnd(refPoint(s), toward);
  };
  return [place(s0, s1, i0), place(s1, s0, i1)];
}

// Source of an anchor: an item of `items`, or a junction on a link of `geos`. Null when neither.
export function endSource(a: ShapeAnchor, items: ReadonlyMap<string, LinkBox>, geos: ReadonlyMap<string, LinkGeo>): EndSource | null {
  const box = items.get(a.id);
  if (box) return box.w > 0 && box.h > 0 ? { kind: "item", box, a } : null;
  const parent = geos.get(a.id);
  if (!parent) return null;
  const t = clampT(a.fx);
  return { kind: "junction", parentId: a.id, t, at: pointAt(parent.path.pts, t) };
}

const boxKey = (b: LinkBox) => `${b.x},${b.y},${b.w},${b.h},${b.rotation || 0},${b.flipH ? 1 : 0}${b.flipV ? 1 : 0}`;

// Offset (world units) of the two ends of each link along their side, for the auto ends that share
// a side of an item with others.
export function portOffsets(links: ReadonlyMap<string, DrawShape>, items: ReadonlyMap<string, LinkBox>, k: number): Map<string, [number, number]> {
  interface Slot { id: string; end: 0 | 1; box: LinkBox; side: Side; proj: number; sign: number }
  const groups = new Map<string, Slot[]>();
  for (const s of links.values()) {
    if (linkRoute(s) === "straight") continue;
    const b0 = items.get(s.a1!.id), b1 = items.get(s.a2!.id);
    if (!b0 || !b1 || !(b0.w > 0 && b0.h > 0 && b1.w > 0 && b1.h > 0)) continue;
    const auto = [isAutoAnchor(s.a1!), isAutoAnchor(s.a2!)];
    if (!auto[0] && !auto[1]) continue;
    const boxes = [b0, b1], anchors = [s.a1!, s.a2!];
    const t = boxes.map((b, i): SideTarget => ({ box: b, fixed: auto[i] ? null : fixedEnd(b, anchors[i]) }));
    const ends = placeItemEnds(t[0], t[1]);
    for (const i of [0, 1] as const) {
      const e = ends[i], o = ends[1 - i];
      if (!auto[i] || !e || !o || !e.side) continue;
      const tan = sideTangent(e);
      const slot: Slot = { id: s.id, end: i, box: boxes[i], side: e.side, proj: Math.round(((o.x - e.x) * tan.dx + (o.y - e.y) * tan.dy) * 100), sign: tan.dx + tan.dy >= 0 ? 1 : -1 };
      const key = `${boxes[i].id}|${e.side}`;
      const g = groups.get(key);
      if (g) g.push(slot); else groups.set(key, [slot]);
    }
  }
  const out = new Map<string, [number, number]>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    // Ties (same other end) are broken by link id, the same way round on both ends of a bundle.
    g.sort((x, y) => x.proj - y.proj || x.sign * (x.id < y.id ? -1 : x.id > y.id ? 1 : 0) || x.end - y.end);
    g.forEach((slot, i) => {
      const off = out.get(slot.id) ?? [0, 0];
      off[slot.end] = portOffset(i, g.length, sideLength(slot.box, slot.side), k);
      out.set(slot.id, off);
    });
  }
  return out;
}

export interface GeoCacheEntry { key: string; geo: LinkGeo }
export type GeoCache = Map<string, GeoCacheEntry>;

export interface ResolvedLinks {
  geos: LinkGeo[];                    // parents before their branches
  byId: Map<string, LinkGeo>;
  cache: GeoCache;                    // hand back on the next call to reuse unchanged geometry
}

// Geometry of every link whose ends all resolve: items present in `items` (with a size), or
// parent links that resolve themselves. `prev` is the cache of the previous call.
export function resolveLinkGeos(shapes: readonly DrawShape[], items: ReadonlyMap<string, LinkBox>, k: number, prev?: GeoCache): ResolvedLinks {
  const links = new Map<string, DrawShape>();
  for (const s of shapes) if (isLink(s)) links.set(s.id, s);
  const byId = new Map<string, LinkGeo>();
  const keys = new Map<string, string>();
  const done = new Set<string>();
  const visiting = new Set<string>();
  const geos: LinkGeo[] = [];
  const cache: GeoCache = new Map();
  const ports = portOffsets(links, items, k);

  // Junction levels above each resolved link (0 = both ends on items).
  const height = new Map<string, number>();

  const visit = (id: string): boolean => {
    if (done.has(id)) return byId.has(id);
    if (visiting.has(id)) return false; // cycle
    const s = links.get(id)!;
    visiting.add(id);
    let h = 0;
    const ok = (a: ShapeAnchor) => {
      if (items.has(a.id)) return true;
      if (!links.has(a.id) || !visit(a.id)) return false;
      h = Math.max(h, (height.get(a.id) ?? 0) + 1);
      return true;
    };
    const resolvable = ok(s.a1!) && ok(s.a2!) && h <= JUNCTION_MAX_DEPTH;
    visiting.delete(id);
    done.add(id);
    if (!resolvable) return false;
    height.set(id, h);
    const s0 = endSource(s.a1!, items, byId), s1 = endSource(s.a2!, items, byId);
    if (!s0 || !s1) return false;
    const part = (src: EndSource, a: ShapeAnchor) =>
      src.kind === "junction" ? `J${src.t}:${keys.get(src.parentId)}` : `I${a.fx},${a.fy}:${boxKey((src as { box: LinkBox }).box)}`;
    const off = ports.get(id) ?? [0, 0];
    const key = `${s.route ?? ""}|${s.h1 ?? ""}${s.h2 ?? ""}|${s.w}|${k}|${part(s0, s.a1!)}|${part(s1, s.a2!)}|${off[0]},${off[1]}`;
    const hit = prev?.get(id);
    let geo: LinkGeo;
    if (hit && hit.key === key) geo = hit.geo.shape === s ? hit.geo : { ...hit.geo, shape: s };
    else {
      const [e0, e1] = resolveSources(s0, s1, { route: linkRoute(s), off0: off[0], off1: off[1] });
      const rect = (src: EndSource) => (src.kind === "item" ? boxRect(src.box) : null);
      geo = linkGeoFromEnds(s, e0, e1, k, s0.kind === "junction" ? s0.parentId : undefined, s1.kind === "junction" ? s1.parentId : undefined, [rect(s0), rect(s1)]);
    }
    keys.set(id, key);
    byId.set(id, geo);
    cache.set(id, { key, geo });
    geos.push(geo);
    return true;
  };

  for (const id of links.keys()) visit(id);
  return { geos, byId, cache };
}

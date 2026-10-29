// Pure model of board links (Obsidian-Canvas style edges between items). No store, no DOM.
//
// A link is NOT a separate record: it is a DrawShape (`arrow`/`line`) whose two ends are anchored
// to items (`a1`/`a2`), so persistence, undo and collaboration treat it like any anchored arrow.
//
// Anchors. Each end is either
//   - AUTO: the exact item centre (fx = fy = 0.5). A link never really ends at an item's centre, so
//     the centre is free to mean "pick the best side of this item, again every time it moves". It
//     stays inside the 0..1 range the collaboration document validates;
//   - FIXED: any other fraction. A side midpoint pins the end to that side; an older link or an
//     arrow drawn by hand keeps its exact point, and leaves along the side it sits closest to.
// An end may also sit on ANOTHER LINK (a junction: fork or merge); junction.ts encodes it and
// resolve.ts places it.
//
// Everything below works in WORLD units unless a name says "px" (screen pixels).

import type { ArrowHead, DashStyle, DrawShape, RouteStyle, ShapeAnchor } from "../referenceShared";
import { fromItemSpace, type AnchorBox } from "../boardArrange";
import { itemEdges, pruneLinks } from "./junction";

export type Side = "top" | "right" | "bottom" | "left";
export const SIDES: readonly Side[] = ["top", "right", "bottom", "left"];

export type LinkBox = AnchorBox & { id: string };
export interface Pt { x: number; y: number }
export interface Dir { dx: number; dy: number }
// A resolved end: where the path starts and the outward direction it leaves along.
export interface LinkEnd extends Pt, Dir { side: Side | null }

// ---------------------------------------------------------------------------------------------
// Style vocabulary
// ---------------------------------------------------------------------------------------------

// Mid-tone colours (Tailwind 400 shades) that read on the light and on the dark board alike.
export const LINK_COLOR = "#94a3b8";
export const LINK_PALETTE: readonly string[] = [
  LINK_COLOR, "#f87171", "#fb923c", "#facc15", "#4ade80", "#38bdf8", "#a78bfa", "#f472b6",
];

export type WidthLevel = "thin" | "normal" | "bold";
export const WIDTH_LEVELS: readonly WidthLevel[] = ["thin", "normal", "bold"];
// Stroke width per level, in SCREEN pixels at a normal zoom (scaled by `chromePx` when drawn).
export const LINK_WIDTH_PX: Record<WidthLevel, number> = { thin: 1.25, normal: 2, bold: 3.5 };

// A link's `w` is its stroke width in SCREEN pixels, any value in this range (the levels are presets).
export const LINK_WIDTH_MIN = 0.5;
export const LINK_WIDTH_MAX = 12;

export function linkWidthPx(w: number): number {
  if (!(w > 0)) return LINK_WIDTH_PX.normal;
  return Math.min(LINK_WIDTH_MAX, Math.max(LINK_WIDTH_MIN, w));
}

// The preset a width is exactly on, or null for a custom width.
export function widthPreset(w: number): WidthLevel | null {
  return WIDTH_LEVELS.find((l) => Math.abs(LINK_WIDTH_PX[l] - w) < 1e-6) ?? null;
}

// Nearest level of a width (an older link stored as 2.5 / zoom, or a hand-drawn arrow).
export function widthLevel(w: number): WidthLevel {
  if (!(w > 0)) return "normal";
  if (w <= 1.6) return "thin";
  if (w <= 2.75) return "normal";
  return "bold";
}

export type HeadsMode = "none" | "end" | "both";
export const HEADS_MODES: readonly HeadsMode[] = ["none", "end", "both"];

export function headsOf(s: DrawShape): HeadsMode {
  const h1: ArrowHead = s.h1 ?? "none";
  const h2: ArrowHead = s.h2 ?? (s.t === "arrow" ? "arrow" : "none");
  if (h1 !== "none" && h2 !== "none") return "both";
  return h2 !== "none" ? "end" : h1 !== "none" ? "end" : "none";
}

export function headsPatch(mode: HeadsMode): Pick<DrawShape, "h1" | "h2"> {
  return { h1: mode === "both" ? "arrow" : "none", h2: mode === "none" ? "none" : "arrow" };
}

export const LINK_ROUTES: readonly RouteStyle[] = ["curved", "straight", "elbow"];
export function linkRoute(s: DrawShape): RouteStyle {
  return s.route ?? "curved";
}

export function linkDashed(s: DrawShape): boolean {
  return !!s.dash && s.dash !== "solid";
}

export function dashPatch(dashed: boolean): { dash: DashStyle } {
  return { dash: dashed ? "dashed" : "solid" };
}

// ---------------------------------------------------------------------------------------------
// Identity helpers
// ---------------------------------------------------------------------------------------------

export function isLink(s: DrawShape): boolean {
  return (s.t === "arrow" || s.t === "line") && !!s.a1 && !!s.a2;
}

// Both ends are items of the level on screen. A link into a folded folder (its items are parked in
// the stash) or towards a deleted item is not drawn.
export function linkOnLevel(s: DrawShape, ids: ReadonlySet<string>): boolean {
  return isLink(s) && ids.has(s.a1!.id) && ids.has(s.a2!.id);
}

export function isOrphanLink(s: DrawShape, ids: ReadonlySet<string>): boolean {
  return isLink(s) && !linkOnLevel(s, ids);
}

// Links whose flow starts or ends at an item (a branch counts for the source item of the link it
// forks from and the target item of the link it merges into), and the items they reach.
export function connectedIds(shapes: readonly DrawShape[], itemId: string): { shapeIds: Set<string>; itemIds: Set<string> } {
  const shapeIds = new Set<string>();
  const itemIds = new Set<string>();
  for (const e of itemEdges(shapes)) {
    if (e.from !== itemId && e.to !== itemId) continue;
    shapeIds.add(e.link.id);
    itemIds.add(e.from === itemId ? e.to : e.from);
  }
  return { shapeIds, itemIds };
}

// Drops the links anchored to removed items and repairs their branches (see junction.ts).
export { pruneLinks };

const sameAnchor = (x: ShapeAnchor, y: ShapeAnchor) =>
  x.id === y.id && Math.abs(x.fx - y.fx) < 1e-6 && Math.abs(x.fy - y.fy) < 1e-6;

// Same link already drawn between the same anchors, in the same direction.
export function hasLink(shapes: readonly DrawShape[], a: ShapeAnchor, b: ShapeAnchor): boolean {
  return shapes.some((s) => isLink(s) && sameAnchor(s.a1!, a) && sameAnchor(s.a2!, b));
}

// Swaps the direction of a link: ends, anchors and arrowheads.
export function reverseShape(s: DrawShape): DrawShape {
  const [x0, y0, x1, y1] = s.p;
  return {
    ...s,
    p: [x1, y1, x0, y0],
    a1: s.a2,
    a2: s.a1,
    h1: s.h2 ?? (s.t === "arrow" ? "arrow" : "none"),
    h2: s.h1 ?? "none",
  };
}

// Every synced field that styles a link (its label text and anchors excluded).
export type LinkStyle = Partial<Pick<DrawShape, "c" | "w" | "route" | "h1" | "h2" | "dash" | "op" | "fill">>;

export function styleOf(s: DrawShape): LinkStyle {
  return { c: s.c, w: s.w, route: s.route, h1: s.h1, h2: s.h2, dash: s.dash, op: s.op, fill: s.fill };
}

// A new link: curved, arrow at the end, normal width, default colour, unless `style` says otherwise.
export function makeLink(id: string, a1: ShapeAnchor, a2: ShapeAnchor, p: [number, number, number, number], style: LinkStyle = {}): DrawShape {
  const base: DrawShape = { id, t: "arrow", c: LINK_COLOR, w: LINK_WIDTH_PX.normal, p: [...p], route: "curved", h2: "arrow", a1, a2 };
  const out: DrawShape = { ...base };
  for (const [key, value] of Object.entries(style)) {
    if (value !== undefined) (out as unknown as Record<string, unknown>)[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Anchors and sides
// ---------------------------------------------------------------------------------------------

export const AUTO_FRACTION = 0.5;

export function autoAnchor(id: string): ShapeAnchor {
  return { id, fx: AUTO_FRACTION, fy: AUTO_FRACTION };
}

export function isAutoAnchor(a: ShapeAnchor): boolean {
  return a.fx === AUTO_FRACTION && a.fy === AUTO_FRACTION;
}

const BASE: Record<Side, { fx: number; fy: number; dx: number; dy: number }> = {
  top: { fx: 0.5, fy: 0, dx: 0, dy: -1 },
  right: { fx: 1, fy: 0.5, dx: 1, dy: 0 },
  bottom: { fx: 0.5, fy: 1, dx: 0, dy: 1 },
  left: { fx: 0, fy: 0.5, dx: -1, dy: 0 },
};

// Anchor pinned to the middle of a PHYSICAL side (a flipped item stores the mirrored fraction).
export function sideAnchor(it: LinkBox, side: Side): ShapeAnchor {
  const b = BASE[side];
  return { id: it.id, fx: it.flipH ? 1 - b.fx : b.fx, fy: it.flipV ? 1 - b.fy : b.fy };
}

// Physical side a FIXED anchor leaves from: the side its (unflipped) fraction sits closest to.
export function anchorSide(it: LinkBox, a: ShapeAnchor): Side {
  const ux = (it.flipH ? 1 - a.fx : a.fx) - 0.5;
  const uy = (it.flipV ? 1 - a.fy : a.fy) - 0.5;
  // Compare in item proportions: 0.5 on either axis is an edge, whatever the aspect ratio.
  if (Math.abs(ux) >= Math.abs(uy)) return ux >= 0 ? "right" : "left";
  return uy >= 0 ? "bottom" : "top";
}

export function sidePoint(it: LinkBox, side: Side): Pt {
  const a = sideAnchor(it, side);
  return fromItemSpace(it, a.fx, a.fy);
}

export function sideDirection(it: AnchorBox, side: Side): Dir {
  const b = BASE[side];
  const t = ((it.rotation || 0) * Math.PI) / 180;
  return { dx: b.dx * Math.cos(t) - b.dy * Math.sin(t), dy: b.dx * Math.sin(t) + b.dy * Math.cos(t) };
}

export function centerOf(it: AnchorBox): Pt {
  return { x: it.x + it.w / 2, y: it.y + it.h / 2 };
}

// Item-local, unflipped coordinates of a world point, as fractions of the half sizes: the box spans
// -1..1 on both axes whatever its aspect ratio and rotation.
function localUnit(it: AnchorBox, p: Pt): { u: number; v: number } {
  const c = centerOf(it);
  const t = ((it.rotation || 0) * Math.PI) / 180;
  const dx = p.x - c.x, dy = p.y - c.y;
  const lx = dx * Math.cos(t) + dy * Math.sin(t);
  const ly = -dx * Math.sin(t) + dy * Math.cos(t);
  return { u: it.w ? lx / (it.w / 2) : 0, v: it.h ? ly / (it.h / 2) : 0 };
}

// AUTO side choice: the side facing a target point. Splitting the plane along the box diagonals
// (not by raw dx/dy) is what makes a wide card link from its long side when the target is above it.
export function sideToward(it: AnchorBox, target: Pt): Side {
  const { u, v } = localUnit(it, target);
  if (Math.abs(u) >= Math.abs(v)) return u >= 0 ? "right" : "left";
  return v >= 0 ? "bottom" : "top";
}

// Side whose midpoint is the closest to a world point (snapping while dragging over a target).
export function nearestSide(it: LinkBox, from: Pt): Side {
  let best: Side = "top";
  let bestD = Infinity;
  for (const side of SIDES) {
    const p = sidePoint(it, side);
    const d = (p.x - from.x) ** 2 + (p.y - from.y) ** 2;
    if (d < bestD) { bestD = d; best = side; }
  }
  return best;
}

// Distance from a world point to the outline of an item (0 on the edge, negative inside).
export function edgeDistance(it: AnchorBox, p: Pt): number {
  const c = centerOf(it);
  const t = ((it.rotation || 0) * Math.PI) / 180;
  const dx = p.x - c.x, dy = p.y - c.y;
  const lx = Math.abs(dx * Math.cos(t) + dy * Math.sin(t)) - it.w / 2;
  const ly = Math.abs(-dx * Math.sin(t) + dy * Math.cos(t)) - it.h / 2;
  if (lx <= 0 && ly <= 0) return Math.max(lx, ly);
  return Math.hypot(Math.max(lx, 0), Math.max(ly, 0));
}

function endOnSide(it: LinkBox, side: Side): LinkEnd {
  const p = sidePoint(it, side);
  const d = sideDirection(it, side);
  return { x: p.x, y: p.y, dx: d.dx, dy: d.dy, side };
}

export function fixedEnd(it: LinkBox, a: ShapeAnchor): LinkEnd {
  const p = fromItemSpace(it, a.fx, a.fy);
  const side = anchorSide(it, a);
  const d = sideDirection(it, side);
  return { x: p.x, y: p.y, dx: d.dx, dy: d.dy, side };
}

// One end of a link. `toward` = what an AUTO end should face.
export function resolveEnd(it: LinkBox, a: ShapeAnchor, toward: Pt): LinkEnd {
  return isAutoAnchor(a) ? endOnSide(it, sideToward(it, toward)) : fixedEnd(it, a);
}

// ---------------------------------------------------------------------------------------------
// Pair side choice
// ---------------------------------------------------------------------------------------------

// Axis-aligned rectangle (world units).
export interface Rect { x0: number; y0: number; x1: number; y1: number }

const isRotated = (it: AnchorBox) => (it.rotation || 0) % 360 !== 0;

// Bounds of an item, or null when it is rotated (its outline is no rectangle on the axes).
export function boxRect(it: AnchorBox): Rect | null {
  return isRotated(it) ? null : { x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + it.h };
}

// True when the segment a-b runs through the INSIDE of the rectangle (touching its outline, or
// starting on it and leaving, is not a hit).
export function segmentHitsRect(a: Pt, b: Pt, r: Rect, eps = 0.5): boolean {
  const x0 = r.x0 + eps, y0 = r.y0 + eps, x1 = r.x1 - eps, y1 = r.y1 - eps;
  if (x1 <= x0 || y1 <= y0) return false;
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  if (!clip(-dx, a.x - x0) || !clip(dx, x1 - a.x) || !clip(-dy, a.y - y0) || !clip(dy, y1 - a.y)) return false;
  return t1 > t0 + 1e-9;
}

// What one end of a link is, for the side choice: an item whose side is picked (`fixed` null), an
// item pinned at a point (`fixed` set) or a bare point (`box` null).
export interface SideTarget { box: LinkBox | null; fixed: LinkEnd | null }

// Cost of a side pair when the boxes overlap: its length, plus a heavy price for an end that points
// away from the other one and for a straight run through either box.
const SIDE_PENALTY = 1e5;
function pairCost(e0: LinkEnd, e1: LinkEnd, r0: Rect | null, r1: Rect | null): number {
  const vx = e1.x - e0.x, vy = e1.y - e0.y;
  let c = Math.hypot(vx, vy);
  if ((e0.dx || e0.dy) && vx * e0.dx + vy * e0.dy < -1e-6) c += SIDE_PENALTY;
  if ((e1.dx || e1.dy) && -vx * e1.dx - vy * e1.dy < -1e-6) c += SIDE_PENALTY;
  if (r0 && segmentHitsRect(e0, e1, r0)) c += SIDE_PENALTY;
  if (r1 && segmentHitsRect(e0, e1, r1)) c += SIDE_PENALTY;
  return c;
}

// Sides of the AUTO ends of a link, picked as a PAIR. The boxes (a pinned end counts as a point)
// are separated more along one axis than the other: the facing sides of that axis. Boxes that
// overlap on both axes: the cheapest of the side pairs (shortest, pointing at each other, not
// running through a box). A rotated item keeps the old rule: each end faces the other centre.
// Returns null for an end that is not auto.
export function pairSides(t0: SideTarget, t1: SideTarget): [Side | null, Side | null] {
  const auto0 = !t0.fixed && !!t0.box, auto1 = !t1.fixed && !!t1.box;
  if (!auto0 && !auto1) return [null, null];
  const ref = (t: SideTarget): Pt => t.fixed ?? centerOf(t.box!);
  if ((t0.box && isRotated(t0.box)) || (t1.box && isRotated(t1.box))) {
    return [auto0 ? sideToward(t0.box!, ref(t1)) : null, auto1 ? sideToward(t1.box!, ref(t0)) : null];
  }
  const rectOf = (t: SideTarget): Rect => (t.fixed ? { x0: t.fixed.x, y0: t.fixed.y, x1: t.fixed.x, y1: t.fixed.y } : boxRect(t.box!)!);
  const r0 = rectOf(t0), r1 = rectOf(t1);
  const gx = Math.max(r1.x0 - r0.x1, r0.x0 - r1.x1);
  const gy = Math.max(r1.y0 - r0.y1, r0.y0 - r1.y1);
  if (gx > 0 && gx >= gy) {
    const right = r1.x0 >= r0.x1;
    return [auto0 ? (right ? "right" : "left") : null, auto1 ? (right ? "left" : "right") : null];
  }
  if (gy > 0) {
    const below = r1.y0 >= r0.y1;
    return [auto0 ? (below ? "bottom" : "top") : null, auto1 ? (below ? "top" : "bottom") : null];
  }
  const options = (t: SideTarget, auto: boolean): LinkEnd[] => (auto ? SIDES.map((s) => endOnSide(t.box!, s)) : [t.fixed!]);
  const o0 = options(t0, auto0), o1 = options(t1, auto1);
  const b0 = t0.box ? boxRect(t0.box) : null, b1 = t1.box ? boxRect(t1.box) : null;
  let best: [LinkEnd, LinkEnd] = [o0[0], o1[0]];
  let bestCost = Infinity;
  for (const e0 of o0) {
    for (const e1 of o1) {
      const c = pairCost(e0, e1, b0, b1);
      if (c < bestCost) { bestCost = c; best = [e0, e1]; }
    }
  }
  return [auto0 ? best[0].side : null, auto1 ? best[1].side : null];
}

// ---------------------------------------------------------------------------------------------
// Ports and floating ends
// ---------------------------------------------------------------------------------------------

// Several auto ends on one side of an item are spread along it, this far apart (screen px), within
// the middle PORT_SPAN of the side.
export const PORT_SPACING_PX = 14;
export const PORT_SPAN = 0.7;

// Offset (world units, along the side tangent) of slot `i` of `n` ends sharing a side.
export function portOffset(i: number, n: number, sideLen: number, k: number): number {
  if (n < 2) return 0;
  const step = Math.min(PORT_SPACING_PX * k, (sideLen * PORT_SPAN) / (n - 1));
  return (i - (n - 1) / 2) * step;
}

// Tangent of a side: perpendicular to its outward direction. The ends of a side are ordered along it.
export const sideTangent = (e: Dir): Dir => ({ dx: -e.dy, dy: e.dx });

export function shiftAlongSide(e: LinkEnd, off: number): LinkEnd {
  return off ? { ...e, x: e.x - e.dy * off, y: e.y + e.dx * off } : e;
}

// Length of a physical side of an item.
export const sideLength = (it: AnchorBox, side: Side): number => (side === "top" || side === "bottom" ? it.w : it.h);

// "Floating" end: where the line from the item centre towards a point crosses its outline. Null
// when the point is inside the item.
export function floatingEnd(it: LinkBox, toward: Pt): LinkEnd | null {
  const { u, v } = localUnit(it, toward);
  const m = Math.max(Math.abs(u), Math.abs(v));
  if (!(m > 1)) return null;
  const c = centerOf(it);
  const side = sideToward(it, toward);
  const d = sideDirection(it, side);
  return { x: c.x + (toward.x - c.x) / m, y: c.y + (toward.y - c.y) / m, dx: d.dx, dy: d.dy, side };
}

export interface EndsOpts {
  route?: RouteStyle;   // a straight link floats its auto ends onto the centre-to-centre line
  off0?: number;        // port offsets (world units) of the auto ends, see `portOffset`
  off1?: number;
}

// Both ends of a link between two items-or-points. A bare point (`box` null) gives null: the caller
// places it. Pinned ends keep their point; auto ends take the pair's sides.
export function placeItemEnds(t0: SideTarget, t1: SideTarget, opts: EndsOpts = {}): [LinkEnd | null, LinkEnd | null] {
  const sides = pairSides(t0, t1);
  const one = (t: SideTarget, other: SideTarget, side: Side | null, off: number): LinkEnd | null => {
    if (!t.box) return null;
    if (t.fixed) return t.fixed;
    if (opts.route === "straight") {
      const f = floatingEnd(t.box, other.fixed ?? centerOf(other.box!));
      if (f) return f;
    }
    return shiftAlongSide(endOnSide(t.box, side!), off);
  };
  return [one(t0, t1, sides[0], opts.off0 ?? 0), one(t1, t0, sides[1], opts.off1 ?? 0)];
}

// Both ends of a link. The auto ends are picked as a pair (`pairSides`); a pinned end keeps its point.
export function resolveEnds(b1: LinkBox, a1: ShapeAnchor, b2: LinkBox, a2: ShapeAnchor, opts: EndsOpts = {}): [LinkEnd, LinkEnd] {
  const t0: SideTarget = { box: b1, fixed: isAutoAnchor(a1) ? null : fixedEnd(b1, a1) };
  const t1: SideTarget = { box: b2, fixed: isAutoAnchor(a2) ? null : fixedEnd(b2, a2) };
  const [e0, e1] = placeItemEnds(t0, t1, opts);
  return [e0!, e1!];
}

// End sitting on a free point (preview of a link dragged over empty space): it arrives facing the
// other end along the dominant axis.
export function freeEnd(p: Pt, from: Pt): LinkEnd {
  const dx = p.x - from.x, dy = p.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return { x: p.x, y: p.y, dx: dx >= 0 ? -1 : 1, dy: 0, side: null };
  return { x: p.x, y: p.y, dx: 0, dy: dy >= 0 ? -1 : 1, side: null };
}

// ---------------------------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------------------------

export interface LinkPath {
  d: string;
  pts: number[];        // polyline following the path (hit-testing, bounds, midpoint)
  mid: Pt;              // arc-length midpoint: where the label sits
  startAng: number;     // direction TOWARD the start point (orients a head at the start)
  endAng: number;       // direction TOWARD the end point
  bbox: [number, number, number, number];
}

export interface RouteOpts {
  trim0?: number;       // pull the drawn path back from the start (room for a head)
  trim1?: number;
  radius?: number;      // elbow corner radius
  avoid?: readonly (Rect | null)[];   // boxes of the two items an elbow must not run through
}

const CURVE_SAMPLES = 24;
const ELBOW_STUB = 28;
const ELBOW_RADIUS = 14;

function bboxOf(pts: number[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    if (pts[i] < x0) x0 = pts[i];
    if (pts[i] > x1) x1 = pts[i];
    if (pts[i + 1] < y0) y0 = pts[i + 1];
    if (pts[i + 1] > y1) y1 = pts[i + 1];
  }
  return [x0, y0, x1, y1];
}

// Point at half the length of a polyline.
export function polylineMid(pts: number[]): Pt {
  const n = pts.length / 2;
  if (n < 2) return { x: pts[0] ?? 0, y: pts[1] ?? 0 };
  let total = 0;
  for (let i = 1; i < n; i++) total += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
  let half = total / 2;
  for (let i = 1; i < n; i++) {
    const ax = pts[i * 2 - 2], ay = pts[i * 2 - 1], bx = pts[i * 2], by = pts[i * 2 + 1];
    const seg = Math.hypot(bx - ax, by - ay);
    if (seg >= half && seg > 0) {
      const t = half / seg;
      return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t };
    }
    half -= seg;
  }
  return { x: pts[pts.length - 2], y: pts[pts.length - 1] };
}

export type Cubic = [number, number, number, number, number, number, number, number];

// Control length of one end of a curve: how far it runs along its outward direction `d` before
// turning towards `q`. Short and calm when `q` is ahead (it never overshoots the other end, so close
// facing items give a gentle S); longer when `q` is behind, so the wire swings out around its own box
// instead of folding back through it.
function reach(p: Pt, d: Dir, q: Pt): number {
  const vx = q.x - p.x, vy = q.y - p.y;
  const along = vx * d.dx + vy * d.dy;
  const lateral = Math.abs(-vx * d.dy + vy * d.dx);
  const k = along >= 0 ? along * 0.5 + lateral * 0.2 : 40 - along * 0.5 + lateral * 0.5;
  return Math.min(400, Math.max(10, k));
}

// Smooth S curve leaving P0 along d0 and arriving at P1 against d1 (d1 = outward direction at P1).
export function cubicBetween(p0: Pt, d0: Dir, p1: Pt, d1: Dir): Cubic {
  const k0 = reach(p0, d0, p1), k1 = reach(p1, d1, p0);
  return [p0.x, p0.y, p0.x + d0.dx * k0, p0.y + d0.dy * k0, p1.x + d1.dx * k1, p1.y + d1.dy * k1, p1.x, p1.y];
}

function cubicAt(c: Cubic, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, cc = 3 * u * t * t, d = t * t * t;
  return { x: a * c[0] + b * c[2] + cc * c[4] + d * c[6], y: a * c[1] + b * c[3] + cc * c[5] + d * c[7] };
}

// Removes repeated points and middle points of straight runs (including a run that doubles back).
function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) continue;
    out.push(p);
    while (out.length >= 3) {
      const a = out[out.length - 3], b = out[out.length - 2], c = out[out.length - 1];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (Math.abs(cross) > 1e-6) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

const snapDir = (e: LinkEnd): Dir => (Math.abs(e.dx) >= Math.abs(e.dy) ? { dx: Math.sign(e.dx) || 1, dy: 0 } : { dx: 0, dy: Math.sign(e.dy) || 1 });

// Orthogonal corner points between two ends: out along each side normal, then across.
function basicElbow(e0: LinkEnd, e1: LinkEnd, stub: number): Pt[] {
  const h0 = Math.abs(e0.dx) >= Math.abs(e0.dy);
  const h1 = Math.abs(e1.dx) >= Math.abs(e1.dy);
  // Snap the directions to the axes (a rotated item still routes orthogonally).
  const d0 = snapDir(e0), d1 = snapDir(e1);
  const facing = h0 && h1
    ? d0.dx !== d1.dx && (e1.x - e0.x) * d0.dx > 0
    : !h0 && !h1
      ? d0.dy !== d1.dy && (e1.y - e0.y) * d0.dy > 0
      : false;
  const s0 = facing ? { x: e0.x, y: e0.y } : { x: e0.x + d0.dx * stub, y: e0.y + d0.dy * stub };
  const s1 = facing ? { x: e1.x, y: e1.y } : { x: e1.x + d1.dx * stub, y: e1.y + d1.dy * stub };
  const pts: Pt[] = [{ x: e0.x, y: e0.y }, s0];
  if (h0 && h1) {
    const mx = (s0.x + s1.x) / 2;
    pts.push({ x: mx, y: s0.y }, { x: mx, y: s1.y });
  } else if (!h0 && !h1) {
    const my = (s0.y + s1.y) / 2;
    pts.push({ x: s0.x, y: my }, { x: s1.x, y: my });
  } else if (h0) {
    pts.push({ x: s1.x, y: s0.y });
  } else {
    pts.push({ x: s0.x, y: s1.y });
  }
  pts.push(s1, { x: e1.x, y: e1.y });
  return simplify(pts);
}

function runsThrough(pts: readonly Pt[], rects: readonly Rect[]): boolean {
  for (let i = 1; i < pts.length; i++) {
    for (const r of rects) if (segmentHitsRect(pts[i - 1], pts[i], r)) return true;
  }
  return false;
}

// Orthogonal route that leaves both boxes by their stubs and goes around them: the cheapest of a few
// candidate shapes (one corner, or a channel between the stubs, beside or around both boxes) that
// leaves each end outward and crosses neither box. Null when none does.
function aroundElbow(e0: LinkEnd, e1: LinkEnd, stub: number, rects: readonly Rect[]): Pt[] | null {
  const d0 = snapDir(e0), d1 = snapDir(e1);
  const s0 = { x: e0.x + d0.dx * stub, y: e0.y + d0.dy * stub };
  const s1 = { x: e1.x + d1.dx * stub, y: e1.y + d1.dy * stub };
  const lo = (f: (r: Rect) => number, a: number, b: number) => Math.min(a, b, ...rects.map(f));
  const hi = (f: (r: Rect) => number, a: number, b: number) => Math.max(a, b, ...rects.map(f));
  const xs = [(s0.x + s1.x) / 2, lo((r) => r.x0, s0.x, s1.x) - stub, hi((r) => r.x1, s0.x, s1.x) + stub];
  const ys = [(s0.y + s1.y) / 2, lo((r) => r.y0, s0.y, s1.y) - stub, hi((r) => r.y1, s0.y, s1.y) + stub];
  const inners: Pt[][] = [[], [{ x: s1.x, y: s0.y }], [{ x: s0.x, y: s1.y }]];
  for (const x of xs) inners.push([{ x, y: s0.y }, { x, y: s1.y }]);
  for (const y of ys) inners.push([{ x: s0.x, y }, { x: s1.x, y }]);
  let best: Pt[] | null = null;
  let bestCost = Infinity;
  for (const inner of inners) {
    const pts = simplify([{ x: e0.x, y: e0.y }, s0, ...inner, s1, { x: e1.x, y: e1.y }]);
    const n = pts.length;
    if (n < 2) continue;
    // Each end must leave outward, and no run may cross a box.
    if ((pts[1].x - pts[0].x) * d0.dx + (pts[1].y - pts[0].y) * d0.dy <= 0) continue;
    if ((pts[n - 2].x - pts[n - 1].x) * d1.dx + (pts[n - 2].y - pts[n - 1].y) * d1.dy <= 0) continue;
    if (runsThrough(pts, rects)) continue;
    let cost = (n - 2) * stub * 0.75;
    for (let i = 1; i < n; i++) cost += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (cost < bestCost) { bestCost = cost; best = pts; }
  }
  return best;
}

// Orthogonal corner points between two ends: out along each side normal, then across. `avoid` =
// the boxes of the two items: when the plain route would cut through one, the route goes around.
export function elbowPoints(e0: LinkEnd, e1: LinkEnd, stub = ELBOW_STUB, avoid?: readonly (Rect | null)[]): Pt[] {
  const basic = basicElbow(e0, e1, stub);
  const rects = (avoid ?? []).filter((r): r is Rect => !!r);
  if (!rects.length || !runsThrough(basic, rects)) return basic;
  return aroundElbow(e0, e1, stub, rects) ?? basic;
}

function roundedPolyline(pts: Pt[], radius: number): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    if (r < 0.5) { d += ` L ${b.x} ${b.y}`; continue; }
    const p1 = { x: b.x + ((a.x - b.x) / l1) * r, y: b.y + ((a.y - b.y) / l1) * r };
    const p2 = { x: b.x + ((c.x - b.x) / l2) * r, y: b.y + ((c.y - b.y) / l2) * r };
    d += ` L ${p1.x} ${p1.y} Q ${b.x} ${b.y} ${p2.x} ${p2.y}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

const flat = (pts: Pt[]) => pts.flatMap((p) => [p.x, p.y]);
const pullBack = (e: LinkEnd, by: number): LinkEnd => (by > 0 ? { ...e, x: e.x + e.dx * by, y: e.y + e.dy * by } : e);

// Path of a link between two resolved ends. The polyline, midpoint and angles always describe the
// full path (tip to tip); only the drawn `d` is shortened by the trims.
export function routePath(route: RouteStyle, e0: LinkEnd, e1: LinkEnd, opts: RouteOpts = {}): LinkPath {
  const trim0 = opts.trim0 ?? 0, trim1 = opts.trim1 ?? 0;
  if (route === "straight") {
    const len = Math.hypot(e1.x - e0.x, e1.y - e0.y) || 1;
    const ux = (e1.x - e0.x) / len, uy = (e1.y - e0.y) / len;
    const t0 = Math.min(trim0, len / 3), t1 = Math.min(trim1, len / 3);
    const pts = [e0.x, e0.y, e1.x, e1.y];
    return {
      d: `M ${e0.x + ux * t0} ${e0.y + uy * t0} L ${e1.x - ux * t1} ${e1.y - uy * t1}`,
      pts,
      mid: { x: (e0.x + e1.x) / 2, y: (e0.y + e1.y) / 2 },
      endAng: Math.atan2(uy, ux),
      startAng: Math.atan2(-uy, -ux),
      bbox: bboxOf(pts),
    };
  }
  if (route === "elbow") {
    const corners = elbowPoints(e0, e1, ELBOW_STUB, opts.avoid);
    const pts = flat(corners);
    const drawn = corners.map((p) => ({ ...p }));
    const n = drawn.length;
    const shorten = (i: number, j: number, by: number) => {
      const a = drawn[i], b = drawn[j];
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      if (!l || by <= 0) return;
      const k = Math.min(by, l / 2) / l;
      a.x += (b.x - a.x) * k;
      a.y += (b.y - a.y) * k;
    };
    shorten(0, 1, trim0);
    shorten(n - 1, n - 2, trim1);
    const a = corners[n - 2], b = corners[n - 1], c = corners[0], d = corners[1];
    return {
      d: roundedPolyline(drawn, opts.radius ?? ELBOW_RADIUS),
      pts,
      mid: polylineMid(pts),
      endAng: Math.atan2(b.y - a.y, b.x - a.x),
      startAng: Math.atan2(c.y - d.y, c.x - d.x),
      bbox: bboxOf(pts),
    };
  }
  // curved
  const full = cubicBetween(e0, e0, e1, e1);
  const pts: number[] = [];
  for (let i = 0; i <= CURVE_SAMPLES; i++) {
    const p = cubicAt(full, i / CURVE_SAMPLES);
    pts.push(p.x, p.y);
  }
  const s = pullBack(e0, trim0), t = pullBack(e1, trim1);
  const c = trim0 || trim1 ? cubicBetween(s, e0, t, e1) : full;
  return {
    d: `M ${c[0]} ${c[1]} C ${c[2]} ${c[3]} ${c[4]} ${c[5]} ${c[6]} ${c[7]}`,
    pts,
    mid: polylineMid(pts),
    endAng: Math.atan2(full[7] - full[5], full[6] - full[4]),
    startAng: Math.atan2(full[1] - full[3], full[0] - full[2]),
    bbox: bboxOf(pts),
  };
}

// ---------------------------------------------------------------------------------------------
// Heads, hit-testing
// ---------------------------------------------------------------------------------------------

// Filled arrowhead with its tip on (tx, ty), pointing along `ang`. `size` = length of the head.
export function headPath(tx: number, ty: number, ang: number, size: number): string {
  const back = ang + Math.PI;
  const spread = 0.48;
  const bx = tx + Math.cos(back) * size, by = ty + Math.sin(back) * size;
  const lx = bx + Math.cos(ang + Math.PI / 2) * size * spread, ly = by + Math.sin(ang + Math.PI / 2) * size * spread;
  const rx = bx - Math.cos(ang + Math.PI / 2) * size * spread, ry = by - Math.sin(ang + Math.PI / 2) * size * spread;
  // Slightly concave back: reads as an arrow, not a triangle.
  const nx = tx + Math.cos(back) * size * 0.72, ny = ty + Math.sin(back) * size * 0.72;
  return `M ${tx} ${ty} L ${lx} ${ly} L ${nx} ${ny} L ${rx} ${ry} Z`;
}

// Head length for a stroke width (both in world units).
export function headSize(strokeW: number, k: number): number {
  return Math.max(strokeW * 3.6, 8 * k);
}

function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function distToPath(path: Pick<LinkPath, "pts">, x: number, y: number): number {
  const p = path.pts;
  let best = Infinity;
  for (let i = 0; i + 3 < p.length; i += 2) best = Math.min(best, distToSeg(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]));
  return best;
}

export function hitLink(path: Pick<LinkPath, "pts" | "bbox">, x: number, y: number, tol: number): boolean {
  const [a, b, c, d] = path.bbox;
  if (x < a - tol || x > c + tol || y < b - tol || y > d + tol) return false;
  return distToPath(path, x, y) <= tol;
}

// ---------------------------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------------------------

export const LABEL_FONT_PX = 12;
export const LABEL_LINE_PX = 16;
export const LABEL_SIZES = { S: 10, M: 12, L: 15 } as const;
export const LABEL_SIZE_MIN = 8;
export const LABEL_SIZE_MAX = 32;
export const LABEL_PAD_X = 8;
export const LABEL_PAD_Y = 3;
export const LABEL_MAX_PX = 200;
export const LABEL_MAX_LINES = 2;
export const LABEL_MAX_CHARS = 200;

export interface LabelLayout { lines: string[]; w: number; h: number; lineH: number }

// Line height of a label font size: 16px at the default 12px.
export function labelLineHeight(fontPx: number): number {
  return Math.round((fontPx * LABEL_LINE_PX) / LABEL_FONT_PX);
}

// Widest pill for a font size: a larger font gets a proportionally wider pill.
export function labelMaxWidth(fontPx: number): number {
  return Math.round(LABEL_MAX_PX * Math.max(1, fontPx / LABEL_FONT_PX));
}

// Wraps a label into at most two lines of `maxW` screen pixels, the last one ending with an ellipsis
// when the text does not fit. `measure` returns the width of a string at the label font. The pill
// renders these exact lines, so the gap cut in the path matches what is on screen.
export function labelLayout(text: string, measure: (s: string) => number, maxW = LABEL_MAX_PX, fontPx = LABEL_FONT_PX): LabelLayout {
  const inner = maxW - LABEL_PAD_X * 2;
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (let w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (measure(next) <= inner) { cur = next; continue; }
    if (cur) { lines.push(cur); cur = ""; }
    // A single word wider than the pill is cut where it stops fitting.
    while (measure(w) > inner && w.length > 1) {
      let n = w.length - 1;
      while (n > 1 && measure(w.slice(0, n)) > inner) n--;
      lines.push(w.slice(0, n));
      w = w.slice(n);
    }
    cur = w;
  }
  if (cur) lines.push(cur);
  if (lines.length > LABEL_MAX_LINES) {
    lines.length = LABEL_MAX_LINES;
    let last = lines[LABEL_MAX_LINES - 1];
    while (last.length > 1 && measure(`${last}…`) > inner) last = last.slice(0, -1);
    lines[LABEL_MAX_LINES - 1] = `${last.trimEnd()}…`;
  }
  const w = Math.min(maxW, Math.ceil(Math.max(0, ...lines.map(measure))) + LABEL_PAD_X * 2);
  const lineH = labelLineHeight(fontPx);
  const h = Math.max(1, lines.length) * lineH + LABEL_PAD_Y * 2;
  return { lines, w, h, lineH };
}

// Label style, stored in the link's `fill` (a free text field the collaboration document already
// carries for every shape, unused by links otherwise) so it syncs without a new document field:
//   nbl1|<pill background>|<text colour>|<size px>|<b><i>|<font family>
// Empty parts are the defaults. The whole string stays within the document's 128-character limit:
// the font family, last, is the part cut when it would not fit.
export interface LabelStyle {
  bg?: string;
  color?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  font?: string;
}

const LABEL_STYLE_TAG = "nbl1";
const LABEL_STYLE_MAX = 128;
const cleanPart = (v: string | undefined) => (v ?? "").replace(/\|/g, "").trim();

export function parseLabelStyle(fill: string | undefined): LabelStyle {
  if (!fill?.startsWith(`${LABEL_STYLE_TAG}|`)) return {};
  const [, bg = "", color = "", size = "", flags = "", ...font] = fill.split("|");
  const n = Number(size);
  const out: LabelStyle = {};
  if (bg) out.bg = bg;
  if (color) out.color = color;
  if (size && n > 0) out.size = Math.min(LABEL_SIZE_MAX, Math.max(LABEL_SIZE_MIN, n));
  if (flags.includes("b")) out.bold = true;
  if (flags.includes("i")) out.italic = true;
  if (font.join("|")) out.font = font.join("|");
  return out;
}

// The `fill` value of a label style; undefined when every part is the default.
export function formatLabelStyle(st: LabelStyle): string | undefined {
  const size = st.size && st.size > 0 ? String(Math.round(Math.min(LABEL_SIZE_MAX, Math.max(LABEL_SIZE_MIN, st.size)) * 10) / 10) : "";
  const flags = `${st.bold ? "b" : ""}${st.italic ? "i" : ""}`;
  const head = [LABEL_STYLE_TAG, cleanPart(st.bg), cleanPart(st.color), size, flags].join("|");
  const font = cleanPart(st.font).slice(0, Math.max(0, LABEL_STYLE_MAX - head.length - 1));
  if (head === `${LABEL_STYLE_TAG}||||` && !font) return undefined;
  return `${head}|${font}`;
}

export function labelFontPx(st: LabelStyle): number {
  return st.size ?? LABEL_FONT_PX;
}

// ---------------------------------------------------------------------------------------------
// Whole link
// ---------------------------------------------------------------------------------------------

export interface LinkGeo {
  shape: DrawShape;
  e0: LinkEnd;
  e1: LinkEnd;
  path: LinkPath;
  head0: string | null;
  head1: string | null;
  strokeW: number;      // world units
  // Parent link of a junction end (the end sits on that link, see junction.ts), else undefined.
  j0?: string;
  j1?: string;
}

// Geometry of a link from its resolved ends. A junction end never carries a head: the wire goes on
// through it.
export function linkGeoFromEnds(s: DrawShape, e0: LinkEnd, e1: LinkEnd, k: number, j0?: string, j1?: string, avoid?: readonly (Rect | null)[]): LinkGeo {
  const strokeW = linkWidthPx(s.w) * k;
  const size = headSize(strokeW, k);
  const mode = headsOf(s);
  const has0 = mode === "both" && !j0, has1 = mode !== "none" && !j1;
  const path = routePath(linkRoute(s), e0, e1, { trim0: has0 ? size * 0.7 : 0, trim1: has1 ? size * 0.7 : 0, avoid });
  return {
    shape: s,
    e0,
    e1,
    path,
    head0: has0 ? headPath(e0.x, e0.y, path.startAng, size) : null,
    head1: has1 ? headPath(e1.x, e1.y, path.endAng, size) : null,
    strokeW,
    j0,
    j1,
  };
}

// Geometry of a link between two items at a given chrome factor (`k` = world units per screen
// pixel of chrome).
export function linkGeo(s: DrawShape, b1: LinkBox, b2: LinkBox, k: number): LinkGeo {
  const [e0, e1] = resolveEnds(b1, s.a1!, b2, s.a2!, { route: linkRoute(s) });
  return linkGeoFromEnds(s, e0, e1, k, undefined, undefined, [boxRect(b1), boxRect(b2)]);
}

// Cache key of a link's geometry: everything `linkGeo` reads.
export function linkKey(s: DrawShape, b1: LinkBox, b2: LinkBox, k: number): string {
  const g = (b: LinkBox) => `${b.x},${b.y},${b.w},${b.h},${b.rotation || 0},${b.flipH ? 1 : 0}${b.flipV ? 1 : 0}`;
  return `${s.a1!.fx},${s.a1!.fy},${s.a2!.fx},${s.a2!.fy}|${s.route ?? ""}|${s.h1 ?? ""}${s.h2 ?? ""}|${s.w}|${k}|${g(b1)}|${g(b2)}`;
}

// World endpoints of a link (what `p` caches), for code outside the links layer.
export function linkEndpoints(s: DrawShape, b1: LinkBox, b2: LinkBox): [number, number, number, number] {
  const [e0, e1] = resolveEnds(b1, s.a1!, b2, s.a2!, { route: linkRoute(s) });
  return [e0.x, e0.y, e1.x, e1.y];
}

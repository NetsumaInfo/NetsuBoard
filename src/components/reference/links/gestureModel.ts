// Pure part of the link gestures (useLinkGesture): what a drag of a link end is, which links it may
// land on, and the shapes it writes when it is released. No store, no DOM.

import type { DrawShape, ShapeAnchor } from "../referenceShared";
import { autoAnchor, hasLink, hitLink, isLink, makeLink, styleOf, type LinkGeo, type LinkStyle, type Side } from "./model";
import { canAttach, junctionAnchor, linkIndex, projectOnPath, type LinkIndex } from "./junction";

// `connect`: a new link from an item. `reattach`: moves end `end` of a link. `fork`: a NEW link
// copying the style of `linkId`, keeping its other end and moving end `end`. `branch`: a NEW link
// leaving `linkId` at `t` along it (a junction), same style as that link.
export type LinkGestureSpec =
  | { kind: "connect"; fromId: string }
  | { kind: "reattach"; linkId: string; end: 1 | 2 }
  | { kind: "fork"; linkId: string; end: 1 | 2 }
  | { kind: "branch"; linkId: string; t: number };

// What a dragged end is over: an item (and the side it snaps to), or a link at `t` along it.
export type LinkTarget =
  | { kind: "item"; id: string; side: Side | null }
  | { kind: "link"; id: string; t: number };

// Pointer this close (screen px) to a link targets it, when no item is under the pointer.
export const LINK_REACH_PX = 12;

// The end that stays put during a gesture, the link it belongs to (route of the preview) and
// whether the moving end is the link's start.
export interface GestureBase {
  fixed: ShapeAnchor;
  link: DrawShape | null;
  movingFirst: boolean;
}

export function gestureBase(spec: LinkGestureSpec, shapes: readonly DrawShape[]): GestureBase | null {
  if (spec.kind === "connect") return { fixed: autoAnchor(spec.fromId), link: null, movingFirst: false };
  const link = shapes.find((s) => s.id === spec.linkId);
  if (!link || !isLink(link)) return null;
  if (spec.kind === "branch") return { fixed: junctionAnchor(link.id, spec.t), link, movingFirst: false };
  return { fixed: spec.end === 1 ? link.a2! : link.a1!, link, movingFirst: spec.end === 1 };
}

// Links a gesture's moving end may attach to: never the dragged link itself, never the link the
// fixed end already sits on, never a descendant of a re-attached link (no cycle), never too deep.
export function linkTargetFilter(spec: LinkGestureSpec, base: GestureBase, links: LinkIndex): (id: string) => boolean {
  const own = spec.kind === "reattach" ? spec.linkId : null;
  return (id) => {
    if (id === base.fixed.id) return false;
    if (spec.kind !== "connect" && id === spec.linkId) return false;
    return canAttach(links, own, id);
  };
}

// Link under a world point (nearest within `tol` world units) and the position along it.
export function findLinkTarget(geos: Iterable<LinkGeo>, x: number, y: number, tol: number, allow: (id: string) => boolean): LinkTarget | null {
  let best: LinkTarget | null = null;
  let bestD = Infinity;
  for (const g of geos) {
    if (!allow(g.shape.id) || !hitLink(g.path, x, y, tol)) continue;
    const p = projectOnPath(g.path.pts, x, y);
    if (p.dist < bestD) { bestD = p.dist; best = { kind: "link", id: g.shape.id, t: p.t }; }
  }
  return best;
}

// Applies a finished gesture onto an anchor (an item end, or a junction on a link). Returns the new
// shapes, or null when there is nothing to do (same thing at both ends, duplicate link, a cycle).
// `style` styles a new `connect` link; a fork or a branch copies the style of its link. `newId`
// names a new link.
export function applyLinkEnd(
  shapes: DrawShape[], spec: LinkGestureSpec, anchor: ShapeAnchor, endpoints: [number, number, number, number],
  style: LinkStyle, newId: () => string,
): DrawShape[] | null {
  const links = linkIndex(shapes);
  const onLink = links.has(anchor.id);
  if (spec.kind === "connect") {
    if (anchor.id === spec.fromId || (onLink && !canAttach(links, null, anchor.id))) return null;
    const from = autoAnchor(spec.fromId);
    if (hasLink(shapes, from, anchor)) return null;
    return [...shapes, makeLink(newId(), from, anchor, endpoints, style)];
  }
  const link = links.get(spec.linkId);
  if (!link) return null;
  if (spec.kind === "branch") {
    if (anchor.id === link.id || (onLink && !canAttach(links, null, anchor.id))) return null;
    return [...shapes, makeLink(newId(), junctionAnchor(link.id, spec.t), anchor, endpoints, styleOf(link))];
  }
  const other = spec.end === 1 ? link.a2! : link.a1!;
  if (other.id === anchor.id) return null;
  if (spec.kind === "reattach") {
    if (onLink && !canAttach(links, link.id, anchor.id)) return null;
    return shapes.map((s) => (s.id === link.id ? { ...s, [spec.end === 1 ? "a1" : "a2"]: anchor } : s));
  }
  if (onLink && !canAttach(links, null, anchor.id)) return null;
  const [a1, a2] = spec.end === 1 ? [anchor, other] : [other, anchor];
  if (hasLink(shapes, a1, a2)) return null;
  return [...shapes, makeLink(newId(), a1, a2, endpoints, styleOf(link))];
}

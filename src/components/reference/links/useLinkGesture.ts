// Dragging a link end: from an item's connect handle or a Ctrl-drag on an item (new link), from an
// end of the selected link or a junction dot (re-attach, or Alt to fork a copy of that link), or from
// the grab dot that follows the pointer along a link / an Alt-drag on a link (branch: a new link
// leaving that link at that point — a junction). The moving end lands on an item, or, away from any
// item, on a link (merge: the end becomes a junction on it; a junction dragged along its own parent
// slides). The preview path is moved imperatively once per frame; React only hears about the hovered
// target when it changes. Release writes ONE history entry; release on empty space offers to create
// an item there (see LinkLayer); Escape cancels.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useBoard } from "../useReferenceBoard";
import { screenToBoard, uid, type BoardItem, type DrawShape, type ShapeAnchor } from "../referenceShared";
import { itemAtPoint } from "../drawAnchor";
import { chromePx } from "../boardChrome";
import {
  SIDES, autoAnchor, edgeDistance, routePath, linkRoute, sideAnchor, sideDirection, sidePoint,
  type LinkGeo, type LinkStyle, type Side,
} from "./model";
import { collapsedHidden, junctionAnchor, linkIndex } from "./junction";
import { endSource, resolveSources, type EndSource } from "./resolve";
import {
  LINK_REACH_PX, applyLinkEnd as applyEnd, findLinkTarget, gestureBase, linkTargetFilter,
  type LinkGestureSpec, type LinkTarget,
} from "./gestureModel";
import { linkDefaults } from "./linkActions";
import { useLinkUi } from "./linkUi";
import { drawShapesOf } from "./useLinkScene";

export type { LinkGestureSpec, LinkTarget };

// What a gesture needs from the pointer event that starts it (React or native).
export interface GestureStartEvent {
  button: number;
  clientX: number;
  clientY: number;
  preventDefault: () => void;
  stopPropagation: () => void;
}

export interface LinkDrop {
  sx: number; sy: number;   // container-relative screen position
  wx: number; wy: number;   // world position
  spec: LinkGestureSpec;
}

// Distance (screen px) between a side midpoint and its connect handle, shared with LinkHandles.
export const HANDLE_GAP_PX = 12;
const DRAG_THRESHOLD_PX = 4;
// Pointer this close (screen px) to a side midpoint or its handle pins the end to that side.
const SIDE_SNAP_PX = 18;
// Pointer this close (screen px) outside an item still targets it.
const EDGE_REACH_PX = 16;

function itemsOf(st: ReturnType<typeof useBoard.getState>): BoardItem[] {
  return st.items.filter((it) => it.kind !== "draw" && it.w > 0 && it.h > 0);
}

// Target under a world point: the top item containing it, else an item whose edge is within reach.
export function findTarget(items: BoardItem[], x: number, y: number, exceptId: string, k: number): Extract<LinkTarget, { kind: "item" }> | null {
  const pool = items.filter((it) => it.id !== exceptId);
  let hit = itemAtPoint(pool, x, y) as BoardItem | null;
  if (!hit) {
    let best = EDGE_REACH_PX * k;
    for (const it of pool) {
      const d = edgeDistance(it, { x, y });
      if (d >= 0 && d <= best) { best = d; hit = it; }
    }
  }
  if (!hit) return null;
  let side: Side | null = null;
  let best = SIDE_SNAP_PX * k;
  for (const s of SIDES) {
    const p = sidePoint(hit, s);
    const dir = sideDirection(hit, s);
    const gap = HANDLE_GAP_PX * k;
    const d = Math.min(Math.hypot(p.x - x, p.y - y), Math.hypot(p.x + dir.dx * gap - x, p.y + dir.dy * gap - y));
    if (d <= best) { best = d; side = s; }
  }
  return { kind: "item", id: hit.id, side };
}

function anchorFor(items: BoardItem[], t: LinkTarget): ShapeAnchor | null {
  if (t.kind === "link") return junctionAnchor(t.id, t.t);
  const it = items.find((x) => x.id === t.id);
  if (!it) return null;
  return t.side ? sideAnchor(it, t.side) : autoAnchor(it.id);
}

const sameTarget = (a: LinkTarget | null, b: LinkTarget | null) =>
  a?.kind === b?.kind && a?.id === b?.id && (a?.kind !== "item" || b?.kind !== "item" || a.side === b.side);

function writeShapes(next: DrawShape[], record: boolean) {
  useBoard.getState().drawSetShapes(next, record);
}

// Applies a finished gesture (see gestureModel.applyLinkEnd), new links named by `uid`.
export function applyLinkEnd(shapes: DrawShape[], spec: LinkGestureSpec, anchor: ShapeAnchor, endpoints: [number, number, number, number], style: LinkStyle = {}): DrawShape[] | null {
  return applyEnd(shapes, spec, anchor, endpoints, style, uid);
}

// Style of the link a connect gesture creates: the Settings defaults.
export function newLinkStyle(): LinkStyle {
  return linkDefaults(useBoard.getState().prefs);
}

// `geosRef`: the resolved links on screen (a junction end is placed on its parent's live path).
export function useLinkGesture(containerRef: RefObject<HTMLDivElement | null>, geosRef: RefObject<Map<string, LinkGeo>>) {
  const [active, setActive] = useState<LinkGestureSpec | null>(null);
  const [target, setTarget] = useState<LinkTarget | null>(null);
  const [drop, setDrop] = useState<LinkDrop | null>(null);
  const previewRef = useRef<SVGPathElement>(null);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const worldOf = useCallback((cx: number, cy: number) => {
    const r = containerRef.current?.getBoundingClientRect();
    return screenToBoard(useBoard.getState().view, cx - (r?.left ?? 0), cy - (r?.top ?? 0));
  }, [containerRef]);

  // `onTap`: a press released without moving (a Ctrl+click on an item stays a click).
  const start = useCallback((e: GestureStartEvent, spec: LinkGestureSpec, onTap?: () => void) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const st0 = useBoard.getState();
    const shapes0 = drawShapesOf(st0.items);
    const base = gestureBase(spec, shapes0);
    if (!base) return;
    const allowLink = linkTargetFilter(spec, base, linkIndex(shapes0));
    // Items of a collapsed subtree are not on screen: never a target.
    const collapsed = useLinkUi.getState().collapsed;
    const hidden = collapsed.length ? collapsedHidden(shapes0, collapsed) : null;
    const targets = (st: ReturnType<typeof useBoard.getState>) => (hidden ? itemsOf(st).filter((it) => !hidden.has(it.id)) : itemsOf(st));
    stop.current?.();
    const g = { sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY, moved: false };
    let last: LinkTarget | null = null;
    let raf = 0;
    setDrop(null);
    setTarget(null);
    setActive(spec);

    const exceptId = base.fixed.id;
    const route = base.link ? linkRoute(base.link) : "curved";

    // Item under the pointer first; away from every item, a link within reach.
    const targetAt = (items: BoardItem[], x: number, y: number, k: number): LinkTarget | null =>
      findTarget(items, x, y, exceptId, k) ?? findLinkTarget((geosRef.current ?? new Map<string, LinkGeo>()).values(), x, y, LINK_REACH_PX * k, allowLink);

    const paint = () => {
      raf = 0;
      const st = useBoard.getState();
      const k = chromePx(st.view.scale);
      const items = targets(st);
      const path = previewRef.current;
      if (!path) return;
      const boxes = new Map(items.map((it) => [it.id, it]));
      const geos = geosRef.current ?? new Map<string, LinkGeo>();
      const fixed = endSource(base.fixed, boxes, geos);
      if (!fixed) return;
      const w = worldOf(g.cx, g.cy);
      const t = targetAt(items, w.x, w.y, k);
      const anchor = t ? anchorFor(items, t) : null;
      const moving: EndSource = (anchor && endSource(anchor, boxes, geos)) || { kind: "free", p: w };
      // Ends in link order: the fixed end is a1 unless the moving end is the start of the link.
      const [e0, e1] = base.movingFirst ? resolveSources(moving, fixed, { route }) : resolveSources(fixed, moving, { route });
      path.setAttribute("d", routePath(route, e0, e1).d);
      if (!sameTarget(t, last)) { last = t; setTarget(t); }
    };

    const onMove = (ev: PointerEvent) => {
      g.cx = ev.clientX;
      g.cy = ev.clientY;
      if (!g.moved && Math.hypot(g.cx - g.sx, g.cy - g.sy) >= DRAG_THRESHOLD_PX) g.moved = true;
      if (g.moved && !raf) raf = requestAnimationFrame(paint);
    };
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      if (raf) cancelAnimationFrame(raf);
      stop.current = null;
      setActive(null);
      setTarget(null);
      // The grab dot that started a branch is gone: its link is no longer under the pointer.
      useLinkUi.getState().setHovered(null);
      if (commit && !g.moved) onTap?.();
      if (!commit || !g.moved) return;
      const st = useBoard.getState();
      const k = chromePx(st.view.scale);
      const items = targets(st);
      const w = worldOf(g.cx, g.cy);
      const t = targetAt(items, w.x, w.y, k);
      const anchor = t ? anchorFor(items, t) : null;
      if (anchor) {
        const shapes = drawShapesOf(st.items);
        const next = applyLinkEnd(shapes, spec, anchor, [w.x, w.y, w.x, w.y], newLinkStyle());
        if (next) writeShapes(next, true);
        return;
      }
      const r = containerRef.current?.getBoundingClientRect();
      setDrop({ sx: g.cx - (r?.left ?? 0), sy: g.cy - (r?.top ?? 0), wx: w.x, wy: w.y, spec });
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.stopPropagation();
      ev.preventDefault();
      finish(false);
    };
    stop.current = () => finish(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
  }, [containerRef, geosRef, worldOf]);

  return { active, target, drop, setDrop, start, previewRef };
}

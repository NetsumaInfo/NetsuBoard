// Which item the pointer is over (its links light up) and which item it is near enough to show the
// connect handles of (within a band around its edge, inside or out). Read from one pointermove
// listener, committed to React at most once per frame and only when an id changes.

import { useEffect, useRef, useState, type RefObject } from "react";
import { useBoard } from "../useReferenceBoard";
import { screenToBoard, type BoardItem } from "../referenceShared";
import { chromePx } from "../boardChrome";
import { edgeDistance } from "./model";

// Pointer within this distance (screen px) of an item's edge, inside or out, shows its handles.
const NEAR_IN_PX = 36;
const NEAR_OUT_PX = 30;

export interface PointerNear { nearId: string | null; overId: string | null }

export function usePointerNear(containerRef: RefObject<HTMLDivElement | null>, byId: Map<string, BoardItem>): PointerNear {
  const [state, setState] = useState<PointerNear>({ nearId: null, overId: null });
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    let raf = 0;
    let next: PointerNear = { nearId: null, overId: null };
    let current = next;
    const commit = () => {
      raf = 0;
      if (next.nearId === current.nearId && next.overId === current.overId) return;
      current = next;
      setState(next);
    };
    const onMove = (e: PointerEvent) => {
      // A pressed button is a gesture (drag, pan, marquee): handles never change under it.
      if (e.buttons !== 0 || e.pointerType === "touch") return;
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest("[data-link-handle]")) return;
      const st = useBoard.getState();
      const r = c.getBoundingClientRect();
      const w = screenToBoard(st.view, e.clientX - r.left, e.clientY - r.top);
      const k = chromePx(st.view.scale);
      const under = el?.closest("[data-board-item]")?.getAttribute("data-board-item") ?? null;
      const map = byIdRef.current;
      const near = (id: string | null) => {
        const it = id ? map.get(id) : null;
        if (!it) return false;
        const d = edgeDistance(it, w);
        return d >= -NEAR_IN_PX * k && d <= NEAR_OUT_PX * k;
      };
      next = { nearId: near(under) ? under : near(current.nearId) ? current.nearId : null, overId: under && map.has(under) ? under : null };
      if (!raf) raf = requestAnimationFrame(commit);
    };
    const onLeave = () => { next = { nearId: null, overId: null }; if (!raf) raf = requestAnimationFrame(commit); };
    c.addEventListener("pointermove", onMove);
    c.addEventListener("pointerleave", onLeave);
    return () => {
      c.removeEventListener("pointermove", onMove);
      c.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [containerRef]);
  return state;
}

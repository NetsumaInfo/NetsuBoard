// Pointer shortcuts of the links layer, caught in the capture phase before the items see them:
//   - Ctrl/Cmd-drag an item: draw a link from it instead of moving it (a Ctrl/Cmd-click without
//     moving adds or removes the item from the selection);
//   - "Link to…" pick mode: the next click on an item links the picked items to it, a click on the
//     empty board or Escape cancels. A dashed line follows the pointer from the first picked item.

import { useEffect, type RefObject } from "react";
import { useBoard } from "../useReferenceBoard";
import { screenToBoard } from "../referenceShared";
import { ANCHORABLE } from "../drawAnchor";
import { centerOf } from "./model";
import { linkItemsTo } from "./linkActions";
import { useLinkUi } from "./linkUi";
import type { GestureStartEvent, LinkGestureSpec } from "./useLinkGesture";

type Start = (e: GestureStartEvent, spec: LinkGestureSpec, onTap?: () => void) => void;

function itemIdAt(target: EventTarget | null): string | null {
  const el = target instanceof Element ? target : null;
  if (!el || el.closest("[data-link-handle]")) return null;
  return el.closest("[data-board-item]")?.getAttribute("data-board-item") ?? null;
}

function canLinkFrom(id: string): boolean {
  const st = useBoard.getState();
  if (st.drawMode || st.editingId === id || (st.collabProjectId !== null && st.collabRole === "viewer")) return false;
  const it = st.items.find((x) => x.id === id);
  return !!it && ANCHORABLE.has(it.kind) && it.w > 0 && it.h > 0;
}

export function useCtrlDragLink(containerRef: RefObject<HTMLDivElement | null>, start: Start): void {
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (useLinkUi.getState().pickFrom) return;
      const id = itemIdAt(e.target);
      if (!id || !canLinkFrom(id)) return;
      start(e, { kind: "connect", fromId: id }, () => useBoard.getState().toggleSelect(id));
    };
    c.addEventListener("pointerdown", onDown, true);
    return () => c.removeEventListener("pointerdown", onDown, true);
  }, [containerRef, start]);
}

export function usePickMode(containerRef: RefObject<HTMLDivElement | null>, previewRef: RefObject<SVGPathElement | null>): string[] | null {
  const pickFrom = useLinkUi((s) => s.pickFrom);
  useEffect(() => {
    const c = containerRef.current;
    if (!c || !pickFrom) return;
    const stop = () => useLinkUi.getState().stopPick();
    const onDown = (e: PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const id = e.button === 0 ? itemIdAt(e.target) : null;
      if (id && !pickFrom.includes(id)) linkItemsTo(pickFrom, id);
      stop();
    };
    const onMove = (e: PointerEvent) => {
      const st = useBoard.getState();
      const from = st.items.find((it) => it.id === pickFrom[0]);
      const path = previewRef.current;
      if (!from || !path) return;
      const r = c.getBoundingClientRect();
      const w = screenToBoard(st.view, e.clientX - r.left, e.clientY - r.top);
      const a = centerOf(from);
      path.setAttribute("d", `M ${a.x} ${a.y} L ${w.x} ${w.y}`);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      stop();
    };
    c.addEventListener("pointerdown", onDown, true);
    c.addEventListener("pointermove", onMove);
    window.addEventListener("keydown", onKey, true);
    return () => {
      c.removeEventListener("pointerdown", onDown, true);
      c.removeEventListener("pointermove", onMove);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [containerRef, previewRef, pickFrom]);
  return pickFrom;
}

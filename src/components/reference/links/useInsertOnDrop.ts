// Dropping a dragged item onto a link inserts it in the middle (A→B becomes A→X→B). Follows the
// live geometry channel synchronously: while ONE item is moved, the link under its centre is the
// candidate (shown by LinkLayer); when the gesture ends, the store already holds the committed
// position, and the insertion joins the move's history entry (same tick: one undo).

import { useEffect, useRef, useState, type RefObject } from "react";
import { useBoard } from "../useReferenceBoard";
import { getLive, subscribeLive } from "../boardLive";
import { chromePx } from "../boardChrome";
import type { Geom } from "../referenceShared";
import { centerOf, distToPath, hitLink, type LinkGeo } from "./model";
import { insertItemIntoLink } from "./linkActions";

// Centre of the dragged item this close (screen px) to a link drops it in.
const INSERT_REACH_PX = 18;

// The single item being moved (not resized or rotated), with its live geometry.
function movingItem(geom: Record<string, Geom>): { id: string; g: Geom } | null {
  const st = useBoard.getState();
  if (st.selectedIds.length !== 1) return null;
  const id = st.selectedIds[0];
  const g = geom[id];
  const it = g ? st.items.find((x) => x.id === id) : undefined;
  if (!g || !it || Math.abs(it.w - g.w) > 0.5 || Math.abs(it.h - g.h) > 0.5 || (it.rotation || 0) !== (g.rotation || 0)) return null;
  return { id, g };
}

function linkUnder(geos: readonly LinkGeo[], itemId: string, box: Geom): string | null {
  const c = centerOf(box);
  const tol = INSERT_REACH_PX * chromePx(useBoard.getState().view.scale);
  let best: string | null = null;
  let bestD = Infinity;
  for (const geo of geos) {
    const s = geo.shape;
    if (s.a1!.id === itemId || s.a2!.id === itemId || !hitLink(geo.path, c.x, c.y, tol)) continue;
    const d = distToPath(geo.path, c.x, c.y);
    if (d < bestD) { bestD = d; best = s.id; }
  }
  return best;
}

export function useInsertOnDrop(geosRef: RefObject<LinkGeo[]>, enabled: boolean): string | null {
  const [candidate, setCandidate] = useState<string | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  useEffect(() => {
    let current: { linkId: string; itemId: string } | null = null;
    const set = (next: typeof current) => {
      if (next?.linkId === current?.linkId && next?.itemId === current?.itemId) return;
      current = next;
      setCandidate(next?.linkId ?? null);
    };
    return subscribeLive(() => {
      const geom = getLive().geom;
      const live = Object.keys(geom).length > 0;
      if (live) {
        const moving = enabledRef.current ? movingItem(geom) : null;
        const linkId = moving ? linkUnder(geosRef.current ?? [], moving.id, moving.g) : null;
        set(moving && linkId ? { linkId, itemId: moving.id } : null);
        return;
      }
      const done = current;
      set(null);
      if (!done) return;
      // Gesture over: confirm on the committed position before inserting.
      const it = useBoard.getState().items.find((x) => x.id === done.itemId);
      if (it && linkUnder(geosRef.current ?? [], it.id, it) === done.linkId) insertItemIntoLink(done.linkId, done.itemId);
    });
  }, [geosRef]);
  return candidate;
}

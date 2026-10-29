// The one selector the links layer reads geometry through: store items merged with the LIVE
// geometry of a gesture in progress (boardLive.ts), so links follow an item while it is moved,
// resized or rotated — alone, in a multi-selection, or carried by a frame — and follow undo/redo and
// collaborator edits through the store. Nothing here writes to the store.
//
// PERF — live updates are coalesced to one per animation frame, and each link's geometry is cached
// by a key of everything it depends on: during a gesture only the links of the moving items get a
// new geometry object (with the branches hanging from them), so only their memoised paths re-render.

import { useEffect, useMemo, useRef, useState } from "react";
import { useBoard } from "../useReferenceBoard";
import { getLive, subscribeLive } from "../boardLive";
import type { BoardItem, DrawShape, Geom } from "../referenceShared";
import { isLink, type LinkGeo } from "./model";
import { resolveLinkGeos, type GeoCache } from "./resolve";

const EMPTY_SHAPES: DrawShape[] = [];

export function drawShapesOf(items: readonly BoardItem[]): DrawShape[] {
  return items.find((it) => it.kind === "draw")?.shapes ?? EMPTY_SHAPES;
}

// Live geometry, at most one update per frame.
export function useLiveGeom(): Record<string, Geom> {
  const [geom, setGeom] = useState(() => getLive().geom);
  useEffect(() => {
    let raf = 0;
    const sync = () => { raf = 0; setGeom(getLive().geom); };
    const unsub = subscribeLive(() => { if (!raf) raf = requestAnimationFrame(sync); });
    sync();
    return () => { unsub(); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return geom;
}

export interface LinkScene {
  items: BoardItem[];
  shapes: DrawShape[];             // every drawn shape (links included), as stored
  byId: Map<string, BoardItem>;    // items of the level on screen, live geometry applied
  geos: LinkGeo[];                 // links whose ends all resolve on this level, parents first
  geoById: Map<string, LinkGeo>;
  live: boolean;                   // a gesture is publishing geometry
}

export function useLinkScene(k: number): LinkScene {
  const items = useBoard((s) => s.items);
  const liveGeom = useLiveGeom();
  const shapes = useMemo(() => drawShapesOf(items), [items]);
  const links = useMemo(() => shapes.filter(isLink), [shapes]);
  const live = Object.keys(liveGeom).length > 0;

  const byId = useMemo(() => {
    const m = new Map<string, BoardItem>();
    for (const it of items) {
      if (it.kind === "draw") continue;
      const g = liveGeom[it.id];
      m.set(it.id, g ? { ...it, ...g } : it);
    }
    return m;
  }, [items, liveGeom]);

  const cache = useRef<GeoCache>(new Map());
  const resolved = useMemo(() => {
    const r = resolveLinkGeos(links, byId, k, cache.current);
    cache.current = r.cache;
    return r;
  }, [links, byId, k]);

  return { items, shapes, byId, geos: resolved.geos, geoById: resolved.byId, live };
}

// Moteur de gestes d'un item du board : déplacer / redimensionner (8 poignées) / pivoter.
// Remplace interact.js par des pointer events natifs. Pendant le geste, la géométrie vit dans
// un état LOCAL (override) coalescé en rAF → seul l'item manipulé re-render, jamais tout le board.
// Au relâchement (pointerup) on commit dans le store. Tient compte du zoom du board (delta /scale)
// et de la rotation de l'item (le redimensionnement se fait dans le repère local de l'item).
// Le zoom est LU AU DÉBUT du geste (on ne zoome pas en pleine manipulation) plutôt que reçu en prop :
// une prop réactive re-rendait TOUS les items du board à chaque cran de molette.

import { useCallback, useEffect, useRef, useState } from "react";
import { type Geom, MIN_SIZE } from "./referenceShared";
import { useBoard } from "./useReferenceBoard";
import { rotatedBBox } from "./boardArrange";
import { snapMove, snapValue, snapCandidates, type SnapGuide, type SnapRect } from "./boardSnap";
import { clearLive, setLiveGeom, setLiveGuides } from "./boardLive";
import { frameHugRect, frameHugStart, geomBox, linkedFrame, type FrameHug } from "./boardFrames";

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type Mode = { type: "move" } | { type: "rotate" } | { type: "resize"; handle: ResizeHandle };

// Un item EMMENÉ par le geste (contenu d'un cadre, reste de la multi-sélection) : son wrapper et sa
// position de départ, de quoi le translater en impératif à chaque frame.
interface Carried {
  id: string;
  // Null when the item is culled (off screen): nothing to move, but its links still follow.
  el: HTMLElement | null;
  x: number;
  y: number;
  r: number;
  // Linked to a drawn shape (a link between items): its live geometry is published so the link
  // follows the carried item during the gesture, not only once it is dropped.
  live: Geom | null;
}

interface Drag {
  mode: Mode;
  startX: number;
  startY: number;
  origin: Geom;
  cx: number; // centre item (board coords) — réancrage du redimensionnement
  cy: number;
  scx: number; // centre item à l'ÉCRAN (px) — pivot de rotation (invariant pan/zoom)
  scy: number;
  scale: number; // zoom du board FIGÉ au début du geste (cf. commentaire d'en-tête)
  // Aimant : voisins et seuil FIGÉS au début du geste (une seule lecture du store, pas une par frame).
  snap: { others: SnapRect[]; cands: { x: number[]; y: number[] }; threshold: number; stick: number } | null;
  live: boolean; // publier la géométrie vivante (des tracés sont liés à cet item)
  // Contenu emmené + déplacement courant : appliqués en IMPÉRATIF (cf. la boucle rAF plus bas).
  carry: Carried[];
  dx: number;
  dy: number;
  // Cadre qui tient l'item manipulé : il s'ajuste en direct sur son contenu. `geom` = dernier
  // rectangle calculé (null = rien à changer), commité au relâchement.
  hug: { id: string; el: HTMLElement | null; state: FrameHug; geom: Geom | null; live: boolean } | null;
  // The pointer that owns the gesture and the element holding its capture (released at the end).
  pointerId: number;
  cap: Element;
  // A move only starts once the pointer left the press point by MOVE_SLOP screen pixels: a click, or
  // the jitter of a double-click, never nudges the item, never commits, never costs an undo step.
  moved: boolean;
}

const MOVE_SLOP = 3;

const RAD = Math.PI / 180;

// Unité horizontale/verticale poussée par chaque poignée (sur les axes locaux de l'item).
const HANDLE_DIR: Record<ResizeHandle, { dx: number; dy: number }> = {
  nw: { dx: -1, dy: -1 }, n: { dx: 0, dy: -1 }, ne: { dx: 1, dy: -1 },
  e: { dx: 1, dy: 0 }, se: { dx: 1, dy: 1 }, s: { dx: 0, dy: 1 },
  sw: { dx: -1, dy: 1 }, w: { dx: -1, dy: 0 },
};

export function usePointerTransform(
  geom: Geom,
  // `extra.frame` = cadre ajusté pendant le geste, à commiter dans le MÊME tick que la géométrie
  // de l'item (une seule entrée d'annulation pour un seul geste).
  onCommit: (g: Geom, extra?: { frame?: { id: string; geom: Geom } }) => void,
  opts?: {
    keepAspect?: boolean;
    captureRef?: React.RefObject<HTMLElement | null>;
    // Id de l'item manipulé : active l'aimant (les autres items deviennent des cibles d'accrochage)
    // et la publication de géométrie vivante quand des tracés lui sont liés.
    id?: string;
    // Items EMMENÉS par celui-ci (contenu d'un cadre) : ils ne peuvent pas être cibles d'aimant.
    // Fonction acceptée pour ne calculer la liste qu'au début du geste, pas à chaque rendu.
    groupIds?: string[] | (() => string[]);
    // Item posable dans un cadre : le cadre qui le tient s'ajuste sur lui (cf. boardFrames).
    hugFrame?: boolean;
  },
) {
  const [override, setOverride] = useState<Geom | null>(null);
  // Reactive mirror of `drag.current != null` (a ref read during render goes stale: the cursor stuck on
  // "grabbing" after a click that never re-rendered the item).
  const [dragging, setDragging] = useState(false);
  const drag = useRef<Drag | null>(null);
  const raf = useRef<number | null>(null);
  const pending = useRef<Geom | null>(null);
  const latest = useRef<Geom>(geom);
  // `geom` est construit inline par BoardItem : synchronisation à chaque commit, sans dépendance
  // d'objet toujours neuve qui relancerait artificiellement un effet à chaque rendu.
  useEffect(() => { latest.current = override ?? geom; });

  const flush = useCallback(() => {
    raf.current = null;
    if (pending.current) setOverride(pending.current);
  }, []);

  const schedule = useCallback(
    (g: Geom) => {
      pending.current = g;
      if (raf.current == null) raf.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  // Le contenu emmené suit en DIRECT, écrit à même le DOM à chaque frame — même voie que le pan du
  // board. Le faire passer par le store re-rendrait toute la planche à chaque pointermove ; l'envoyer
  // au canal de géométrie vivante abonnerait chaque item du board à chaque geste. La boucle tourne
  // tant que le geste dure : un re-render qui remettrait la position du store est ainsi corrigé à la
  // frame suivante, et réécrire une transform identique ne coûte rien.
  const carryRaf = useRef<number | null>(null);
  const carryTick = useCallback(() => {
    const d = drag.current;
    if (!d || !d.carry.length) { carryRaf.current = null; return; }
    let live: Record<string, Geom> | null = null;
    for (const c of d.carry) {
      if (c.el) c.el.style.transform = `translate(${c.x + d.dx}px, ${c.y + d.dy}px) rotate(${c.r}deg)`;
      if (c.live) (live ??= {})[c.id] = { ...c.live, x: c.x + d.dx, y: c.y + d.dy };
    }
    if (live) setLiveGeom(live);
    carryRaf.current = requestAnimationFrame(carryTick);
  }, []);
  const stopCarry = useCallback(() => {
    if (carryRaf.current != null) { cancelAnimationFrame(carryRaf.current); carryRaf.current = null; }
    for (const c of drag.current?.carry ?? []) if (c.el) c.el.style.willChange = "";
  }, []);

  // Cadre qui s'ajuste : appliqué en impératif comme le contenu emmené (transform + taille du
  // wrapper). `free` (Alt enfoncé) le fige à son rectangle d'origine — c'est la porte de sortie pour
  // manipuler un item sans que son cadre ne bouge.
  const applyHug = useCallback((d: Drag, g: Geom, free: boolean) => {
    const h = d.hug;
    if (!h) return;
    h.geom = free ? null : frameHugRect(h.state, geomBox(g));
    const r = h.geom ?? h.state.base;
    // A frame with links: they follow it while it grows around the item.
    if (h.live) setLiveGeom({ [h.id]: { x: r.x, y: r.y, w: r.w, h: r.h, rotation: 0 } });
    const el = h.el;
    if (!el) return;
    el.style.transform = `translate(${r.x}px, ${r.y}px) rotate(0deg)`;
    el.style.width = `${r.w}px`;
    el.style.height = `${r.h}px`;
  }, []);

  const start = useCallback(
    (mode: Mode, e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      // A gesture still open (its pointerup never came) is closed first: its navigation hold and
      // capture must not leak into the new one.
      if (drag.current) finishRef.current(true);
      const cap = opts?.captureRef?.current ?? (e.currentTarget as Element);
      try { cap.setPointerCapture?.(e.pointerId); } catch { /* capture best-effort */ }
      // Centre ÉCRAN de l'item (rect du wrapper) : pivot de rotation correct quel que soit
      // le pan/zoom du board (l'angle est invariant par translation/échelle uniforme).
      const r = cap.getBoundingClientRect();
      const g = latest.current;
      const st = useBoard.getState();
      const scale = st.view.scale;

      // Cibles de l'aimant : tous les autres items, sauf ceux qui partent avec (multi-sélection),
      // le calque de dessin, et les cadres de pose. Lues UNE fois : la scène ne bouge pas pendant
      // le geste, et relire N items par frame coûterait plus cher que le geste lui-même.
      let snap: Drag["snap"] = null;
      if (opts?.id && st.prefs.snap && mode.type !== "rotate") {
        // Ce qui part AVEC l'item ne peut pas servir de cible : la multi-sélection déplacée en bloc,
        // et le contenu d'un cadre (un cadre emmène ce qu'il contient).
        const group = st.selectedIds.length > 1 && st.selectedIds.includes(opts.id) ? st.selectedIds : [opts.id];
        const carried = typeof opts.groupIds === "function" ? opts.groupIds() : opts.groupIds ?? [];
        const skip = new Set([...group, ...carried]);
        const others = st.items
          .filter((it) => !skip.has(it.id) && it.kind !== "draw" && it.w > 0 && it.h > 0)
          .map((it) => {
            const b = rotatedBBox(it);
            return { x: b.x, y: b.y, w: b.w, h: b.h };
          });
        if (others.length) {
          snap = {
            others,
            cands: snapCandidates(others),
            threshold: (st.prefs.snapThreshold ?? 8) / scale,
            stick: st.prefs.snapStick ?? 0,
          };
        }
      }

      // Publication vivante seulement si un tracé est réellement lié à cet item (sinon, zéro coût).
      const linkedIds = new Set<string>();
      let boardHasLinks = false;
      for (const s of st.items.find((it) => it.kind === "draw")?.shapes ?? []) {
        if (s.own) linkedIds.add(s.own);
        if (s.a1) linkedIds.add(s.a1.id);
        if (s.a2) linkedIds.add(s.a2.id);
        if (s.a1 && s.a2) boardHasLinks = true;
      }
      // A lone item moved on a board with links can be dropped INTO a link (links/useInsertOnDrop),
      // which needs to follow its position too.
      const overLinks = mode.type === "move" && boardHasLinks && st.selectedIds.length <= 1;
      const anchored = opts?.id ? linkedIds.has(opts.id) || overLinks : false;

      // Ce qui part AVEC l'item : le reste de la multi-sélection, et le contenu d'un cadre. Wrappers
      // et positions de départ lus UNE fois, puis promus en couche le temps du geste (leur transform
      // change à chaque frame ; sans promotion, Chromium re-rasterise chaque média à chaque frame).
      const carry: Carried[] = [];
      if (mode.type === "move" && opts?.id) {
        const sel = st.selectedIds.length > 1 && st.selectedIds.includes(opts.id) ? st.selectedIds : [];
        const carried = typeof opts.groupIds === "function" ? opts.groupIds() : opts.groupIds ?? [];
        const ids = new Set([...sel, ...carried]);
        ids.delete(opts.id);
        for (const id of ids) {
          const it = st.items.find((i) => i.id === id);
          const el = document.querySelector<HTMLElement>(`[data-board-item="${id}"]`);
          if (!it) continue;
          // Culled item: it joins its place at commit, but a linked one still publishes its geometry.
          if (!el && !linkedIds.has(id)) continue;
          if (el) el.style.willChange = "transform";
          carry.push({
            id, el, x: it.x, y: it.y, r: it.rotation || 0,
            live: linkedIds.has(id) ? { x: it.x, y: it.y, w: it.w, h: it.h, rotation: it.rotation || 0 } : null,
          });
        }
      }

      // Cadre à ajuster. Un cadre TOURNÉ est laissé tranquille : « le bord du bas » n'a plus d'axe
      // propre, et le redimensionner donnerait un rectangle qui ne correspond à rien de visible.
      let hug: Drag["hug"] = null;
      if (opts?.hugFrame && opts.id && mode.type !== "rotate") {
        const me = st.items.find((i) => i.id === opts.id);
        const f = me ? linkedFrame(me, st.items) : null;
        if (f && !f.rotation) {
          hug = {
            id: f.id,
            el: document.querySelector<HTMLElement>(`[data-board-item="${f.id}"]`),
            state: frameHugStart(f, st.items, opts.id),
            geom: null,
            live: linkedIds.has(f.id),
          };
        }
      }

      drag.current = {
        mode,
        startX: e.clientX,
        startY: e.clientY,
        origin: { ...g },
        cx: g.x + g.w / 2,
        cy: g.y + g.h / 2,
        scx: r.left + r.width / 2,
        scy: r.top + r.height / 2,
        scale,
        snap,
        live: anchored,
        carry,
        dx: 0,
        dy: 0,
        hug,
        pointerId: e.pointerId,
        cap,
        moved: mode.type !== "move",
      };
      setDragging(true);
      if (carry.length && carryRaf.current == null) carryRaf.current = requestAnimationFrame(carryTick);
      useBoard.getState().beginNavigation();
    },
    [opts?.captureRef, opts?.id, opts?.groupIds, opts?.hugFrame, carryTick],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (!d.moved) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < MOVE_SLOP) return;
        d.moved = true;
      }
      // Delta écran → delta board (compense le zoom).
      const dxs = (e.clientX - d.startX) / d.scale;
      const dys = (e.clientY - d.startY) / d.scale;
      const o = d.origin;

      if (d.mode.type === "move") {
        let g: Geom = { ...o, x: o.x + dxs, y: o.y + dys };
        // Aimant : accrochage bords / centres / coins, et collage bord à bord. Alt = geste libre.
        if (d.snap && !e.altKey) {
          const b = rotatedBBox(g);
          const res = snapMove(b, d.snap.others, d.snap.threshold, d.snap.stick);
          if (res.dx || res.dy) g = { ...g, x: g.x + res.dx, y: g.y + res.dy };
          setLiveGuides(res.guides);
        } else if (d.snap) {
          setLiveGuides([]);
        }
        // Le contenu emmené lit ce delta à la frame suivante ; le cadre englobant grandit tout de suite.
        d.dx = g.x - o.x;
        d.dy = g.y - o.y;
        applyHug(d, g, e.altKey);
        schedule(g);
        if (d.live && opts?.id) setLiveGeom({ [opts.id]: g });
        return;
      }

      if (d.mode.type === "rotate") {
        // Angle autour du centre ÉCRAN (px) : delta exact même board pané/zoomé.
        const a0 = Math.atan2(d.startY - d.scy, d.startX - d.scx);
        const a1 = Math.atan2(e.clientY - d.scy, e.clientX - d.scx);
        let deg = o.rotation + (a1 - a0) / RAD;
        if (e.shiftKey || e.ctrlKey) deg = Math.round(deg / 15) * 15; // snap 15°
        const g = { ...o, rotation: deg };
        schedule(g);
        if (d.live && opts?.id) setLiveGeom({ [opts.id]: g });
        return;
      }

      // resize : projeter le delta sur les axes LOCAUX de l'item (annule la rotation).
      const dir = HANDLE_DIR[d.mode.handle];
      const cos = Math.cos(o.rotation * RAD);
      const sin = Math.sin(o.rotation * RAD);
      const localX = dxs * cos + dys * sin;
      const localY = -dxs * sin + dys * cos;

      let nw = o.w + dir.dx * localX;
      let nh = o.h + dir.dy * localY;
      const aspect = opts?.keepAspect && o.h !== 0 ? o.w / o.h : null;
      if (aspect) {
        // Proportionnel : axe dominant pilote, sauf poignées de bord (n/s/e/w) → l'axe actif.
        if (dir.dx !== 0 && dir.dy !== 0) {
          if (Math.abs(localX) > Math.abs(localY)) nh = nw / aspect;
          else nw = nh * aspect;
        } else if (dir.dx !== 0) nh = nw / aspect;
        else nw = nh * aspect;
      }
      nw = Math.max(MIN_SIZE, nw);
      nh = Math.max(MIN_SIZE, nh);

      // Garder le coin/bord OPPOSÉ fixe : recentre selon la croissance, en repère monde.
      const grewW = nw - o.w;
      const grewH = nh - o.h;
      const offLocalX = (dir.dx * grewW) / 2;
      const offLocalY = (dir.dy * grewH) / 2;
      const offX = offLocalX * cos - offLocalY * sin;
      const offY = offLocalX * sin + offLocalY * cos;
      const ncx = d.cx + offX;
      const ncy = d.cy + offY;
      let g: Geom = { rotation: o.rotation, w: nw, h: nh, x: ncx - nw / 2, y: ncy - nh / 2 };

      // Aimant au redimensionnement : seuls les bords TIRÉS s'accrochent, et seulement sur un item
      // non tourné (sur un item pivoté, « le bord droit » n'a plus d'axe propre — on laisse libre).
      if (d.snap && !e.altKey && !o.rotation) {
        const guides: SnapGuide[] = [];
        const { cands } = d.snap;
        if (dir.dx > 0) {
          const s = snapValue(g.x + g.w, cands.x, d.snap.threshold);
          if (s.at != null) { g = { ...g, w: Math.max(MIN_SIZE, s.value - g.x) }; guides.push({ axis: "x", at: s.at, from: g.y, to: g.y + g.h }); }
        } else if (dir.dx < 0) {
          const s = snapValue(g.x, cands.x, d.snap.threshold);
          if (s.at != null) { const right = g.x + g.w; g = { ...g, x: s.value, w: Math.max(MIN_SIZE, right - s.value) }; guides.push({ axis: "x", at: s.at, from: g.y, to: g.y + g.h }); }
        }
        if (dir.dy > 0) {
          const s = snapValue(g.y + g.h, cands.y, d.snap.threshold);
          if (s.at != null) { g = { ...g, h: Math.max(MIN_SIZE, s.value - g.y) }; guides.push({ axis: "y", at: s.at, from: g.x, to: g.x + g.w }); }
        } else if (dir.dy < 0) {
          const s = snapValue(g.y, cands.y, d.snap.threshold);
          if (s.at != null) { const bottom = g.y + g.h; g = { ...g, y: s.value, h: Math.max(MIN_SIZE, bottom - s.value) }; guides.push({ axis: "y", at: s.at, from: g.x, to: g.x + g.w }); }
        }
        setLiveGuides(guides);
      }

      // Agrandir un item contre le bord de son cadre ouvre la place, exactement comme l'y pousser.
      applyHug(d, g, e.altKey);
      schedule(g);
      if (d.live && opts?.id) setLiveGeom({ [opts.id]: g });
    },
    [schedule, applyHug, opts?.keepAspect, opts?.id],
  );

  // Ends the gesture: commit the geometry reached (or drop it), release the capture, give the store
  // back. Idempotent — pointerup, pointercancel, a lost capture, a window blur and Escape all land here.
  const finish = useCallback(
    (commit: boolean) => {
      const d = drag.current;
      if (!d) return;
      try { d.cap.releasePointerCapture?.(d.pointerId); } catch { /* noop */ }
      const keep = commit && d.moved;
      const hugged = keep && d.hug?.geom ? { id: d.hug.id, geom: { ...d.hug.geom } } : undefined;
      stopCarry();
      drag.current = null;
      if (raf.current != null) {
        cancelAnimationFrame(raf.current);
        raf.current = null;
      }
      const g = pending.current ?? override;
      pending.current = null;
      if (keep && g) onCommit(g, hugged ? { frame: hugged } : undefined);
      // Carried items and the hugging frame were moved by hand on the DOM: a cancelled or unmoved
      // gesture puts them back where the store has them.
      if (!keep) {
        for (const c of d.carry) if (c.el) c.el.style.transform = `translate(${c.x}px, ${c.y}px) rotate(${c.r}deg)`;
        const h = d.hug;
        if (h?.el) {
          const r = h.state.base;
          h.el.style.transform = `translate(${r.x}px, ${r.y}px) rotate(0deg)`;
          h.el.style.width = `${r.w}px`;
          h.el.style.height = `${r.h}px`;
        }
      }
      setOverride(null);
      setDragging(false);
      // Le store fait de nouveau foi : guides éteints, géométrie vivante rendue.
      clearLive();
      useBoard.getState().endNavigation();
    },
    [onCommit, override, stopCarry],
  );
  const finishRef = useRef(finish);
  useEffect(() => { finishRef.current = finish; });

  const onPointerUp = useCallback(() => finish(true), [finish]);
  const onLostPointerCapture = useCallback(() => finish(true), [finish]);

  // While a gesture lasts: Escape drops it, losing the window (alt-tab, release outside the app)
  // ends it. Neither can leave the item stuck in "dragging".
  useEffect(() => {
    if (!dragging) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") finishRef.current(false); };
    const onBlur = () => finishRef.current(true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [dragging]);

  useEffect(
    () => () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
      if (drag.current) {
        stopCarry();
        drag.current = null;
        clearLive();
        useBoard.getState().endNavigation();
      }
    },
    [stopCarry],
  );

  return {
    geom: override ?? geom,
    dragging,
    startMove: (e: React.PointerEvent) => start({ type: "move" }, e),
    startRotate: (e: React.PointerEvent) => start({ type: "rotate" }, e),
    startResize: (handle: ResizeHandle, e: React.PointerEvent) => start({ type: "resize", handle }, e),
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onLostPointerCapture,
    // Ends the gesture on demand (an item entering edit mode while one is open).
    abort: () => finishRef.current(true),
  };
}

// Links layer: the single owner of links between items — drawing, hit areas, labels, connect,
// re-attach and branch handles, junction dots, collapse badges, the toolbar of the selected link(s),
// the "neuron" focus, the hint of a drop into a link, the "Link to…" pick mode and the drop popover.
// DrawLayer draws every other stroke and skips links.
//
// PERF — one SVG for every link, inside a `data-board-pan` layer: the imperative pan/zoom moves it
// like the items, and nothing here re-renders on a pan frame. Each link is a memoised component fed
// a geometry object that only changes when one of its two items moves (see useLinkScene), links
// outside the viewport (one viewport of margin) are not rendered, and handles exist for at most one
// item and one link (junction dots are part of the wire, drawn in the same SVG). Hover and dimming
// are CSS; the branch dot follows the pointer imperatively, without a React render.

import { memo, useCallback, useMemo, useRef, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { useBoard } from "../useReferenceBoard";
import { chromePx, chromeVisible } from "../boardChrome";
import { ANCHORABLE } from "../drawAnchor";
import { screenToBoard, type BoardItem } from "../referenceShared";
import { connectedIds, linkDashed, parseLabelStyle, type LinkGeo, type Pt } from "./model";
import { clampT, collapsedHidden, downstreamOf, pointAt, projectOnPath } from "./junction";
import { useLinkScene } from "./useLinkScene";
import { labelPoint } from "./labelPlace";
import { useLinkGesture, type GestureStartEvent, type LinkGestureSpec } from "./useLinkGesture";
import { BranchDot, CollapseBadge, ConnectHandles, EndHandles, TargetHint } from "./LinkHandles";
import { EDITOR_BOX, LinkLabel, layoutOf } from "./LinkLabel";
import { LinkEditorMenu } from "./LinkEditorMenu";
import { LinkDropMenu } from "./LinkDropMenu";
import { deleteLinks, patchLinks, reverseLinks, toggleCollapse } from "./linkActions";
import { enterLink, leaveLink, useLinkUi } from "./linkUi";
import { usePointerNear } from "./usePointerNear";
import { useCtrlDragLink, usePickMode } from "./useLinkShortcutsOnBoard";
import { useInsertOnDrop } from "./useInsertOnDrop";

const HIT_PX = 14;
// Junction dot: radius beyond the stroke, and radius of its grab area (screen px).
const JUNCTION_DOT_PX = 2;
const JUNCTION_HIT_PX = 8;
const EMPTY_IDS: ReadonlySet<string> = new Set();
// Room between a label pill and the branch dot beside it, and below it for the toolbar (screen px).
const DOT_BESIDE_LABEL_PX = 12;
const TOOLBAR_GAP_PX = 10;
const TOOLBAR_GAP_BARE_PX = 14;

const LINK_CSS = `
@keyframes nb-link-in{from{opacity:0}to{opacity:1}}
.nb-link{transition:opacity .15s ease-out}
.nb-link[data-state=dim]{opacity:.15}
.nb-link[data-state=ghost]{opacity:.3}
.nb-link-halo{opacity:0;transition:opacity .12s ease-out}
.nb-link[data-hl] .nb-link-halo{opacity:.16}
.nb-link:hover .nb-link-halo{opacity:.28}
.nb-link[data-sel] .nb-link-halo{opacity:.45}
.nb-link[data-state=insert] .nb-link-halo{opacity:.6}
.nb-link-label{transition:opacity .15s ease-out,border-color .12s ease-out}
.nb-link-label[data-state=dim]{opacity:.25}
.nb-link-label:hover{border-color:color-mix(in srgb,var(--color-primary) 60%,transparent)}
.nb-link-handle{animation:nb-link-in .14s ease-out}
.nb-link-dot{display:block;width:7px;height:7px;border-radius:999px;background:color-mix(in srgb,var(--color-fg) 30%,transparent);transition:transform .12s ease-out,background-color .12s ease-out,box-shadow .12s ease-out}
.nb-link-dot-end{width:8px;height:8px;background:var(--color-bg);box-shadow:0 0 0 1px color-mix(in srgb,var(--color-fg) 40%,transparent)}
.nb-link-handle:hover .nb-link-dot{background:var(--color-primary);box-shadow:none;transform:scale(1.5)}
.nb-link-junction{opacity:.7;transform-box:fill-box;transform-origin:center;transition:opacity .12s ease-out,transform .12s ease-out}
.nb-link:hover .nb-link-junction,.nb-link[data-sel] .nb-link-junction,.nb-link[data-hl] .nb-link-junction{opacity:1}
.nb-link-jhit:hover+.nb-link-junction{opacity:1;transform:scale(1.6)}
.nb-link-menu{animation:nb-link-in .14s ease-out}
.nb-link-picking [data-board-item]{cursor:crosshair !important}
`;

type LinkState = "lit" | "dim" | "ghost" | "insert" | "";

const maskIdOf = (id: string) => `nbl-${id.replace(/[^A-Za-z0-9_-]/g, "_")}`;

function selectByPointer(e: React.PointerEvent, id: string) {
  const st = useBoard.getState();
  if (e.shiftKey) {
    const held = st.drawSel;
    st.selectDrawShapes(held.includes(id) ? held.filter((x) => x !== id) : [...held, id]);
  } else st.selectDrawShape(id);
}

type EndDown = (e: React.PointerEvent, linkId: string, end: 1 | 2) => void;
type LinkPointer = (e: React.PointerEvent, linkId: string) => void;

// Junction dot of a branch end: a small node on the wire (low contrast, clearer on hover or
// selection), over a larger transparent grab area. Dragging it slides the end along its parent, or
// re-attaches it to an item or another link; right-click offers detach / delete (BoardMenu).
function JunctionDot({ linkId, end, at, color, w, k, interactive, onDown }: {
  linkId: string; end: 1 | 2; at: Pt; color: string; w: number; k: number; interactive: boolean; onDown: EndDown | null;
}) {
  return (
    <>
      <circle
        className="nb-link-jhit"
        cx={at.x}
        cy={at.y}
        r={JUNCTION_HIT_PX * k}
        fill="transparent"
        data-draw-shape={linkId}
        data-link-handle
        pointerEvents={interactive ? "all" : "none"}
        style={{ cursor: onDown ? "grab" : "pointer" }}
        onPointerEnter={() => enterLink(linkId)}
        onPointerLeave={leaveLink}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          if (onDown) onDown(e, linkId, end);
          else { e.stopPropagation(); selectByPointer(e, linkId); }
        }}
      />
      <circle className="nb-link-junction" cx={at.x} cy={at.y} r={w * 0.5 + JUNCTION_DOT_PX * k} fill={color} stroke="var(--color-bg)" strokeWidth={k} pointerEvents="none" />
    </>
  );
}

const LinkPath = memo(function LinkPath({ geo, k, state, selected, highlighted, interactive, masked, onJunctionDown, onAltDown, onTrack }: {
  geo: LinkGeo;
  k: number;
  state: LinkState;
  selected: boolean;
  highlighted: boolean;
  interactive: boolean;
  masked: boolean;
  // Null for a viewer: junctions cannot be dragged, branches cannot be drawn.
  onJunctionDown: EndDown | null;
  onAltDown: LinkPointer | null;
  onTrack: LinkPointer;
}) {
  const s = geo.shape;
  const w = geo.strokeW;
  const dash = linkDashed(s) ? `${w * 3} ${w * 2.4}` : undefined;
  const opacity = s.op != null && s.op < 1 ? s.op : undefined;
  return (
    <g className="nb-link" data-state={state || undefined} data-sel={selected || undefined} data-hl={highlighted || undefined}>
      <path
        className="nb-link-halo"
        d={geo.path.d}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth={w + 6 * k}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g mask={masked ? `url(#${maskIdOf(s.id)})` : undefined} opacity={opacity}>
        <path d={geo.path.d} fill="none" stroke={s.c} strokeWidth={w} strokeLinecap={dash ? "butt" : "round"} strokeLinejoin="round" strokeDasharray={dash} />
        {geo.head0 && <path d={geo.head0} fill={s.c} stroke={s.c} strokeWidth={w * 0.5} strokeLinejoin="round" />}
        {geo.head1 && <path d={geo.head1} fill={s.c} stroke={s.c} strokeWidth={w * 0.5} strokeLinejoin="round" />}
      </g>
      <path
        d={geo.path.d}
        data-draw-shape={s.id}
        fill="none"
        stroke="transparent"
        strokeWidth={Math.max(w + 8 * k, HIT_PX * k)}
        strokeLinecap="round"
        pointerEvents={interactive ? "stroke" : "none"}
        style={{ cursor: "pointer" }}
        onPointerEnter={(e) => { enterLink(s.id); onTrack(e, s.id); }}
        onPointerMove={(e) => onTrack(e, s.id)}
        onPointerLeave={leaveLink}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          // Alt-drag on a link branches it right there.
          if (e.altKey && onAltDown) { onAltDown(e, s.id); return; }
          e.stopPropagation();
          e.preventDefault();
          selectByPointer(e, s.id);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          const st = useBoard.getState();
          if (st.collabProjectId !== null && st.collabRole === "viewer") return;
          st.selectDrawShape(s.id);
          useLinkUi.getState().startEdit(s.id);
        }}
      />
      {geo.j0 && <JunctionDot linkId={s.id} end={1} at={geo.e0} color={s.c} w={w} k={k} interactive={interactive} onDown={onJunctionDown} />}
      {geo.j1 && <JunctionDot linkId={s.id} end={2} at={geo.e1} color={s.c} w={w} k={k} interactive={interactive} onDown={onJunctionDown} />}
    </g>
  );
});

// Label box (screen px) of a link, or null when it shows none.
function labelBox(geo: LinkGeo, editingLabel: string | null): { w: number; h: number } | null {
  if (geo.shape.id === editingLabel) return EDITOR_BOX;
  return geo.shape.text ? layoutOf(geo.shape.text, parseLabelStyle(geo.shape.fill)) : null;
}

// Where the branch dot of a link sits: its midpoint, or just right of its label.
function branchPoint(geo: LinkGeo, k: number, editingLabel: string | null, at: Pt): Pt {
  const box = labelBox(geo, editingLabel);
  if (!box) return at;
  return { x: at.x + (box.w / 2 + DOT_BESIDE_LABEL_PX) * k, y: at.y };
}

function LabelMasks({ geos, k, editingLabel, labelAt }: { geos: LinkGeo[]; k: number; editingLabel: string | null; labelAt: ReadonlyMap<string, Pt> }) {
  if (!geos.length) return null;
  return (
    <defs>
      {geos.map((g) => {
        const box = labelBox(g, editingLabel) ?? EDITOR_BOX;
        const bw = (box.w + 8) * k, bh = (box.h + 6) * k;
        const [a, b, c, d] = g.path.bbox;
        const pad = 40 * k;
        const at = labelAt.get(g.shape.id) ?? g.path.mid;
        return (
          <mask key={g.shape.id} id={maskIdOf(g.shape.id)} maskUnits="userSpaceOnUse" x={a - pad} y={b - pad} width={c - a + pad * 2} height={d - b + pad * 2}>
            <rect x={a - pad} y={b - pad} width={c - a + pad * 2} height={d - b + pad * 2} fill="white" />
            <rect x={at.x - bw / 2} y={at.y - bh / 2} width={bw} height={bh} rx={Math.min(bh / 2, 10 * k)} fill="black" />
          </mask>
        );
      })}
    </defs>
  );
}

function FocusOutlines({ items, k }: { items: BoardItem[]; k: number }) {
  return (
    <>
      {items.map((it) => (
        <div
          key={it.id}
          className="absolute"
          style={{
            left: it.x, top: it.y, width: it.w, height: it.h,
            transform: `rotate(${it.rotation || 0}deg)`,
            borderRadius: 6 * k,
            boxShadow: `0 0 0 ${1.25 * k}px color-mix(in srgb, var(--color-primary) 45%, transparent)`,
          }}
        />
      ))}
    </>
  );
}

export function LinkLayer({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  const { t } = useTranslation("reference");
  const view = useBoard((s) => s.view);
  const drawMode = useBoard((s) => s.drawMode);
  const drawSel = useBoard((s) => s.drawSel);
  const selectedIds = useBoard((s) => s.selectedIds);
  const editingId = useBoard((s) => s.editingId);
  const croppingId = useBoard((s) => s.croppingId);
  const noteOpenId = useBoard((s) => s.noteOpenId);
  const navigating = useBoard((s) => s.navigating);
  const linkFocus = useBoard((s) => s.prefs.linkFocus);
  const readOnly = useBoard((s) => s.collabProjectId !== null && s.collabRole === "viewer");
  const editingLabel = useLinkUi((s) => s.editing);
  const hoveredLink = useLinkUi((s) => s.hovered);

  const collapsed = useLinkUi((s) => s.collapsed);

  const k = chromePx(view.scale);
  const chrome = chromeVisible(view.scale);
  const scene = useLinkScene(k);

  // --- Collapsed subtrees (view only): their items are hidden by CSS, their links not drawn --------
  const hidden = useMemo(
    () => (collapsed.length ? collapsedHidden(scene.shapes, collapsed.filter((id) => scene.byId.has(id))) : EMPTY_IDS),
    [collapsed, scene.shapes, scene.byId],
  );
  const shown = useMemo(() => {
    if (!hidden.size) return scene.geos;
    const gone = new Set<string>();
    // Parents come first: a branch of a hidden link is hidden too.
    return scene.geos.filter((g) => {
      const a = g.shape.a1!.id, b = g.shape.a2!.id;
      const off = hidden.has(a) || hidden.has(b) || gone.has(a) || gone.has(b);
      if (off) gone.add(g.shape.id);
      return !off;
    });
  }, [scene.geos, hidden]);
  const shownById = useMemo(() => (shown === scene.geos ? scene.geoById : new Map(shown.map((g) => [g.shape.id, g]))), [shown, scene.geos, scene.geoById]);
  const hiddenCss = useMemo(() => {
    if (!hidden.size) return "";
    const sel = [...hidden].map((id) => `[data-board-item="${CSS.escape(id)}"]`).join(",");
    return `${sel}{visibility:hidden !important;pointer-events:none !important}`;
  }, [hidden]);

  const geoByIdRef = useRef(shownById);
  geoByIdRef.current = shownById;
  const gesture = useLinkGesture(containerRef, geoByIdRef);
  const { nearId, overId } = usePointerNear(containerRef, scene.byId);
  const pickRef = useRef<SVGPathElement>(null);
  const pickFrom = usePickMode(containerRef, pickRef);
  useCtrlDragLink(containerRef, gesture.start);
  const geosRef = useRef(shown);
  geosRef.current = shown;
  const insertCandidate = useInsertOnDrop(geosRef, !readOnly && !drawMode);

  // --- Neuron focus -----------------------------------------------------------------------------
  const focusId = linkFocus && !drawMode && selectedIds.length === 1 ? selectedIds[0] : null;
  const focus = useMemo(() => {
    if (!focusId) return null;
    const c = connectedIds(scene.shapes, focusId);
    return c.shapeIds.size ? c : null;
  }, [focusId, scene.shapes]);
  const hoverLinks = useMemo(() => (overId && overId !== focusId ? connectedIds(scene.shapes, overId).shapeIds : null), [overId, focusId, scene.shapes]);

  // --- Visible links ----------------------------------------------------------------------------
  const selSet = useMemo(() => new Set(drawSel), [drawSel]);
  const visible = useMemo(() => {
    const el = containerRef.current;
    const w = (el?.clientWidth || window.innerWidth) / view.scale;
    const h = (el?.clientHeight || window.innerHeight) / view.scale;
    const x = -view.tx / view.scale, y = -view.ty / view.scale;
    const x0 = x - w, y0 = y - h, x1 = x + w * 2, y1 = y + h * 2;
    return shown.filter((g) => {
      if (selSet.has(g.shape.id)) return true;
      const [a, b, c, d] = g.path.bbox;
      return a < x1 && c > x0 && b < y1 && d > y0;
    });
  }, [shown, view, selSet, containerRef]);

  const reattaching = gesture.active?.kind === "reattach" ? gesture.active.linkId : null;
  // Link a dragged end would attach to (a junction): lit like a drop target.
  const linkTarget = gesture.target?.kind === "link" ? gesture.target.id : null;
  const stateOf = (id: string): LinkState => {
    if (id === reattaching) return "ghost";
    if (id === insertCandidate || id === linkTarget) return "insert";
    if (!focus) return "";
    return focus.shapeIds.has(id) ? "lit" : "dim";
  };

  // Labels shown (and masked out of their path): text set, or being edited.
  const labelled = chrome ? visible.filter((g) => !!g.shape.text || g.shape.id === editingLabel) : [];
  // Each label at the middle of its path, slid to a free spot when an item would cover it.
  const labelAt = useMemo(() => {
    const m = new Map<string, Pt>();
    if (scene.live) return m;
    const items = [...scene.byId.values()];
    for (const g of labelled) {
      const box = labelBox(g, editingLabel);
      if (box) m.set(g.shape.id, labelPoint(g, box, k, items));
    }
    return m;
  }, [visible, chrome, scene.byId, scene.live, k, editingLabel]);

  // --- Handles ----------------------------------------------------------------------------------
  const selGeos = useMemo(() => {
    const out = drawSel.map((id) => shownById.get(id)).filter((g): g is LinkGeo => !!g);
    // A mixed selection (links and other strokes) is edited by the drawing tools, not here.
    return out.length === drawSel.length ? out : [];
  }, [drawSel, shownById]);
  const selGeo = selGeos.length === 1 ? selGeos[0] : null;
  const lastGeo = selGeos[selGeos.length - 1] ?? null;

  const calm = !drawMode && !readOnly && !scene.live && !navigating && chrome && !noteOpenId && !croppingId && !gesture.active && !gesture.drop && !pickFrom;
  const handleItem: BoardItem | null = useMemo(() => {
    if (!calm) return null;
    const id = nearId ?? (selectedIds.length === 1 && !selGeos.length ? selectedIds[0] : null);
    if (!id || id === editingId) return null;
    const it = scene.byId.get(id);
    if (!it || hidden.has(id) || !ANCHORABLE.has(it.kind) || !(it.w > 0) || !(it.h > 0) || it.loading) return null;
    return it;
  }, [calm, nearId, selectedIds, selGeos.length, editingId, scene.byId, hidden]);

  const branchGeo = calm ? (selGeo ?? (hoveredLink ? shownById.get(hoveredLink) ?? null : null)) : null;

  // --- Branch dot that follows the pointer along the hovered link -------------------------------
  const dotRef = useRef<HTMLButtonElement>(null);
  const track = useRef<{ id: string; t: number } | null>(null);
  const branchIdRef = useRef<string | null>(null);
  branchIdRef.current = branchGeo?.shape.id ?? null;
  const tAt = useCallback((e: { clientX: number; clientY: number }, geo: LinkGeo) => {
    const r = containerRef.current?.getBoundingClientRect();
    const w = screenToBoard(useBoard.getState().view, e.clientX - (r?.left ?? 0), e.clientY - (r?.top ?? 0));
    return clampT(projectOnPath(geo.path.pts, w.x, w.y).t);
  }, [containerRef]);
  const onTrack = useCallback((e: React.PointerEvent, id: string) => {
    const geo = geoByIdRef.current.get(id);
    if (!geo) return;
    const t = tAt(e, geo);
    track.current = { id, t };
    const el = dotRef.current;
    if (!el || branchIdRef.current !== id) return;
    const p = pointAt(geo.path.pts, t);
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
  }, [tAt]);
  const startGesture = gesture.start;
  const onAltDown = useCallback((e: React.PointerEvent, id: string) => {
    const geo = geoByIdRef.current.get(id);
    if (geo) startGesture(e, { kind: "branch", linkId: id, t: tAt(e, geo) });
  }, [startGesture, tAt]);
  const onJunctionDown = useCallback((e: GestureStartEvent, id: string, end: 1 | 2) => {
    const spec: LinkGestureSpec = { kind: "reattach", linkId: id, end };
    // A press without a drag selects the branch.
    startGesture(e, spec, () => useBoard.getState().selectDrawShape(id));
  }, [startGesture]);
  const branchAt = (geo: LinkGeo): Pt => {
    const tr = track.current;
    return tr && tr.id === geo.shape.id ? pointAt(geo.path.pts, tr.t) : branchPoint(geo, k, editingLabel, labelAt.get(geo.shape.id) ?? geo.path.mid);
  };
  const branchT = useCallback(() => {
    const tr = track.current;
    return tr && tr.id === branchIdRef.current ? tr.t : 0.5;
  }, []);

  // --- Collapse badges: the item under the pointer (when it leads somewhere), and every collapsed one
  const badgeOn = chrome && !drawMode && !navigating && !scene.live && !gesture.active && !pickFrom && !croppingId && !noteOpenId;
  const hoverBadgeId = badgeOn ? (nearId ?? (selectedIds.length === 1 && !selGeos.length ? selectedIds[0] : null)) : null;
  const badges = useMemo(() => {
    if (!badgeOn) return [];
    const ids = new Set(collapsed);
    if (hoverBadgeId) ids.add(hoverBadgeId);
    const out: { item: BoardItem; count: number; collapsed: boolean }[] = [];
    for (const id of ids) {
      const it = scene.byId.get(id);
      if (!it || hidden.has(id) || id === editingId || !(it.w > 0) || !(it.h > 0)) continue;
      const count = downstreamOf(scene.shapes, [id]).size;
      if (count) out.push({ item: it, count, collapsed: collapsed.includes(id) });
    }
    return out;
  }, [badgeOn, collapsed, hoverBadgeId, scene.byId, scene.shapes, hidden, editingId]);
  const showSelUi = selGeos.length > 0 && !drawMode && chrome && !navigating && !scene.live && !gesture.active && !readOnly;
  const reached = useMemo(
    () => (focus ? [...focus.itemIds].map((id) => scene.byId.get(id)).filter((it): it is BoardItem => !!it) : []),
    [focus, scene.byId],
  );
  const targetItem = gesture.target?.kind === "item" ? scene.byId.get(gesture.target.id) ?? null : null;

  const toolbarOffset = (geo: LinkGeo) => {
    const box = chrome ? labelBox(geo, editingLabel) : null;
    return box ? box.h / 2 + TOOLBAR_GAP_PX : TOOLBAR_GAP_BARE_PX;
  };
  const selIds = selGeos.map((g) => g.shape.id);
  const styleTag = (keys: string[]) => `link-style:${selIds.join(",")}:${keys.sort().join(",")}`;

  return (
    <div className={`pointer-events-none absolute inset-0 z-30 overflow-hidden${pickFrom ? " nb-link-picking" : ""}`}>
      <style>{LINK_CSS}</style>
      <div
        data-board-pan
        className="absolute left-0 top-0 origin-top-left will-change-transform"
        style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }}
      >
        <FocusOutlines items={reached} k={k} />

        {hiddenCss && <style>{hiddenCss}</style>}
        <svg className="absolute left-0 top-0 overflow-visible" width={1} height={1} style={{ pointerEvents: "none" }}>
          <LabelMasks geos={labelled} k={k} editingLabel={editingLabel} labelAt={labelAt} />
          {visible.map((g) => (
            <LinkPath
              key={g.shape.id}
              geo={g}
              k={k}
              state={stateOf(g.shape.id)}
              selected={selSet.has(g.shape.id)}
              highlighted={!!hoverLinks?.has(g.shape.id)}
              interactive={!drawMode && !pickFrom}
              masked={chrome && (!!g.shape.text || g.shape.id === editingLabel)}
              onJunctionDown={readOnly ? null : onJunctionDown}
              onAltDown={readOnly ? null : onAltDown}
              onTrack={onTrack}
            />
          ))}
          {(gesture.active || pickFrom) && (
            <path
              ref={gesture.active ? gesture.previewRef : pickRef}
              d=""
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth={2 * k}
              strokeLinecap="round"
              strokeDasharray={`${5 * k} ${4 * k}`}
            />
          )}
        </svg>

        {targetItem && gesture.target?.kind === "item" && <TargetHint item={targetItem} target={gesture.target} k={k} />}

        {handleItem && <ConnectHandles key={handleItem.id} item={handleItem} k={k} onStart={gesture.start} />}

        {labelled.map((g) => (
          <LinkLabel
            key={g.shape.id}
            shapeId={g.shape.id}
            text={g.shape.text ?? ""}
            fill={g.shape.fill}
            at={labelAt.get(g.shape.id) ?? g.path.mid}
            k={k}
            editing={g.shape.id === editingLabel && !readOnly}
            state={stateOf(g.shape.id) === "dim" ? "dim" : ""}
            placeholder={t("links.labelPlaceholder")}
          />
        ))}

        {branchGeo && branchGeo.shape.id !== editingLabel && (
          <BranchDot
            key={branchGeo.shape.id}
            linkId={branchGeo.shape.id}
            at={branchAt(branchGeo)}
            k={k}
            onStart={gesture.start}
            onHover={(inside) => (inside ? enterLink(branchGeo.shape.id) : leaveLink())}
            dotRef={dotRef}
            getT={branchT}
          />
        )}

        {badges.map((b) => (
          <CollapseBadge key={b.item.id} item={b.item} k={k} count={b.count} collapsed={b.collapsed} onToggle={() => toggleCollapse([b.item.id])} />
        ))}

        {showSelUi && selGeo && (
          <EndHandles linkId={selGeo.shape.id} e0={selGeo.e0} e1={selGeo.e1} k={k} onStart={gesture.start} />
        )}

        {showSelUi && lastGeo && lastGeo.shape.id !== editingLabel && (
          <div
            className="absolute"
            style={{
              left: lastGeo.path.mid.x,
              top: lastGeo.path.mid.y + toolbarOffset(lastGeo) * k,
              transform: `translate(-50%, 0) scale(${k})`,
              transformOrigin: "top center",
            }}
          >
            <LinkEditorMenu
              shapes={selGeos.map((g) => g.shape)}
              readOnly={readOnly}
              onPatch={(patch) => patchLinks(selIds, patch, styleTag(Object.keys(patch)))}
              onReverse={() => reverseLinks(selIds)}
              onEditLabel={selGeo ? () => useLinkUi.getState().startEdit(selGeo.shape.id) : null}
              onDelete={() => deleteLinks(selIds)}
            />
          </div>
        )}
      </div>

      {pickFrom && (
        <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-border bg-popover/95 px-3 py-1 text-xs text-muted-foreground shadow-sm">
          {t("links.pickHint")}
        </div>
      )}

      {gesture.drop && <LinkDropMenu drop={gesture.drop} onClose={() => gesture.setDrop(null)} />}
    </div>
  );
}

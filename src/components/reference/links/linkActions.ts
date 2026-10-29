// Store-level link commands shared by the shortcuts, the context menu and the links layer: linking
// a selection, selecting what is linked (around, downstream, upstream), removing links and
// branches, organising a group, inserting an item into a link, cycling through the links of an
// item, collapsing a subtree, and editing several links at once. Each
// command writes ONE history entry (the store groups every write of the same tick).

import i18n from "@/i18n";
import { useBoard } from "../useReferenceBoard";
import { uid, type BoardItem, type DrawShape } from "../referenceShared";
import type { BoardPrefs } from "../boardPrefs";
import {
  LABEL_FONT_PX, autoAnchor, centerOf, dashPatch, formatLabelStyle, headsPatch, isLink, makeLink, reverseShape, type LinkStyle,
} from "./model";
import {
  detachBranch, downstreamOf, linksOnLevel, mirrorJunctions, pruneLinks, removeShapes, upstreamOf,
} from "./junction";
import {
  chainPairs, componentOf, insertIntoLink, linksForPairs, linksOfItem, neighboursOf, organiseLayout, starPairs,
  type OrganiseMode,
} from "./graph";
import { drawShapesOf } from "./useLinkScene";
import { useLinkUi } from "./linkUi";

// Gap between organised items never below this (world units): a tree with no gap hides its links.
const ORGANISE_MIN_GAP = 24;
const RECENT_COLORS_MAX = 8;

type Store = ReturnType<typeof useBoard.getState>;

function shapesNow(): DrawShape[] {
  return drawShapesOf(useBoard.getState().items);
}

function levelItems(st: Store): BoardItem[] {
  return st.items.filter((it) => it.kind !== "draw" && it.w > 0 && it.h > 0);
}

function selectedItemIds(st: Store): string[] {
  const level = new Set(levelItems(st).map((it) => it.id));
  return st.selectedIds.filter((id) => level.has(id));
}

function notify(key: string, count?: number) {
  useBoard.getState().setNotice({ kind: "ok", text: i18n.t(`reference:${key}`, { count }) });
}

// Style of a new link, from Settings > Links.
export function linkDefaults(p: BoardPrefs): LinkStyle {
  return {
    c: p.linkColor,
    w: p.linkWidth,
    route: p.linkRoute,
    ...headsPatch(p.linkHeads),
    ...(p.linkDashed ? dashPatch(true) : {}),
    fill: formatLabelStyle({ font: p.linkLabelFont || undefined, size: p.linkLabelSize !== LABEL_FONT_PX ? p.linkLabelSize : undefined }),
  };
}

// A new link between two items, styled with the defaults.
export function newLinkBetween(st: Store, from: string, to: string): DrawShape {
  const a = st.items.find((it) => it.id === from), b = st.items.find((it) => it.id === to);
  const pa = a ? centerOf(a) : { x: 0, y: 0 }, pb = b ? centerOf(b) : pa;
  return makeLink(uid(), autoAnchor(from), autoAnchor(to), [pa.x, pa.y, pb.x, pb.y], linkDefaults(st.prefs));
}

function addLinks(pairs: [string, string][]): number {
  const st = useBoard.getState();
  const shapes = drawShapesOf(st.items);
  const added = linksForPairs(shapes, pairs, (a, b) => newLinkBetween(st, a, b));
  if (added.length) st.drawSetShapes([...shapes, ...added]);
  return added.length;
}

// L / Shift+L: the selection, in selection order, as a chain or as a star from the first item.
export function linkSelection(mode: "chain" | "star"): number {
  const ids = selectedItemIds(useBoard.getState());
  if (ids.length < 2) return 0;
  const n = addLinks(mode === "chain" ? chainPairs(ids) : starPairs(ids));
  if (n) notify("links.added", n);
  return n;
}

export function linkItemsTo(fromIds: readonly string[], targetId: string): number {
  return addLinks(fromIds.map((id) => [id, targetId] as [string, string]));
}

// "Link to…": the next click on an item links the selection to it.
export function startLinkPick(): boolean {
  const ids = selectedItemIds(useBoard.getState());
  if (!ids.length) return false;
  useLinkUi.getState().startPick(ids);
  return true;
}

export function selectLinked(ids: readonly string[]): void {
  if (!ids.length) return;
  const more = neighboursOf(shapesNow(), ids);
  useBoard.getState().selectMany([...ids, ...more]);
}

export function selectLinkGroup(ids: readonly string[]): void {
  if (!ids.length) return;
  useBoard.getState().selectMany([...componentOf(shapesNow(), ids)]);
}

// Downstream: the items the selection's links lead to, through junctions, all the way down.
export function selectDownstream(ids: readonly string[]): void {
  if (!ids.length) return;
  useBoard.getState().selectMany([...ids, ...downstreamOf(shapesNow(), ids)]);
}

// Upstream: the items that lead to the selection, all the way up.
export function selectUpstream(ids: readonly string[]): void {
  if (!ids.length) return;
  useBoard.getState().selectMany([...ids, ...upstreamOf(shapesNow(), ids)]);
}

// Items carried along when `itemId` is moved with "Move downstream items" on: its whole subtree.
export function subtreeCarry(itemId: string): string[] {
  const st = useBoard.getState();
  if (!st.prefs.linkMoveSubtree) return [];
  return [...downstreamOf(drawShapesOf(st.items), [itemId])].filter((id) => id !== itemId);
}

// Collapse / expand the subtree of items (view only, never saved or shared).
export function toggleCollapse(ids: readonly string[]): boolean {
  const shapes = shapesNow();
  const withKids = ids.filter((id) => downstreamOf(shapes, [id]).size > 0);
  if (!withKids.length) return false;
  useLinkUi.getState().toggleCollapsed(withKids);
  return true;
}

export function unlinkItems(ids: readonly string[]): number {
  const shapes = shapesNow();
  // Their branches are re-rooted or removed along with them.
  const kept = pruneLinks(shapes, new Set(ids));
  if (kept === shapes) return 0;
  useBoard.getState().drawSetShapes(kept);
  return shapes.length - kept.length;
}

// Organise the group linked to `rootId` around it. Sizes are kept; only positions change.
export function organiseLinks(rootId: string, mode: OrganiseMode): number {
  const st = useBoard.getState();
  const nodes = levelItems(st).map((it) => ({ id: it.id, x: it.x, y: it.y, w: it.w, h: it.h }));
  const gap = Math.max(ORGANISE_MIN_GAP, st.prefs.arrangeGap);
  const pos = organiseLayout(nodes, drawShapesOf(st.items), rootId, mode, gap);
  if (st.prefs.linkOrganise !== mode) st.setPrefs({ linkOrganise: mode });
  let moved = 0;
  for (const [id, p] of pos) {
    const it = st.items.find((x) => x.id === id);
    if (!it || (Math.abs(it.x - p.x) < 0.5 && Math.abs(it.y - p.y) < 0.5)) continue;
    st.updateItem(id, { x: p.x, y: p.y });
    moved++;
  }
  return moved;
}

// The item the selection organises around: the single selected item, else the first selected.
export function organiseSelection(mode?: OrganiseMode): number {
  const st = useBoard.getState();
  const root = selectedItemIds(st)[0];
  return root ? organiseLinks(root, mode ?? st.prefs.linkOrganise) : 0;
}

export function insertItemIntoLink(linkId: string, itemId: string): boolean {
  const next = insertIntoLink(shapesNow(), linkId, itemId, uid());
  if (!next) return false;
  useBoard.getState().drawSetShapes(next);
  return true;
}

// Tab / Shift+Tab: the selected item's links one after the other.
export function cycleLinks(step: 1 | -1): boolean {
  const st = useBoard.getState();
  const ui = useLinkUi.getState();
  const shapes = drawShapesOf(st.items);
  const level = new Set(levelItems(st).map((it) => it.id));
  const one = st.drawSel.length === 1 ? shapes.find((s) => s.id === st.drawSel[0]) : undefined;
  let pivot = selectedItemIds(st).length === 1 ? selectedItemIds(st)[0] : null;
  if (!pivot && one && isLink(one)) {
    const kept = ui.cyclePivot;
    pivot = kept && linksOfItem(shapes, kept).some((s) => s.id === one.id) ? kept : one.a1!.id;
  }
  if (!pivot) return false;
  const onLevel = linksOnLevel(shapes, level);
  const links = linksOfItem(shapes, pivot).filter((s) => onLevel.has(s.id));
  if (!links.length) return false;
  const at = one ? links.findIndex((s) => s.id === one.id) : -1;
  const next = links[at < 0 ? (step > 0 ? 0 : links.length - 1) : (at + step + links.length) % links.length];
  st.selectDrawShape(next.id);
  ui.setCyclePivot(pivot);
  return true;
}

export function patchLinks(ids: readonly string[], patch: Partial<DrawShape> | ((s: DrawShape) => DrawShape), tag?: string): void {
  const set = new Set(ids);
  const fn = typeof patch === "function" ? patch : (s: DrawShape) => ({ ...s, ...patch });
  const st = useBoard.getState();
  st.drawSetShapes(drawShapesOf(st.items).map((s) => (set.has(s.id) && isLink(s) ? fn(s) : s)), true, tag);
}

// Reverses links; the branches hanging from them keep their place on screen.
export function reverseLinks(ids: readonly string[]): void {
  const set = new Set(ids);
  const st = useBoard.getState();
  const flipped = drawShapesOf(st.items).map((s) => (set.has(s.id) && isLink(s) ? reverseShape(s) : s));
  st.drawSetShapes(mirrorJunctions(flipped, set));
}

// Deletes shapes; branches hanging from a deleted link are re-rooted on its items (or deleted).
export function deleteShapes(ids: readonly string[]): void {
  const st = useBoard.getState();
  const shapes = drawShapesOf(st.items);
  const next = removeShapes(shapes, new Set(ids));
  if (next !== shapes) st.drawSetShapes(next);
  st.selectDrawShape(null);
}

export function deleteLinks(ids: readonly string[]): void {
  deleteShapes(ids);
}

// Right-click on a junction: its branch end goes to the nearest item of the parent (or the branch
// is deleted when there is none).
export function detachBranchEnd(linkId: string, end: 1 | 2): void {
  const st = useBoard.getState();
  const shapes = drawShapesOf(st.items);
  const next = detachBranch(shapes, linkId, end);
  if (next !== shapes) st.drawSetShapes(next);
}

export function rememberLinkColor(color: string): void {
  const st = useBoard.getState();
  const list = st.prefs.linkRecentColors.filter((c) => c.toLowerCase() !== color.toLowerCase());
  st.setPrefs({ linkRecentColors: [color, ...list].slice(0, RECENT_COLORS_MAX) });
}

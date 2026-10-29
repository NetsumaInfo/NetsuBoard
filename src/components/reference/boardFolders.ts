// Folders: a frame folded into a card whose content lives one level down, as a sub-board of its own.
// The store keeps only the level on screen in `items` — every gesture, snap, culling pass and
// selection works on it unchanged — and parks every other level in `stash`. An item's `parent` is
// written when it is parked and read when its level is opened again; the scene that is saved is
// always the union of both, normalised here.

import { frameContentIds, geomBox, FRAME_PAD, FRAME_TOP, type Rect } from "./boardFrames";
import type { BoardItem } from "./referenceShared";

export const FOLDER_W = 260;
export const FOLDER_H = 220;

// Nesting guard: a parent chain longer than this can only be a cycle from a damaged file.
const MAX_DEPTH = 64;

const parentOf = (it: BoardItem): string | null => it.parent ?? null;

function stripParent(it: BoardItem): BoardItem {
  if (it.parent === undefined) return it;
  const { parent: _parent, ...rest } = it;
  return rest;
}

// Items of the level on screen, tagged with that level before they are parked or saved.
export function tagLevel(items: BoardItem[], folderId: string | null): BoardItem[] {
  return items.map((it) => {
    if (parentOf(it) === folderId) return it;
    return folderId ? { ...it, parent: folderId } : stripParent(it);
  });
}

// Every item of the scene, whatever level it lives on. An item whose folder is gone (the card was
// deleted) is dropped: it has no level left to be shown on.
export function sceneItems(items: BoardItem[], stash: BoardItem[], folderId: string | null): BoardItem[] {
  const all = stash.length ? [...tagLevel(items, folderId), ...stash] : tagLevel(items, folderId);
  return stash.length ? dropOrphans(all) : all;
}

function dropOrphans(all: BoardItem[]): BoardItem[] {
  const folders = new Map(all.filter((it) => it.kind === "frame" && it.folder).map((it) => [it.id, it]));
  const reachable = (it: BoardItem): boolean => {
    let p = parentOf(it);
    for (let depth = 0; p; depth++) {
      const f = folders.get(p);
      if (!f || depth > MAX_DEPTH) return false;
      p = parentOf(f);
    }
    return true;
  };
  return all.filter(reachable);
}

// Splits a loaded scene into the level to show and the parked rest. An item pointing to a folder
// that does not exist comes back to the top level instead of being lost.
export function splitLevel(all: BoardItem[], folderId: string | null): { items: BoardItem[]; stash: BoardItem[] } {
  const folders = new Set(all.filter((it) => it.kind === "frame" && it.folder).map((it) => it.id));
  const items: BoardItem[] = [];
  const stash: BoardItem[] = [];
  for (const it of all) {
    const raw = parentOf(it);
    const p = raw && !folders.has(raw) ? null : raw;
    if (p === folderId) items.push(stripParent(it));
    else stash.push(p === raw ? it : stripParent(it));
  }
  return { items, stash };
}

// Folds a frame of the level on screen: its linked content is parked under it and the frame
// shrinks to a card at its top-left corner.
export function foldFrame(frame: BoardItem, items: BoardItem[], stash: BoardItem[]) {
  const ids = new Set(frameContentIds(frame, items));
  const moved: BoardItem[] = [];
  const kept: BoardItem[] = [];
  for (const it of items) {
    if (ids.has(it.id)) moved.push({ ...it, parent: frame.id });
    else if (it.id === frame.id) {
      kept.push({ ...it, folder: true, openW: it.w, openH: it.h, w: FOLDER_W, h: FOLDER_H });
    } else kept.push(it);
  }
  return { items: kept, stash: [...stash, ...moved] };
}

// Unfolds a folder card of the level on screen: its children come back up and the frame wraps
// them again (or takes back its old size when the folder is empty).
export function unfoldFrame(frame: BoardItem, items: BoardItem[], stash: BoardItem[]) {
  const back: BoardItem[] = [];
  const rest: BoardItem[] = [];
  for (const it of stash) {
    if (it.parent === frame.id) back.push(stripParent(it));
    else rest.push(it);
  }
  let box: Rect | null = null;
  for (const it of back) {
    if (it.kind === "draw") continue;
    const b = geomBox(it);
    box = box ? union(box, b) : b;
  }
  const geom = box
    ? { x: box.x - FRAME_PAD, y: box.y - FRAME_TOP, w: box.w + FRAME_PAD * 2, h: box.h + FRAME_PAD + FRAME_TOP }
    : { x: frame.x, y: frame.y, w: frame.openW ?? 640, h: frame.openH ?? 420 };
  const unfolded: BoardItem = { ...frame, ...geom, rotation: 0 };
  delete unfolded.folder;
  delete unfolded.openW;
  delete unfolded.openH;
  delete unfolded.cover;
  // Each level has one drawing layer: the folder's strokes join the layer of this level.
  const shapes = back.flatMap((it) => (it.kind === "draw" ? it.shapes ?? [] : []));
  const up = back.filter((it) => it.kind !== "draw");
  let next = [...items.map((it) => (it.id === frame.id ? unfolded : it)), ...up];
  if (shapes.length) {
    const layer = next.find((it) => it.kind === "draw");
    const folderLayer = back.find((it) => it.kind === "draw")!;
    next = layer
      ? next.map((it) => (it === layer ? { ...it, shapes: [...(it.shapes ?? []), ...shapes] } : it))
      : [...next, { ...folderLayer, shapes }];
  }
  return { items: next, stash: rest };
}

// Moves items of the level on screen into a folder card of the same level.
export function parkInto(folderId: string, ids: string[], items: BoardItem[], stash: BoardItem[]) {
  const set = new Set(ids);
  set.delete(folderId);
  const moved = items.filter((it) => set.has(it.id) && it.kind !== "draw").map((it) => ({ ...it, parent: folderId }));
  if (!moved.length) return null;
  const movedIds = new Set(moved.map((it) => it.id));
  return { items: items.filter((it) => !movedIds.has(it.id)), stash: [...stash, ...moved] };
}

// Opens another level: `from` is the level on screen, `to` the one to show.
export function switchLevel(items: BoardItem[], stash: BoardItem[], from: string | null, to: string | null) {
  return splitLevel(sceneItems(items, stash, from), to);
}

// Children of a folder, in paint order.
export function folderChildren(folderId: string, stash: BoardItem[]): BoardItem[] {
  return stash.filter((it) => it.parent === folderId && it.kind !== "draw").sort((a, b) => a.z - b.z);
}

// Item shown on the card: the chosen cover while it is still in the folder, else the first image.
export function folderCover(folder: BoardItem, children: BoardItem[]): BoardItem | null {
  const visual = (it: BoardItem) => it.kind === "image" && !!it.src && !it.missing;
  const chosen = folder.cover ? children.find((it) => it.id === folder.cover && visual(it)) : undefined;
  return chosen ?? children.find(visual) ?? null;
}

// First images of a folder, for the 2×2 mosaic cover.
export function folderMosaic(children: BoardItem[]): string[] {
  return children.filter((it) => it.kind === "image" && !!it.src && !it.missing).slice(0, 4).map((it) => it.src);
}

// Cover of the folder on screen, read from inside it (its children are the level on screen).
export function openFolderCoverId(st: { items: BoardItem[]; stash: BoardItem[]; folderPath: { id: string }[] }): string | null {
  if (!st.folderPath.length) return null;
  const id = st.folderPath[st.folderPath.length - 1].id;
  const folder = st.stash.find((it) => it.id === id);
  return folder ? folderCover(folder, st.items)?.id ?? null : null;
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

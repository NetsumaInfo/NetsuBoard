// Copying mood board items into the open Animatic, by click or by drag and drop. A drag carries
// the ids of the mood board items; the drop copies them, keeping their layout around the drop point.

import { useBoard } from "../useReferenceBoard";
import { topZ, uid, type BoardItem } from "../referenceShared";
import { MIN_SHOT, beatsToSeconds, boundsOfBoxes, pruneClip, shotFromItems, toLong, type ClipData } from "./clipModel";
import { openClipId, openClipRaw, readClip } from "./clipSelectors";
import { frameCamera, seek, viewCentre } from "./clipPlayer";

export const ANIMATIC_MIME = "application/x-netsu-animatic";

// Items of the level the open Animatic sits on. The top level's items carry no `parent`.
export function parentLevelItems(s: { stash: BoardItem[]; folderPath: { id: string }[] }): BoardItem[] {
  const parent = s.folderPath.length >= 2 ? s.folderPath[s.folderPath.length - 2].id : null;
  return s.stash.filter((it) => (it.parent ?? null) === parent && it.kind !== "draw" && !it.folder);
}

// Copies mood board items into the Animatic, their group centred on `at` (board coordinates).
// They join the shot under the playhead on their own (clipPlayer adoptNewItems).
export function copyIntoAnimatic(ids: string[], at?: { x: number; y: number }): string[] {
  const s = useBoard.getState();
  const byId = new Map(parentLevelItems(s).map((it) => [it.id, it]));
  const src = ids.map((id) => byId.get(id)).filter((it): it is BoardItem => !!it);
  const box = boundsOfBoxes(src.map((it) => ({ x: it.x, y: it.y, w: it.w, h: it.h })));
  if (!box) return [];
  const c = at ?? viewCentre();
  const dx = c.x - (box.x + box.w / 2), dy = c.y - (box.y + box.h / 2);
  let z = topZ(s.items);
  const copies = src.map(({ parent: _p, ...it }) => ({ ...it, id: uid(), x: it.x + dx, y: it.y + dy, z: ++z }));
  return s.addItems(copies);
}

export function readDrag(dt: DataTransfer): string[] | null {
  if (!dt.types.includes(ANIMATIC_MIME)) return null;
  try {
    const ids = JSON.parse(dt.getData(ANIMATIC_MIME));
    return Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : null;
  } catch { return null; }
}

export const isAnimaticDrag = (dt: DataTransfer) => dt.types.includes(ANIMATIC_MIME);

// Dropped on a shot of the timeline: the copies go into that shot.
export function dropOnShot(ids: string[], shotStart: number) {
  seek(shotStart + 0.001);
  copyIntoAnimatic(ids);
}

// Dropped on the Long lane: the copies span the whole track.
export function dropOnLong(ids: string[]) {
  const added = copyIntoAnimatic(ids);
  const s = useBoard.getState();
  const clipId = openClipId(s);
  const clip = readClip(openClipRaw(s));
  if (clipId && clip && added.length) s.patchClip(clipId, toLong(clip, added), { record: false });
}

// Length of a shot made by a drop: one bar of the music's tempo, else two seconds.
export function dropShotLength(clip: ClipData): number {
  const bar = beatsToSeconds(clip, 4);
  return bar && bar >= MIN_SHOT ? bar : 2;
}

// Items of the open Animatic shown in a new shot starting at t (dropped on the shots lane); the
// playhead goes there and the board frames it.
export function itemsToShot(ids: string[], t: number) {
  const s = useBoard.getState();
  const clipId = openClipId(s);
  const clip = readClip(openClipRaw(s));
  const byId = new Map(s.items.map((it) => [it.id, it]));
  const placed = ids.filter((id) => byId.has(id));
  if (!clipId || !clip || !placed.length) return;
  const boxes = placed.map((id) => { const it = byId.get(id)!; return { x: it.x, y: it.y, w: it.w, h: it.h }; });
  const { clip: next, index } = shotFromItems(clip, t, placed, boxes, dropShotLength(clip));
  if (next === clip) return;
  s.patchClip(clipId, next);
  seek(next.shots[index].start + 0.001);
  frameCamera();
}

// Mood board items dropped on the shots lane: copied in, then shown in a new shot of their own
// (not also in the shot under the playhead, which new items otherwise join).
export function dropAsShot(ids: string[], t: number) {
  const added = copyIntoAnimatic(ids);
  if (!added.length) return;
  const s = useBoard.getState();
  const clipId = openClipId(s);
  const clip = readClip(openClipRaw(s));
  if (!clipId || !clip) return;
  const fresh = new Set(added);
  s.patchClip(clipId, pruneClip(clip, new Set(s.items.map((it) => it.id).filter((id) => !fresh.has(id)))), { record: false });
  itemsToShot(added, t);
}

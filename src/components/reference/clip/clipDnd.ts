// Copying mood board items into the open Animatic, by click or by drag and drop. A drag carries
// the ids of the mood board items; the drop copies them, keeping their layout around the drop point.

import { useBoard } from "../useReferenceBoard";
import { topZ, uid, type BoardItem } from "../referenceShared";
import { boundsOfBoxes, toLong } from "./clipModel";
import { openClipId, openClipRaw, readClip } from "./clipSelectors";
import { seek, viewCentre } from "./clipPlayer";

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

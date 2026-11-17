// Copy and paste of a shot, within an Animatic or into another one. The copy holds the shot and
// copies of its items (media stay where they are on disk: only `ref` travels). Pasting adds new
// copies of those items to the open Animatic, where they were on the board, and puts the shot at
// the playhead for its length.

import { create } from "zustand";
import { useBoard } from "../useReferenceBoard";
import { topZ, uid, type BoardItem } from "../referenceShared";
import { copyShotPiece, pasteShotPiece, type ShotPiece } from "./clipModel";
import { openClipId, openClipRaw, readClip } from "./clipSelectors";
import { seek, useClipPlayer } from "./clipPlayer";

interface Copied { piece: ShotPiece; items: BoardItem[]; name: string }

// Kept in memory for the session: the board's own clipboard holds items, not shots.
export const useShotClipboard = create<{ copied: Copied | null }>(() => ({ copied: null }));

export function copyShot(index: number, name: string): boolean {
  const s = useBoard.getState();
  const clip = readClip(openClipRaw(s));
  const piece = clip ? copyShotPiece(clip, index) : null;
  if (!piece) return false;
  const ids = new Set(piece.shot.items.map((si) => si.id));
  const items = s.items.filter((it) => ids.has(it.id)).map(({ parent: _p, ...it }) => ({ ...it }));
  useShotClipboard.setState({ copied: { piece, items, name } });
  return true;
}

export function pasteShot(): boolean {
  const copied = useShotClipboard.getState().copied;
  const s = useBoard.getState();
  const clipId = openClipId(s);
  const clip = readClip(openClipRaw(s));
  if (!copied || !clipId || !clip) return false;
  const ids = new Map<string, string>();
  let z = topZ(s.items);
  const copies = copied.items.map((it) => {
    const id = uid();
    ids.set(it.id, id);
    return { ...it, id, z: ++z };
  });
  const at = useClipPlayer.getState().time;
  const next = pasteShotPiece(clip, at, copied.piece, ids);
  // One undo step: the items are added (recorded), the timeline follows without its own entry.
  if (copies.length) s.addItems(copies, false);
  useBoard.getState().patchClip(clipId, next, { record: !copies.length });
  const i = next.shots.findIndex((sh) => sh.items.some((si) => si.id === copies[0]?.id));
  if (i >= 0) seek(next.shots[i].start + 0.001);
  return true;
}

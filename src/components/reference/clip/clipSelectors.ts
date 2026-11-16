// Which clip is open, read from the board store. The clip card of the level on screen is parked one
// level up (in `stash`), like any open folder.

import type { BoardItem } from "../referenceShared";
import { normalizeClip, type ClipData } from "./clipModel";

type Level = { items: BoardItem[]; stash: BoardItem[]; folderPath: { id: string }[] };

export function openClipId(s: Level): string | null {
  const id = s.folderPath.length ? s.folderPath[s.folderPath.length - 1].id : null;
  if (!id) return null;
  return s.stash.some((it) => it.id === id && it.clip) ? id : null;
}

export function openClipCard(s: Level): BoardItem | null {
  const id = openClipId(s);
  return id ? s.stash.find((it) => it.id === id) ?? null : null;
}

// Raw clip data of the open clip (stable identity while unchanged; normalise with `useMemo`).
export function openClipRaw(s: Level): ClipData | null {
  return openClipCard(s)?.clip ?? null;
}

const cache = new WeakMap<object, ClipData | null>();
export function readClip(raw: ClipData | null | undefined): ClipData | null {
  if (!raw) return null;
  if (cache.has(raw)) return cache.get(raw)!;
  const n = normalizeClip(raw);
  cache.set(raw, n);
  return n;
}

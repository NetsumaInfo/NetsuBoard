// Thumbnails of what the camera sees in a shot: the board area of its framing at the shot's middle,
// with the items present then. Rendered off screen by the board's canvas painter, one at a time,
// cached by what they show, so the storyboard and the card never slow the board down.

import { useEffect, useState } from "react";
import type { BoardItem } from "../referenceShared";
import { renderBoardCanvas } from "../boardRender";
import { cameraAt, presentAt, shotEnd, type ClipData } from "./clipModel";

const cache = new Map<string, string>();
let queue: Promise<unknown> = Promise.resolve();

function signature(clip: ClipData, index: number, items: BoardItem[]) {
  const s = clip.shots[index];
  const mid = (s.start + shotEnd(clip, index)) / 2;
  const present = presentAt(clip, mid);
  const shown = items.filter((it) => present.has(it.id));
  const cam = cameraAt(clip, mid);
  const key = JSON.stringify([
    Math.round(cam.x), Math.round(cam.y), Math.round(cam.w),
    shown.map((it) => [it.id, Math.round(it.x), Math.round(it.y), Math.round(it.w), Math.round(it.h), it.src, it.text, it.opacity, it.z]),
  ]);
  return { key, shown, cam };
}

export function useShotThumb(clip: ClipData | null, index: number, items: BoardItem[], width = 240, background = "#111"): string | null {
  const sig = clip && clip.shots[index] ? signature(clip, index, items) : null;
  const key = sig ? `${width}|${background}|${sig.key}` : "";
  const [url, setUrl] = useState<string | null>(() => (key ? cache.get(key) ?? null : null));
  useEffect(() => {
    if (!sig || !key) { setUrl(null); return; }
    const hit = cache.get(key);
    if (hit) { setUrl(hit); return; }
    let alive = true;
    // Debounced and queued: a drag on the board changes the key at every frame.
    const timer = setTimeout(() => {
      queue = queue.then(async () => {
        if (!alive) return;
        try {
          const canvas = await renderBoardCanvas(sig.shown, { rect: sig.cam, width, background, shapes: false });
          const data = canvas.toDataURL("image/jpeg", 0.75);
          cache.set(key, data);
          if (cache.size > 300) cache.delete(cache.keys().next().value!);
          if (alive) setUrl(data);
        } catch { /* a media that cannot be read: the card keeps its placeholder */ }
      });
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
    // `sig` is derived from `key`; the key is what decides a new render.
  }, [key, width, background]);
  return url;
}

// Animatic → MP4. Every frame is painted here, the way Present shows it: the camera framing at that
// time, the items present with their appearance (fade, zoom, slide), the videos at the frame they
// play, the pinned Long items on top. Frames go to the core as JPEG, which encodes them with the
// music and the sound of the videos (core/animaticExport.js).
//
// Items that do not move are painted once, at the sharpness the tightest framing needs, then only
// placed; a video is seeked frame by frame. Both are made when the item first shows and let go
// after its last appearance, so memory follows what is on screen, not the size of the board.
// Image sequences, GIFs, YouTube and embed cards come out as their still picture.

import { nr, type AnimaticSoundPiece } from "@/lib/bridge";
import { useBoard } from "../useReferenceBoard";
import { isCoreFileRef, type BoardItem } from "../referenceShared";
import { paintItemSource, readableMediaUrl, renderBoardCanvas, visibleItems } from "../boardRender";
import { FX_DUR_MAX, cameraAt, clipDuration, viewForRect, type ClipData, type LongItem } from "./clipModel";
import {
  duckSpans, frameCount, itemSpans, lookAcross, narrowestCamera, pinRect, soundPieces, videoTimeAt,
  MAX_SOUND_PIECES, type VideoMode,
} from "./exportPlan";

export interface AnimaticExportSettings {
  out: string;
  width: number;
  height: number;
  fps: number;
  background: string;
}

export interface AnimaticExportProgress {
  phase: "prepare" | "frames" | "finish";
  done: number;
  total: number;
}

export type AnimaticExportResult =
  | { ok: true; path: string; bytes: number }
  | { ok: false; cancelled?: boolean; error?: string };

interface VideoSource {
  el: HTMLVideoElement;
  // Where the item's range starts inside `el` (0 for a proxy cut to the range).
  offset: number;
  len: number;
  speed: number;
  mode: VideoMode;
  // Seeks in a row whose frame never came.
  misses: number;
}

interface Layer {
  item: BoardItem;
  spans: [number, number][];
  pin?: LongItem["pin"];
  // Width the item reaches on the output, at the tightest framing: the sharpness it is painted at.
  screenW: number;
  // Past this time the item never shows again: its picture is let go.
  until: number;
  // Length of the video range, when its sound is mixed in (known before the export starts).
  soundLen?: number;
  // Picture made when the item first shows (one at a time in memory, not the whole board).
  ready: boolean;
  still?: { canvas: HTMLCanvasElement; box: { x: number; y: number; w: number; h: number } };
  video?: VideoSource;
}

const MAX_BITMAP = 4096;
const BATCH = 6;
const JPEG_QUALITY = 0.92;
const SEEK_TIMEOUT_MS = 4000;

// Box of the item once rotated, in board coordinates.
function rotatedBox(it: BoardItem): { x: number; y: number; w: number; h: number } {
  const a = ((it.rotation ?? 0) * Math.PI) / 180;
  if (!a) return { x: it.x, y: it.y, w: it.w, h: it.h };
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const w = it.w * c + it.h * s, h = it.w * s + it.h * c;
  return { x: it.x + it.w / 2 - w / 2, y: it.y + it.h / 2 - h / 2, w, h };
}

function videoMode(clip: ClipData, item: BoardItem): VideoMode {
  const v = clip.videos[item.id];
  if (v?.frozen || item.playMode === "off") return "frozen";
  return v?.loop ?? item.playMode ?? "loop";
}

function waitFor(el: HTMLVideoElement, event: "loadeddata" | "seeked", ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      el.removeEventListener(event, onOk);
      el.removeEventListener("error", onErr);
      resolve(ok);
    };
    const onOk = () => done(true);
    const onErr = () => done(false);
    const timer = setTimeout(() => done(false), ms);
    el.addEventListener(event, onOk);
    el.addEventListener("error", onErr);
  });
}

// A playable copy of the item's range: the core cuts it to MP4 (any container, a trimmed range),
// else the file itself when the webview reads it.
async function openVideo(clip: ClipData, item: BoardItem, height: number): Promise<VideoSource | null> {
  if (!isCoreFileRef(item.ref)) return null;
  const start = item.trimIn && item.trimIn > 0 ? item.trimIn : 0;
  const end = item.trimOut != null && item.trimOut > start ? item.trimOut : item.dur && item.dur > start ? item.dur : null;
  let src = "";
  let offset = start;
  if (end != null && nr.proxy) {
    const r = await nr.proxy({ input: item.ref, start, end, priority: "high", height, requireVideo: true }).catch(() => null);
    if (r?.ok && r.path) { src = readableMediaUrl(r.path); offset = 0; }
  }
  if (!src) src = readableMediaUrl(item.ref);
  if (!src) return null;
  const el = document.createElement("video");
  el.crossOrigin = "anonymous";
  el.muted = true;
  el.preload = "auto";
  el.playsInline = true;
  el.src = src;
  const loaded = await waitFor(el, "loadeddata", 15000);
  const len = end != null ? end - start : (el.duration || 0) - offset;
  if (!loaded || !el.videoWidth || !(len > 0)) {
    freeVideo(el);
    return null;
  }
  const speed = clip.videos[item.id]?.speed ?? 1;
  return { el, offset, len, speed: speed > 0 ? speed : 1, mode: videoMode(clip, item), misses: 0 };
}

function freeVideo(el: HTMLVideoElement) {
  el.removeAttribute("src");
  el.load();
}

// False when the frame did not come (decoder stuck, file gone): the caller stops trusting the video.
async function seekTo(v: VideoSource, at: number): Promise<boolean> {
  const target = v.offset + at;
  if (Math.abs(v.el.currentTime - target) < 0.0005) return true;
  const seeked = waitFor(v.el, "seeked", SEEK_TIMEOUT_MS);
  v.el.currentTime = target;
  return seeked;
}

// Pixel budget of one still: a tall note on a tight framing would otherwise ask for a canvas the
// browser refuses (it comes out blank) or holds hundreds of megabytes.
const MAX_STILL_PIXELS = 16_000_000;
const MAX_STILL_SIDE = 8192;

async function stillOf(items: BoardItem[], item: BoardItem, pxWidth: number, pinned: boolean): Promise<Layer["still"]> {
  const flat = pinned ? { ...item, rotation: 0 } : item;
  const box = rotatedBox(flat);
  const aspect = box.h / Math.max(1e-6, box.w);
  let w = Math.min(MAX_BITMAP, pxWidth);
  w = Math.min(w, MAX_STILL_SIDE / Math.max(aspect, 1e-6), Math.sqrt(MAX_STILL_PIXELS / Math.max(aspect, 1e-6)));
  const width = Math.max(8, Math.round(w));
  const canvas = await renderBoardCanvas(pinned ? [flat] : items, {
    only: new Set([item.id]), rect: box, width, background: null, shapes: false,
  });
  return { canvas, box };
}

const plays = (clip: ClipData, item: BoardItem) => item.kind === "video" && isCoreFileRef(item.ref) && videoMode(clip, item) !== "frozen";
const rangeStart = (item: BoardItem) => (item.trimIn && item.trimIn > 0 ? item.trimIn : 0);

// What each item needs, without painting anything yet. Only a video whose sound is mixed in is
// measured now: the audio is planned before the first frame.
async function planLayers(
  clip: ClipData,
  items: BoardItem[],
  W: number,
  H: number,
  onStep: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<Layer[]> {
  const pins = new Map(clip.long.filter((l) => l.pin).map((l) => [l.id, l.pin!]));
  const wanted = visibleItems(items).map((item) => ({ item, spans: itemSpans(clip, item.id) })).filter((w) => w.spans.length);
  const layers: Layer[] = [];
  for (let i = 0; i < wanted.length; i++) {
    if (signal.aborted) break;
    const { item, spans } = wanted[i];
    const pin = pins.get(item.id);
    const screenW = pin ? pinRect(pin.corner, pin.size, item.w / Math.max(1, item.h), W, H).w : rotatedBox(item).w * (W / narrowestCamera(clip, spans));
    const layer: Layer = { item, spans, pin, screenW, until: spans[spans.length - 1][1] + FX_DUR_MAX + 0.1, ready: false };
    if (plays(clip, item) && clip.videos[item.id]?.sound) {
      const start = rangeStart(item);
      let end = item.trimOut != null && item.trimOut > start ? item.trimOut : item.dur && item.dur > start ? item.dur : 0;
      if (!end) end = (await nr.reference?.playInfo(item.ref).catch(() => null))?.duration ?? 0;
      if (end > start) layer.soundLen = end - start;
    }
    layers.push(layer);
    onStep(i + 1, wanted.length);
  }
  return layers;
}

// The item's picture, made the first time it shows: a playing video, else a still painted once.
async function load(clip: ClipData, items: BoardItem[], l: Layer): Promise<void> {
  l.ready = true;
  if (plays(clip, l.item)) {
    const h = Math.min(2160, Math.max(240, Math.ceil(((l.screenW * l.item.h) / Math.max(1, l.item.w)) / 240) * 240));
    l.video = (await openVideo(clip, l.item, h)) ?? undefined;
  }
  if (!l.video) l.still = await stillOf(items, l.item, l.screenW, !!l.pin);
}

function unload(l: Layer) {
  if (l.video) freeVideo(l.video.el);
  if (l.still) l.still.canvas.width = l.still.canvas.height = 0;
  l.video = undefined;
  l.still = undefined;
}

function planAudio(clip: ClipData, layers: Layer[]): { music: { path: string; duck: [number, number][] } | null; sounds: AnimaticSoundPiece[] } {
  const sounds: AnimaticSoundPiece[] = [];
  const heard: [number, number][] = [];
  for (const l of layers) {
    if (!l.soundLen) continue;
    const speed = clip.videos[l.item.id]?.speed ?? 1;
    for (const span of l.spans) {
      const pieces = soundPieces({
        path: l.item.ref,
        in: rangeStart(l.item),
        len: l.soundLen,
        speed: speed > 0 ? speed : 1,
        mode: videoMode(clip, l.item),
        span,
      });
      if (!pieces.length) continue;
      heard.push(span);
      sounds.push(...pieces);
    }
  }
  const ref = clip.music?.ref;
  const music = ref && isCoreFileRef(ref) ? { path: ref, duck: duckSpans(heard) } : null;
  return { music, sounds: sounds.slice(0, MAX_SOUND_PIECES) };
}

function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, r: { x: number; y: number; w: number; h: number }) {
  const k = Math.max(r.w / sw, r.h / sh);
  const cw = r.w / k, ch = r.h / k;
  ctx.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, r.x, r.y, r.w, r.h);
}

async function paintFrame(ctx: CanvasRenderingContext2D, clip: ClipData, items: BoardItem[], layers: Layer[], t: number, W: number, H: number, background: string) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, W, H);
  const view = viewForRect(cameraAt(clip, t), W, H);

  const shown = layers.map((l) => ({ l, at: lookAcross(clip, l.item.id, l.spans, t, !!l.pin) }));
  for (const { l, at } of shown) {
    if (at && !l.ready) await load(clip, items, l);
    else if (!at && l.ready && t > l.until) unload(l);
  }

  // Videos first, all seeks of the frame at once. Each stretch on screen plays from the start of
  // the range, and a video leaving holds its last frame (the live board pauses it).
  // A video whose frames stop coming (three seeks in a row) is painted still from then on, rather
  // than waiting on it at every frame for a picture that does not move.
  await Promise.all(shown.map(async ({ l, at }) => {
    const v = l.video;
    if (!v || !at) return;
    const [a, b] = at.span;
    const local = Math.max(0, Math.min(t, b) - a) * v.speed;
    v.misses = (await seekTo(v, videoTimeAt(local, v.len, v.mode))) ? 0 : v.misses + 1;
    if (v.misses >= 3) {
      freeVideo(v.el);
      l.video = undefined;
      l.still = await stillOf(items, l.item, l.screenW, !!l.pin);
    }
  }));

  for (const { l, at } of shown) {
    if (l.pin || !at) continue;
    const { look } = at;
    const it = l.item;
    ctx.save();
    ctx.setTransform(view.scale, 0, 0, view.scale, view.tx, view.ty);
    ctx.globalAlpha = look.alpha;
    // The effect moves the item in its own frame, as the CSS on its inner layer does: the slide
    // follows the item's rotation, the zoom is centred on it.
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    const rot = ((it.rotation ?? 0) * Math.PI) / 180;
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.translate(0, look.dy * it.h);
    ctx.scale(look.scale, look.scale);
    ctx.rotate(-rot);
    ctx.translate(-cx, -cy);
    if (l.video) paintItemSource(ctx, it, l.video.el);
    else if (l.still) ctx.drawImage(l.still.canvas, l.still.box.x, l.still.box.y, l.still.box.w, l.still.box.h);
    ctx.restore();
  }

  for (const { l, at } of shown) {
    if (!l.pin || !at) continue;
    const { look } = at;
    const r = pinRect(l.pin.corner, l.pin.size, l.item.w / Math.max(1, l.item.h), W, H);
    ctx.save();
    ctx.globalAlpha = look.alpha;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, Math.max(4, W * 0.004));
    ctx.clip();
    if (l.video) {
      ctx.globalAlpha *= l.item.opacity ?? 1;
      drawCover(ctx, l.video.el, l.video.el.videoWidth, l.video.el.videoHeight, r);
    } else if (l.still) ctx.drawImage(l.still.canvas, r.x, r.y, r.w, r.h);
    ctx.restore();
  }
}

const jpegBase64 = (canvas: HTMLCanvasElement) => {
  const url = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  return url.slice(url.indexOf(",") + 1);
};

function release(layers: Layer[]) {
  for (const l of layers) {
    unload(l);
    l.ready = false;
  }
}

async function encode(
  clip: ClipData,
  items: BoardItem[],
  layers: Layer[],
  s: AnimaticExportSettings,
  cpu: boolean,
  onProgress: (p: AnimaticExportProgress) => void,
  signal: AbortSignal,
): Promise<AnimaticExportResult & { hardware?: boolean }> {
  const api = nr.reference!;
  const { music, sounds } = planAudio(clip, layers);
  const duration = clipDuration(clip);
  const started = await api.animaticExportStart({ out: s.out, fps: s.fps, width: s.width, height: s.height, duration, cpu, music, sounds });
  if (!started.ok || started.id == null) return { ok: false, error: started.error };
  const id = started.id;
  // Every way out that does not reach Finish closes this export in the core, by its id: a late
  // cancel never stops an export started after it.
  let open = true;
  const close = async () => {
    if (!open) return;
    open = false;
    await api.animaticExportCancel(id).catch(() => undefined);
  };
  try {
    const W = started.width ?? s.width, H = started.height ?? s.height;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) { await close(); return { ok: false }; }

    const total = frameCount(clip, s.fps);
    let batch: string[] = [];
    // One batch travels while the next is painted.
    let inFlight: Promise<{ ok: boolean; error?: string; hardware?: boolean }> | null = null;
    for (let f = 0; f < total; f++) {
      if (signal.aborted) {
        await inFlight?.catch(() => undefined);
        await close();
        return { ok: false, cancelled: true };
      }
      await paintFrame(ctx, clip, items, layers, f / s.fps, W, H, s.background);
      batch.push(jpegBase64(canvas));
      if (batch.length >= BATCH || f === total - 1) {
        const prev = inFlight ? await inFlight : null;
        // A refused batch means the core already closed the export.
        if (prev && !prev.ok) { open = false; return { ok: false, error: prev.error, hardware: prev.hardware }; }
        inFlight = api.animaticExportFrames(id, batch);
        batch = [];
        onProgress({ phase: "frames", done: f + 1, total });
      }
    }
    const last = inFlight ? await inFlight : null;
    if (last && !last.ok) { open = false; return { ok: false, error: last.error, hardware: last.hardware }; }
    onProgress({ phase: "finish", done: total, total });
    open = false;
    const r = await api.animaticExportFinish(id);
    if (!r.ok || !r.path) return { ok: false, error: r.error, hardware: r.hardware };
    return { ok: true, path: r.path, bytes: r.bytes ?? 0 };
  } catch (e) {
    await close();
    throw e;
  }
}

/** Exports the Animatic open on the board. */
export async function exportAnimatic(
  clip: ClipData,
  s: AnimaticExportSettings,
  onProgress: (p: AnimaticExportProgress) => void,
  signal: AbortSignal,
): Promise<AnimaticExportResult> {
  if (!nr.reference?.animaticExportStart) return { ok: false };
  const items = useBoard.getState().items;
  onProgress({ phase: "prepare", done: 0, total: 1 });
  let layers: Layer[] = [];
  try {
    layers = await planLayers(clip, items, s.width, s.height, (done, total) => onProgress({ phase: "prepare", done, total }), signal);
    if (signal.aborted) return { ok: false, cancelled: true };
    let r = await encode(clip, items, layers, s, false, onProgress, signal);
    // The hardware encoder gave up (driver, session limit): the same frames again, on the CPU,
    // from pictures made afresh.
    if (!r.ok && !r.cancelled && r.hardware && !signal.aborted) {
      release(layers);
      r = await encode(clip, items, layers, s, true, onProgress, signal);
    }
    if (!r.ok) return { ok: false, cancelled: r.cancelled, error: r.error };
    return { ok: true, path: r.path, bytes: r.bytes };
  } finally {
    release(layers);
  }
}

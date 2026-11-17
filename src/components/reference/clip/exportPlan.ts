// What an Animatic export shows at each frame, computed without touching the page: how far an item
// is into its appearance, which frame of a video plays, which pieces of sound are heard and when the
// music steps back. The painting itself is clip/exportAnimatic.ts.

import { cameraAt, clipDuration, fxOf, shotItemSpan, type ClipData, type FxKind, type PinCorner, type VideoLoop } from "./clipModel";

export const EXPORT_FPS = [24, 30, 60] as const;
export type ExportFps = (typeof EXPORT_FPS)[number];
export const EXPORT_SIZES = [
  { id: "720p", w: 1280, h: 720 },
  { id: "1080p", w: 1920, h: 1080 },
  { id: "1440p", w: 2560, h: 1440 },
  { id: "2160p", w: 3840, h: 2160 },
] as const;
export type ExportSizeId = (typeof EXPORT_SIZES)[number]["id"];
// The pinned overlay fades in like the live one (Tailwind `fade-in duration-300`).
export const PIN_FADE = 0.3;
// Music level while a video plays with its sound on; the core applies the same value.
export const DUCK = 0.25;
// Every piece of sound is one more ffmpeg input: past this, the later ones are left out.
export const MAX_SOUND_PIECES = 32;

export function frameCount(clip: ClipData, fps: number): number {
  return Math.max(1, Math.round(clipDuration(clip) * fps));
}

// Close to the CSS curves of the live board (ease for opacity, a strong ease-out for the move).
const easeOut = (k: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

export interface ItemLook {
  alpha: number;
  scale: number;
  // Vertical offset, as a fraction of the item's height (the slide effect).
  dy: number;
}

/**
 * How an item shows at t, given the span it is present in: it plays its appearance from the start
 * of the span, its exit after the end (the live board keeps it mounted while it fades), and is gone
 * outside. A pinned item fades in only and leaves at once, like the screen overlay.
 */
export function lookAt(clip: ClipData, id: string, span: [number, number], t: number, pinned = false): ItemLook | null {
  const [a, b] = span;
  if (t < a) return null;
  const fx = fxOf(clip, id);
  const kind: FxKind = pinned ? "fade" : fx.kind;
  const d = pinned ? PIN_FADE : kind === "cut" ? 0 : fx.dur;
  let k: number;
  if (t < b) k = d > 0 ? (t - a) / d : 1;
  else if (!pinned && d > 0 && t < b + d) k = 1 - (t - b) / d;
  else return null;
  const e = easeOut(k);
  if (e <= 0) return null;
  return {
    alpha: (pinned ? 1 : fx.opacity) * e,
    scale: kind === "zoom" ? 0.82 + 0.18 * e : 1,
    dy: kind === "slide" ? 0.12 * (1 - e) : 0,
  };
}

/**
 * Every stretch of time an item is on screen, in order. An item can sit in several shots: shots
 * that follow each other make one stretch (it stays on through the cut), a gap starts a new one.
 */
export function itemSpans(clip: ClipData, id: string): [number, number][] {
  const raw: [number, number][] = [];
  for (const l of clip.long) if (l.id === id && l.end > l.start) raw.push([l.start, l.end]);
  clip.shots.forEach((s, i) => {
    for (const si of s.items) {
      if (si.id !== id) continue;
      const span = shotItemSpan(clip, i, si);
      if (span[1] > span[0]) raw.push(span);
    }
  });
  raw.sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of raw) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1e-6) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** The look of an item over all its stretches: the strongest one at t (a fade-out may meet a fade-in). */
export function lookAcross(clip: ClipData, id: string, spans: [number, number][], t: number, pinned = false): { look: ItemLook; span: [number, number] } | null {
  let best: { look: ItemLook; span: [number, number] } | null = null;
  for (const span of spans) {
    if (span[0] > t) break;
    const look = lookAt(clip, id, span, t, pinned);
    if (look && (!best || look.alpha >= best.look.alpha)) best = { look, span };
  }
  return best;
}

export type VideoMode = VideoLoop | "frozen";

/** Seconds into a video's range `len` after playing `local` seconds of it. */
export function videoTimeAt(local: number, len: number, mode: VideoMode): number {
  if (!(len > 0) || mode === "frozen" || local <= 0) return 0;
  if (mode === "once") return Math.min(local, Math.max(0, len - 0.001));
  if (mode === "pingpong") {
    const p = local % (2 * len);
    return p <= len ? p : 2 * len - p;
  }
  return local % len;
}

export interface SoundSource {
  path: string;
  // Range of the file the item plays, in source seconds.
  in: number;
  len: number;
  speed: number;
  mode: VideoMode;
  span: [number, number];
}

export interface SoundPiece { path: string; from: number; to: number; at: number; speed: number }

/**
 * Pieces of a video's sound over its span: the range once, again at each loop, the forward halves
 * of a ping-pong (a reversed sound is noise, not the video).
 */
export function soundPieces(s: SoundSource): SoundPiece[] {
  const [a, b] = s.span;
  if (s.mode === "frozen" || !(s.len > 0) || !(b > a)) return [];
  const speed = s.speed > 0 ? s.speed : 1;
  const cycle = s.len / speed;
  const out: SoundPiece[] = [];
  const every = s.mode === "pingpong" ? 2 * cycle : cycle;
  for (let at = a; at < b - 0.01; at += every) {
    const dur = Math.min(cycle, b - at);
    out.push({ path: s.path, from: s.in, to: s.in + dur * speed, at, speed });
    if (s.mode === "once" || out.length >= MAX_SOUND_PIECES) break;
  }
  return out;
}

/** Spans (merged, in order) where the music steps back for a video's sound. */
export function duckSpans(spans: [number, number][]): [number, number][] {
  const sorted = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Narrowest the camera gets over the spans: how sharp an item must be painted to stay crisp. */
export function narrowestCamera(clip: ClipData, spans: [number, number][], samples = 24): number {
  let w = Infinity;
  for (const [a, b] of spans) {
    for (let i = 0; i <= samples; i++) w = Math.min(w, cameraAt(clip, a + ((b - a) * i) / samples).w);
  }
  return Number.isFinite(w) ? w : cameraAt(clip, 0).w;
}

/** Place of a pinned item on the output frame. */
export function pinRect(corner: PinCorner, size: number, aspect: number, W: number, H: number): { x: number; y: number; w: number; h: number } {
  const w = W * Math.min(0.9, Math.max(0.05, size));
  const h = aspect > 0 ? w / aspect : w;
  const m = W * 0.025;
  const x = corner === "tl" || corner === "bl" ? m : W - w - m;
  const y = corner === "tl" || corner === "tr" ? m : H - h - m;
  return { x, y, w, h };
}

/** Suggested file name: the Animatic's title, safe for every file system. */
export function exportFileName(title: string | undefined): string {
  const base = (title || "Animatic").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Animatic";
  return `${base}.mp4`;
}

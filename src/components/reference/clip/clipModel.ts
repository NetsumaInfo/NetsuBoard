// Music clip: a folder of the board whose level is animated against a track (see
// docs/superpowers/specs/2026-11-16-netsuboard-music-timeline-design.md). Everything here is pure:
// the timeline document, what is on screen at a given time, where the camera is, snapping.

export const CLIP_ASPECT = 16 / 9;
// A clip without music still has a timeline to cut into shots.
export const DEFAULT_DURATION = 30;
export const MIN_SHOT = 0.25;
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4;
export const DEFAULT_GLIDE = 0.6;

export interface ClipRect { x: number; y: number; w: number; h: number }

// An item of a shot. `delay` = seconds after the shot starts before it appears, `early` = seconds
// before the shot ends when it leaves. Both unset = the whole shot.
export interface ShotItem { id: string; delay?: number; early?: number }

export interface Shot {
  id: string;
  start: number;
  label?: string;
  // Camera framings, 16:9 rectangles in board coordinates. The camera moves from `from` to `to`
  // during the shot; equal framings give a static shot.
  from: ClipRect;
  to: ClipRect;
  items: ShotItem[];
  // How the camera reaches this shot from the previous one.
  transition: "cut" | "glide";
  glide?: number;
}

export type PinCorner = "tl" | "tr" | "bl" | "br";

// Item of the Long lane: free start/end, ignores shot boundaries.
export interface LongItem {
  id: string;
  start: number;
  end: number;
  // Pinned to the screen instead of living on the board: corner and width as a fraction of the frame.
  pin?: { corner: PinCorner; size: number };
}

export type VideoLoop = "loop" | "pingpong" | "once";

// Per-item video behaviour while the clip plays. Unset = plays muted, ×1, looping.
export interface ClipVideo {
  frozen?: boolean;
  sound?: boolean;
  speed?: number;
  loop?: VideoLoop;
}

export interface ClipMusic { ref: string; name: string; dur: number }

export interface ClipData {
  v: 1;
  music?: ClipMusic;
  // Detected beat times (seconds), cached with the clip; recomputed when the music changes.
  beats?: number[];
  bpm?: number;
  snap: boolean;
  shots: Shot[];
  long: LongItem[];
  videos: Record<string, ClipVideo>;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function clipDuration(clip: ClipData): number {
  return clip.music?.dur && clip.music.dur > 0 ? clip.music.dur : DEFAULT_DURATION;
}

// ── Rectangles ──────────────────────────────────────────────────────────────

export interface Box { x: number; y: number; w: number; h: number }

// Smallest 16:9 rectangle around a box, centred on it, with a margin.
export function frameAround(box: Box, pad = 0.08): ClipRect {
  const w0 = box.w * (1 + pad * 2);
  const h0 = box.h * (1 + pad * 2);
  const w = Math.max(w0, h0 * CLIP_ASPECT, 160);
  const h = w / CLIP_ASPECT;
  return { x: box.x + box.w / 2 - w / 2, y: box.y + box.h / 2 - h / 2, w, h };
}

export function boundsOfBoxes(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function lerpRect(a: ClipRect, b: ClipRect, k: number): ClipRect {
  const t = Math.min(1, Math.max(0, k));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t };
}

// View (translate + scale) that shows a framing letterboxed in a viewport.
export function viewForRect(r: ClipRect, vw: number, vh: number): { tx: number; ty: number; scale: number } {
  const scale = Math.min(vw / r.w, vh / r.h);
  return { scale, tx: vw / 2 - (r.x + r.w / 2) * scale, ty: vh / 2 - (r.y + r.h / 2) * scale };
}

// ── Building ────────────────────────────────────────────────────────────────

export function makeShot(start: number, frame: ClipRect, items: string[] = []): Shot {
  return { id: uid(), start, from: { ...frame }, to: { ...frame }, items: items.map((id) => ({ id })), transition: "cut" };
}

export function makeClip(frame: ClipRect, itemIds: string[]): ClipData {
  return { v: 1, snap: true, shots: [makeShot(0, frame, itemIds)], long: [], videos: {} };
}

// Shots sorted, the first one at 0, none starting past the end. A damaged or hand-edited clip is
// brought back to something the timeline can draw.
export function normalizeClip(raw: unknown): ClipData | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Partial<ClipData>;
  const shots = Array.isArray(c.shots) ? c.shots.filter((s) => s && typeof s.start === "number" && s.from && s.to) : [];
  if (!shots.length) return null;
  const sorted = [...shots].sort((a, b) => a.start - b.start).map((s) => ({ ...s, items: Array.isArray(s.items) ? s.items : [] }));
  sorted[0] = { ...sorted[0], start: 0 };
  return {
    v: 1,
    music: c.music && typeof c.music.ref === "string" ? c.music : undefined,
    beats: Array.isArray(c.beats) ? c.beats.filter((b) => typeof b === "number") : undefined,
    bpm: typeof c.bpm === "number" ? c.bpm : undefined,
    snap: c.snap !== false,
    shots: sorted,
    long: Array.isArray(c.long) ? c.long.filter((l) => l && typeof l.id === "string") : [],
    videos: c.videos && typeof c.videos === "object" ? c.videos : {},
  };
}

// ── Time queries ────────────────────────────────────────────────────────────

export function shotEnd(clip: ClipData, index: number): number {
  return index + 1 < clip.shots.length ? clip.shots[index + 1].start : clipDuration(clip);
}

export function shotIndexAt(clip: ClipData, t: number): number {
  let i = 0;
  for (let k = 0; k < clip.shots.length; k++) if (clip.shots[k].start <= t) i = k;
  return i;
}

// Span of an item of a shot, in clip seconds.
export function shotItemSpan(clip: ClipData, index: number, si: ShotItem): [number, number] {
  const s = clip.shots[index].start;
  const e = shotEnd(clip, index);
  const a = Math.min(e, s + Math.max(0, si.delay ?? 0));
  const b = Math.max(a, e - Math.max(0, si.early ?? 0));
  return [a, b];
}

// Ids of the items present at time t: shot items whose span covers t, plus Long items.
export function presentAt(clip: ClipData, t: number): Set<string> {
  const out = new Set<string>();
  const i = shotIndexAt(clip, t);
  for (const si of clip.shots[i]?.items ?? []) {
    const [a, b] = shotItemSpan(clip, i, si);
    if (t >= a && t < b) out.add(si.id);
  }
  for (const l of clip.long) if (t >= l.start && t < l.end) out.add(l.id);
  return out;
}

// Every item id the clip animates (shots and Long lane).
export function animatedIds(clip: ClipData): Set<string> {
  const out = new Set<string>();
  for (const s of clip.shots) for (const si of s.items) out.add(si.id);
  for (const l of clip.long) out.add(l.id);
  return out;
}

// Where an item lives on the timeline: a shot (index) or the Long lane.
export function laneOf(clip: ClipData, id: string): { long: true } | { shot: number } | null {
  if (clip.long.some((l) => l.id === id)) return { long: true };
  const i = clip.shots.findIndex((s) => s.items.some((si) => si.id === id));
  return i >= 0 ? { shot: i } : null;
}

// Camera framing at time t. During a glide into a shot the camera travels from where the previous
// shot ended to where this one starts, then follows the shot from its `from` to its `to`.
export function cameraAt(clip: ClipData, t: number): ClipRect {
  const i = shotIndexAt(clip, t);
  const shot = clip.shots[i];
  const s = shot.start;
  const e = shotEnd(clip, i);
  const inShot = lerpRect(shot.from, shot.to, e > s ? (t - s) / (e - s) : 0);
  if (i > 0 && shot.transition === "glide") {
    const g = Math.min(shot.glide ?? DEFAULT_GLIDE, (e - s) * 0.9);
    if (g > 0 && t < s + g) {
      const prev = clip.shots[i - 1];
      return lerpRect(prev.to, inShot, ease((t - s) / g));
    }
  }
  return inShot;
}

const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

// ── Snapping ────────────────────────────────────────────────────────────────

// Nearest beat within `tolerance` seconds, else t itself.
export function snapTime(t: number, beats: number[] | undefined, tolerance: number): number {
  if (!beats?.length) return t;
  let lo = 0, hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] < t) lo = mid + 1; else hi = mid;
  }
  let best = beats[lo];
  if (lo > 0 && Math.abs(beats[lo - 1] - t) < Math.abs(best - t)) best = beats[lo - 1];
  return Math.abs(best - t) <= tolerance ? best : t;
}

// ── Edits (each returns a new clip) ─────────────────────────────────────────

// Cuts the shot under t in two. The new shot starts at t, framed where the camera is, and takes
// the items still present at t; their offsets are reset.
export function cutAt(clip: ClipData, t: number): ClipData {
  const dur = clipDuration(clip);
  if (t <= MIN_SHOT || t >= dur - MIN_SHOT) return clip;
  const i = shotIndexAt(clip, t);
  const shot = clip.shots[i];
  if (t - shot.start < MIN_SHOT || shotEnd(clip, i) - t < MIN_SHOT) return clip;
  const cam = cameraAt(clip, t);
  const keep = shot.items.filter((si) => {
    const [, b] = shotItemSpan(clip, i, si);
    return b > t;
  });
  const left: Shot = { ...shot, to: cam };
  const right: Shot = { id: uid(), start: t, from: cam, to: { ...shot.to }, items: keep.map((si) => ({ id: si.id })), transition: "cut" };
  const shots = [...clip.shots.slice(0, i), left, right, ...clip.shots.slice(i + 1)];
  return { ...clip, shots };
}

// Moves the boundary at the start of shot `index` (index ≥ 1), clamped between its neighbours.
export function moveBoundary(clip: ClipData, index: number, t: number): ClipData {
  if (index < 1 || index >= clip.shots.length) return clip;
  const lo = clip.shots[index - 1].start + MIN_SHOT;
  const hi = shotEnd(clip, index) - MIN_SHOT;
  if (hi < lo) return clip;
  const start = Math.min(hi, Math.max(lo, t));
  return { ...clip, shots: clip.shots.map((s, k) => (k === index ? { ...s, start } : s)) };
}

// Removes the boundary at the start of shot `index`: the shot merges into the previous one, whose
// items gain the ones it did not have.
export function mergeShot(clip: ClipData, index: number): ClipData {
  if (index < 1 || index >= clip.shots.length) return clip;
  const prev = clip.shots[index - 1];
  const gone = clip.shots[index];
  const have = new Set(prev.items.map((si) => si.id));
  const merged: Shot = {
    ...prev,
    to: gone.to,
    items: [...prev.items, ...gone.items.filter((si) => !have.has(si.id)).map((si) => ({ id: si.id }))],
  };
  return { ...clip, shots: [...clip.shots.slice(0, index - 1), merged, ...clip.shots.slice(index + 1)] };
}

export function patchShot(clip: ClipData, index: number, patch: Partial<Shot>): ClipData {
  return { ...clip, shots: clip.shots.map((s, k) => (k === index ? { ...s, ...patch } : s)) };
}

// Adds items to a shot. An item lives in one place only: it leaves the Long lane if it was there.
// Within shots, an item may appear in several shots (each shot lists what it shows).
export function addToShot(clip: ClipData, index: number, ids: string[]): ClipData {
  const shot = clip.shots[index];
  if (!shot) return clip;
  const have = new Set(shot.items.map((si) => si.id));
  const add = ids.filter((id) => !have.has(id));
  if (!add.length && !clip.long.some((l) => ids.includes(l.id))) return clip;
  const set = new Set(ids);
  return {
    ...patchShot(clip, index, { items: [...shot.items, ...add.map((id) => ({ id }))] }),
    long: clip.long.filter((l) => !set.has(l.id)),
  };
}

export function removeFromShot(clip: ClipData, index: number, ids: string[]): ClipData {
  const set = new Set(ids);
  const shot = clip.shots[index];
  if (!shot) return clip;
  return patchShot(clip, index, { items: shot.items.filter((si) => !set.has(si.id)) });
}

export function setShotItemTiming(clip: ClipData, index: number, id: string, timing: { delay?: number; early?: number }): ClipData {
  const shot = clip.shots[index];
  if (!shot) return clip;
  const s = shot.start;
  const e = shotEnd(clip, index);
  const span = e - s;
  return patchShot(clip, index, {
    items: shot.items.map((si) => {
      if (si.id !== id) return si;
      const delay = Math.min(span - MIN_SHOT, Math.max(0, timing.delay ?? si.delay ?? 0));
      const early = Math.min(span - delay - MIN_SHOT, Math.max(0, timing.early ?? si.early ?? 0));
      return { id, ...(delay > 0.001 ? { delay } : {}), ...(early > 0.001 ? { early } : {}) };
    }),
  });
}

// Moves items to the Long lane (whole track by default), out of every shot.
export function toLong(clip: ClipData, ids: string[], span?: [number, number]): ClipData {
  const set = new Set(ids);
  const have = new Set(clip.long.map((l) => l.id));
  const [start, end] = span ?? [0, clipDuration(clip)];
  return {
    ...clip,
    shots: clip.shots.map((s) => ({ ...s, items: s.items.filter((si) => !set.has(si.id)) })),
    long: [...clip.long, ...ids.filter((id) => !have.has(id)).map((id) => ({ id, start, end }))],
  };
}

// Moves a Long item back into the shot under its start.
export function longToShot(clip: ClipData, id: string): ClipData {
  const l = clip.long.find((x) => x.id === id);
  if (!l) return clip;
  const rest = { ...clip, long: clip.long.filter((x) => x.id !== id) };
  return addToShot(rest, shotIndexAt(clip, l.start), [id]);
}

export function setLongSpan(clip: ClipData, id: string, start: number, end: number): ClipData {
  const dur = clipDuration(clip);
  const a = Math.min(dur - MIN_SHOT, Math.max(0, start));
  const b = Math.min(dur, Math.max(a + MIN_SHOT, end));
  return { ...clip, long: clip.long.map((l) => (l.id === id ? { ...l, start: a, end: b } : l)) };
}

export function setLongPin(clip: ClipData, id: string, pin: LongItem["pin"] | null): ClipData {
  return {
    ...clip,
    long: clip.long.map((l) => {
      if (l.id !== id) return l;
      if (!pin) { const { pin: _p, ...rest } = l; return rest; }
      return { ...l, pin };
    }),
  };
}

export function setVideo(clip: ClipData, id: string, patch: Partial<ClipVideo>): ClipData {
  const next = { ...(clip.videos[id] ?? {}), ...patch };
  if (next.speed != null) next.speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, next.speed));
  const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined && v !== false)) as ClipVideo;
  if (clean.speed === 1) delete clean.speed;
  if (clean.loop === "loop") delete clean.loop;
  const videos = { ...clip.videos };
  if (Object.keys(clean).length) videos[id] = clean; else delete videos[id];
  return { ...clip, videos };
}

// Speed that makes a range of `rangeSec` fill a bar of `barSec`, clamped to the allowed range.
export function fitSpeed(rangeSec: number, barSec: number): number {
  if (!(rangeSec > 0) || !(barSec > 0)) return 1;
  return Math.round(Math.min(SPEED_MAX, Math.max(SPEED_MIN, rangeSec / barSec)) * 100) / 100;
}

// Span on the timeline where an item is visible: its first appearance to its last.
export function itemBar(clip: ClipData, id: string): [number, number] | null {
  const l = clip.long.find((x) => x.id === id);
  if (l) return [l.start, l.end];
  let a = Infinity, b = -Infinity;
  clip.shots.forEach((s, i) => {
    const si = s.items.find((x) => x.id === id);
    if (!si) return;
    const [x, y] = shotItemSpan(clip, i, si);
    a = Math.min(a, x); b = Math.max(b, y);
  });
  return a < b ? [a, b] : null;
}

// Drops references to items that no longer exist in the clip's level.
export function pruneClip(clip: ClipData, alive: Set<string>): ClipData {
  let changed = false;
  const shots = clip.shots.map((s) => {
    const items = s.items.filter((si) => alive.has(si.id));
    if (items.length !== s.items.length) changed = true;
    return items.length === s.items.length ? s : { ...s, items };
  });
  const long = clip.long.filter((l) => alive.has(l.id));
  if (long.length !== clip.long.length) changed = true;
  const videos = Object.fromEntries(Object.entries(clip.videos).filter(([id]) => alive.has(id)));
  if (Object.keys(videos).length !== Object.keys(clip.videos).length) changed = true;
  return changed ? { ...clip, shots, long, videos } : clip;
}

// When the music changes length, shots past the new end are merged away and Long bars clamped.
export function fitToDuration(clip: ClipData): ClipData {
  const dur = clipDuration(clip);
  let next = clip;
  while (next.shots.length > 1 && next.shots[next.shots.length - 1].start > dur - MIN_SHOT) {
    next = mergeShot(next, next.shots.length - 1);
  }
  return {
    ...next,
    long: next.long.map((l) => ({ ...l, start: Math.min(l.start, dur - MIN_SHOT), end: Math.min(Math.max(l.end, l.start + MIN_SHOT), dur) })),
  };
}

export function formatTime(t: number): string {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? "0" : ""}${r.toFixed(1)}`;
}

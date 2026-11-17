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

// How an item appears and leaves in the Animatic. Unset = a fade of DEFAULT_FX_DUR, full opacity.
export type FxKind = "fade" | "zoom" | "slide" | "cut";
export interface ClipFx { kind?: FxKind; dur?: number; opacity?: number }
export const DEFAULT_FX_DUR = 0.3;
export const FX_DUR_MAX = 2;

export interface ClipMusic { ref: string; name: string; dur: number }

// A named point of the music (intro, verse, drop), shown on the ruler.
export interface ClipMark { id: string; t: number; label?: string }

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
  fx?: Record<string, ClipFx>;
  marks?: ClipMark[];
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
    ...(c.fx && typeof c.fx === "object" ? { fx: c.fx } : {}),
    ...(Array.isArray(c.marks)
      ? { marks: c.marks.filter((m) => m && typeof m.id === "string" && typeof m.t === "number").sort((a, b) => a.t - b.t) }
      : {}),
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

// Times a dragged edge sticks to: the beats, every cut, both ends of the track, and any extra time
// (the playhead). Sorted, for `snapTime`.
export function snapPoints(clip: ClipData, extra: number[] = []): number[] {
  const pts = [...(clip.beats ?? []), ...clip.shots.map((s) => s.start), clipDuration(clip), ...extra];
  return pts.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
}

// Moves the cut nearest to t to the next (dir 1) or previous (dir -1) beat; without a beat grid,
// by `step` seconds. Returns the new clip and where the cut now is, or null when there is no cut.
export function nudgeCut(clip: ClipData, t: number, dir: -1 | 1, step = 0.1): { clip: ClipData; at: number } | null {
  if (clip.shots.length < 2) return null;
  let index = 1;
  for (let k = 2; k < clip.shots.length; k++) {
    if (Math.abs(clip.shots[k].start - t) < Math.abs(clip.shots[index].start - t)) index = k;
  }
  const from = clip.shots[index].start;
  const beats = clip.beats ?? [];
  const target = beats.length
    ? (dir > 0 ? beats.find((b) => b > from + 0.01) : [...beats].reverse().find((b) => b < from - 0.01)) ?? from + dir * step
    : from + dir * step;
  const next = moveBoundary(clip, index, target);
  return { clip: next, at: next.shots[index].start };
}

// ── Tempo by hand ───────────────────────────────────────────────────────────

export const BPM_MIN = 30;
export const BPM_MAX = 300;

// Tempo from tapped times (seconds, in order): the median interval, so one late tap does not
// throw it off. Null under three taps.
export function tapTempo(taps: number[]): number | null {
  if (taps.length < 3) return null;
  const gaps = taps.slice(1).map((x, i) => x - taps[i]).filter((g) => g > 0).sort((a, b) => a - b);
  if (!gaps.length) return null;
  const mid = gaps[Math.floor(gaps.length / 2)];
  const bpm = 60 / mid;
  return bpm >= BPM_MIN && bpm <= BPM_MAX ? Math.round(bpm * 10) / 10 : null;
}

// A regular grid at `bpm` with a beat on `anchor`, covering the track.
export function beatGrid(bpm: number, anchor: number, dur: number): number[] {
  if (!(bpm >= BPM_MIN && bpm <= BPM_MAX) || !(dur > 0)) return [];
  const step = 60 / bpm;
  const first = anchor - Math.floor(anchor / step) * step;
  const out: number[] = [];
  for (let t = first; t < dur; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
}

// Replaces the detected grid with a tempo set by hand (typed or tapped), a beat on `anchor`.
export function setTempo(clip: ClipData, bpm: number, anchor: number): ClipData {
  const b = Math.min(BPM_MAX, Math.max(BPM_MIN, bpm));
  return { ...clip, bpm: b, beats: beatGrid(b, anchor, clipDuration(clip)) };
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

// Deletes a shot: the previous one stretches over its time (the first shot: the next one starts at
// 0 instead). The last shot left cannot go. Items only in the deleted shot leave the timeline.
export function deleteShot(clip: ClipData, index: number): ClipData {
  if (clip.shots.length < 2 || index < 0 || index >= clip.shots.length) return clip;
  if (index === 0) {
    const [, next, ...rest] = clip.shots;
    return { ...clip, shots: [{ ...next, start: 0 }, ...rest] };
  }
  return { ...clip, shots: clip.shots.filter((_, k) => k !== index) };
}

// ── Fast blocking ───────────────────────────────────────────────────────────

// Length of `beats` beats at the detected tempo, else null.
export function beatsToSeconds(clip: ClipData, beats: number): number | null {
  return clip.bpm && clip.bpm > 0 ? (60 / clip.bpm) * beats : null;
}

// One shot per item from t0: each shot shows its item alone, framed on it, `step` seconds long
// (the last one runs to the end). Shots after t0 are replaced; Long items are kept. Items that do
// not fit before the end are dropped.
export function shotsPerItem(clip: ClipData, t0: number, items: { id: string; box: Box }[], step: number): ClipData {
  const dur = clipDuration(clip);
  if (!items.length || !(step > 0)) return clip;
  let c = clip;
  const at = Math.max(0, Math.min(t0, dur - MIN_SHOT));
  if (at - c.shots[shotIndexAt(c, at)].start >= MIN_SHOT) c = cutAt(c, at);
  const i0 = shotIndexAt(c, at + 0.001);
  c = { ...c, shots: c.shots.slice(0, i0 + 1) };
  for (let k = 1; k < items.length; k++) {
    const t = at + k * step;
    if (t > dur - MIN_SHOT) break;
    c = cutAt(c, t);
  }
  const shots = c.shots.map((s, i) => {
    const k = i - i0;
    if (k < 0 || k >= items.length) return s;
    const f = frameAround(items[k].box);
    return { ...s, items: [{ id: items[k].id }], from: f, to: f, transition: "cut" as const };
  });
  // An item lives in one lane: those now in a shot leave the Long lane.
  const placed = new Set(items.map((it) => it.id));
  return { ...c, shots, long: c.long.filter((l) => !placed.has(l.id)) };
}

// Cuts a shot every `every` beats of the detected grid, where no boundary is already close.
export function cutOnBeats(clip: ClipData, every: number): ClipData {
  const beats = clip.beats ?? [];
  if (!beats.length || every < 1) return clip;
  let c = clip;
  for (let k = every; k < beats.length; k += every) {
    const t = beats[k];
    if (c.shots.some((s) => Math.abs(s.start - t) < MIN_SHOT)) continue;
    c = cutAt(c, t);
  }
  return c;
}

export type CameraMove = "static" | "zoomIn" | "zoomOut" | "panLeft" | "panRight";

const shrink = (r: ClipRect, k: number): ClipRect => ({ x: r.x + (r.w * (1 - k)) / 2, y: r.y + (r.h * (1 - k)) / 2, w: r.w * k, h: r.h * k });
const shift = (r: ClipRect, dx: number): ClipRect => ({ ...r, x: r.x + dx });

// A ready-made camera move for a shot, built around its current start framing.
export function cameraMove(clip: ClipData, index: number, move: CameraMove): ClipData {
  const s = clip.shots[index];
  if (!s) return clip;
  const a = s.from;
  const d = a.w * 0.12;
  const set = (from: ClipRect, to: ClipRect) => patchShot(clip, index, { from, to });
  switch (move) {
    case "static": return set(a, a);
    case "zoomIn": return set(a, shrink(a, 0.72));
    case "zoomOut": return set(shrink(a, 0.72), a);
    case "panLeft": return set(shift(a, d), shift(a, -d));
    case "panRight": return set(shift(a, -d), shift(a, d));
  }
}

// Which ready-made move a shot's framings match, if any (for the menu's check marks).
export function cameraMoveOf(shot: Shot): CameraMove | null {
  const { from: a, to: b } = shot;
  const near = (x: number, y: number) => Math.abs(x - y) < Math.max(1, a.w * 0.01);
  if (near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w)) return "static";
  if (near(a.w, b.w)) return b.x < a.x ? "panLeft" : "panRight";
  return b.w < a.w ? "zoomIn" : "zoomOut";
}

// Shot framed on its items (both framings, a static shot).
export function frameOnItems(clip: ClipData, index: number, boxes: Box[]): ClipData {
  const box = boundsOfBoxes(boxes);
  if (!box) return clip;
  const f = frameAround(box);
  return patchShot(clip, index, { from: f, to: { ...f } });
}

// A copy of a shot right after it: the shot is cut in two at its middle and both halves show the
// same thing.
export function duplicateShot(clip: ClipData, index: number): ClipData {
  const s = clip.shots[index];
  if (!s) return clip;
  const mid = (s.start + shotEnd(clip, index)) / 2;
  const c = cutAt(clip, mid);
  if (c === clip) return clip;
  const copy = () => ({ from: { ...s.from }, to: { ...s.to }, label: s.label, items: s.items.map((si) => ({ ...si })) });
  return patchShot(patchShot(c, index, copy()), index + 1, { ...copy(), transition: "cut" });
}

// Moves the content of a shot (framings, items, name, transition) to another place in the order;
// the time slots stay where they are.
export function moveShot(clip: ClipData, from: number, to: number): ClipData {
  const n = clip.shots.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return clip;
  const starts = clip.shots.map((s) => s.start);
  const order = [...clip.shots];
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  return { ...clip, shots: order.map((s, i) => ({ ...s, start: starts[i] })) };
}

// Start of the shot before or after the one under t (for the arrow keys).
export function neighbourShotStart(clip: ClipData, t: number, dir: -1 | 1): number {
  const i = shotIndexAt(clip, t);
  if (dir < 0) {
    // Inside a shot, the first press goes back to its start.
    if (t - clip.shots[i].start > 0.05) return clip.shots[i].start;
    return clip.shots[Math.max(0, i - 1)].start;
  }
  return i + 1 < clip.shots.length ? clip.shots[i + 1].start : clipDuration(clip);
}

// Items of the level that no lane of the timeline shows.
export function unassigned(clip: ClipData, itemIds: string[]): string[] {
  const shown = animatedIds(clip);
  return itemIds.filter((id) => !shown.has(id));
}

// Tick spacing for a ruler: the smallest step that leaves at least `minPx` between labels.
export function rulerStep(pxPerSec: number, minPx = 64): number {
  for (const s of [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]) if (s * pxPerSec >= minPx) return s;
  return 600;
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

// ── Several items at once ───────────────────────────────────────────────────

export function fxOf(clip: ClipData, id: string): Required<ClipFx> {
  const f = clip.fx?.[id] ?? {};
  return { kind: f.kind ?? "fade", dur: f.dur ?? DEFAULT_FX_DUR, opacity: f.opacity ?? 1 };
}

// Appearance settings for several items; defaults are dropped so the document stays small.
export function setFx(clip: ClipData, ids: string[], patch: ClipFx): ClipData {
  const fx = { ...(clip.fx ?? {}) };
  for (const id of ids) {
    const next: ClipFx = { ...(fx[id] ?? {}), ...patch };
    if (next.dur != null) next.dur = Math.min(FX_DUR_MAX, Math.max(0, next.dur));
    if (next.opacity != null) next.opacity = Math.min(1, Math.max(0.05, next.opacity));
    if (next.kind === "fade") delete next.kind;
    if (next.dur === DEFAULT_FX_DUR) delete next.dur;
    if (next.opacity === 1) delete next.opacity;
    if (Object.keys(next).length) fx[id] = next; else delete fx[id];
  }
  return { ...clip, fx };
}

// The selected items enter at t: a Long item starts there; an item of the shot under t waits until
// t; an item not in that shot joins it, entering at t.
export function markIn(clip: ClipData, ids: string[], t: number): ClipData {
  let next = clip;
  const i = shotIndexAt(clip, t);
  for (const id of ids) {
    const l = next.long.find((x) => x.id === id);
    if (l) { next = setLongSpan(next, id, t, Math.max(l.end, t + MIN_SHOT)); continue; }
    if (!next.shots[i].items.some((si) => si.id === id)) next = addToShot(next, i, [id]);
    next = setShotItemTiming(next, i, id, { delay: t - next.shots[i].start });
  }
  return next;
}

// The selected items leave at t: a Long item ends there; an item of the shot under t leaves early.
export function markOut(clip: ClipData, ids: string[], t: number): ClipData {
  let next = clip;
  const i = shotIndexAt(clip, t);
  for (const id of ids) {
    const l = next.long.find((x) => x.id === id);
    if (l) { next = setLongSpan(next, id, l.start, t); continue; }
    if (next.shots[i].items.some((si) => si.id === id)) {
      next = setShotItemTiming(next, i, id, { early: shotEnd(next, i) - t });
    }
  }
  return next;
}

// Items of a shot enter one after another, in the given order: on the beats when the track has
// some, else spread evenly over the first half of the shot. Their exits are kept.
export function cascade(clip: ClipData, index: number, ordered: string[]): ClipData {
  const shot = clip.shots[index];
  if (!shot) return clip;
  const s = shot.start, e = shotEnd(clip, index);
  const ids = ordered.filter((id) => shot.items.some((si) => si.id === id));
  if (ids.length < 2) return clip;
  const beats = (clip.beats ?? []).filter((b) => b >= s - 0.01 && b < e - MIN_SHOT);
  const even = ((e - s) * 0.5) / ids.length;
  let next = clip;
  ids.forEach((id, k) => {
    const at = beats.length >= ids.length ? beats[k] : s + k * even;
    next = setShotItemTiming(next, index, id, { delay: Math.max(0, at - s) });
  });
  return next;
}

// Slides items of a shot together by dt seconds, each keeping its length; dt is clamped so none of
// them leaves the shot.
export function shiftShotItems(clip: ClipData, index: number, ids: string[], dt: number): ClipData {
  const shot = clip.shots[index];
  if (!shot) return clip;
  const s = shot.start, e = shotEnd(clip, index);
  const set = new Set(ids);
  const moving = shot.items.filter((si) => set.has(si.id));
  if (!moving.length) return clip;
  let lo = -Infinity, hi = Infinity;
  for (const si of moving) {
    const [a, b] = shotItemSpan(clip, index, si);
    lo = Math.max(lo, s - a);
    hi = Math.min(hi, e - b);
  }
  const d = Math.min(hi, Math.max(lo, dt));
  return patchShot(clip, index, {
    items: shot.items.map((si) => {
      if (!set.has(si.id)) return si;
      const [a, b] = shotItemSpan(clip, index, si);
      const delay = a + d - s, early = e - (b + d);
      return { id: si.id, ...(delay > 0.001 ? { delay } : {}), ...(early > 0.001 ? { early } : {}) };
    }),
  });
}

// Slides Long items together by dt seconds, each keeping its length, inside the track.
export function shiftLong(clip: ClipData, ids: string[], dt: number): ClipData {
  const set = new Set(ids);
  const moving = clip.long.filter((l) => set.has(l.id));
  if (!moving.length) return clip;
  const dur = clipDuration(clip);
  const lo = Math.max(...moving.map((l) => -l.start));
  const hi = Math.min(...moving.map((l) => dur - l.end));
  const d = Math.min(hi, Math.max(lo, dt));
  return { ...clip, long: clip.long.map((l) => (set.has(l.id) ? { ...l, start: l.start + d, end: l.end + d } : l)) };
}

// Back to the whole shot for the given items.
export function resetTiming(clip: ClipData, index: number, ids: string[]): ClipData {
  const shot = clip.shots[index];
  if (!shot) return clip;
  const set = new Set(ids);
  return patchShot(clip, index, { items: shot.items.map((si) => (set.has(si.id) ? { id: si.id } : si)) });
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

// The same timeline for copied items (a duplicated Animatic): every item id goes through `ids`.
export function remapClip(clip: ClipData, ids: Map<string, string>): ClipData {
  const m = (id: string) => ids.get(id) ?? id;
  const keys = <T,>(rec: Record<string, T> | undefined) =>
    rec ? Object.fromEntries(Object.entries(rec).map(([k, v]) => [m(k), v])) : undefined;
  return {
    ...clip,
    shots: clip.shots.map((s) => ({ ...s, id: uid(), items: s.items.map((si) => ({ ...si, id: m(si.id) })) })),
    long: clip.long.map((l) => ({ ...l, id: m(l.id) })),
    videos: keys(clip.videos) ?? {},
    ...(clip.fx ? { fx: keys(clip.fx) } : {}),
  };
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
  const fx = clip.fx ? Object.fromEntries(Object.entries(clip.fx).filter(([id]) => alive.has(id))) : undefined;
  if (fx && Object.keys(fx).length !== Object.keys(clip.fx!).length) changed = true;
  return changed ? { ...clip, shots, long, videos, ...(fx ? { fx } : {}) } : clip;
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
    ...(next.marks ? { marks: next.marks.filter((m) => m.t < dur) } : {}),
  };
}

// ── Marks ───────────────────────────────────────────────────────────────────

const byTime = (marks: ClipMark[]) => [...marks].sort((a, b) => a.t - b.t);

export function addMark(clip: ClipData, t: number, label?: string): ClipData {
  const at = Math.min(clipDuration(clip), Math.max(0, t));
  if ((clip.marks ?? []).some((m) => Math.abs(m.t - at) < 0.05)) return clip;
  return { ...clip, marks: byTime([...(clip.marks ?? []), { id: uid(), t: at, ...(label ? { label } : {}) }]) };
}

export function patchMark(clip: ClipData, id: string, patch: { t?: number; label?: string | null }): ClipData {
  const dur = clipDuration(clip);
  return {
    ...clip,
    marks: byTime((clip.marks ?? []).map((m) => {
      if (m.id !== id) return m;
      const next: ClipMark = { ...m };
      if (patch.t != null) next.t = Math.min(dur, Math.max(0, patch.t));
      if (patch.label !== undefined) { if (patch.label) next.label = patch.label; else delete next.label; }
      return next;
    })),
  };
}

export function removeMark(clip: ClipData, id: string): ClipData {
  const marks = (clip.marks ?? []).filter((m) => m.id !== id);
  if (marks.length) return { ...clip, marks };
  const { marks: _m, ...rest } = clip;
  return rest;
}

// A shot starts on every mark (where no cut is already close); a new shot takes the mark's name.
export function cutAtMarks(clip: ClipData): ClipData {
  let c = clip;
  for (const m of clip.marks ?? []) {
    const near = c.shots.findIndex((s) => Math.abs(s.start - m.t) < MIN_SHOT);
    if (near < 0) c = cutAt(c, m.t);
    const i = c.shots.findIndex((s) => Math.abs(s.start - m.t) < MIN_SHOT);
    if (i >= 0 && m.label && !c.shots[i].label) c = patchShot(c, i, { label: m.label });
  }
  return c;
}

// ── Copy and paste of a shot ────────────────────────────────────────────────

// What a copied shot carries: its content, its length, and the settings of its items.
export interface ShotPiece {
  shot: Pick<Shot, "from" | "to" | "items" | "label" | "transition" | "glide">;
  len: number;
  videos: Record<string, ClipVideo>;
  fx: Record<string, ClipFx>;
}

export function copyShotPiece(clip: ClipData, index: number): ShotPiece | null {
  const s = clip.shots[index];
  if (!s) return null;
  const ids = new Set(s.items.map((si) => si.id));
  const pick = <T,>(rec: Record<string, T> | undefined) => Object.fromEntries(Object.entries(rec ?? {}).filter(([id]) => ids.has(id)));
  return {
    shot: { from: { ...s.from }, to: { ...s.to }, items: s.items.map((si) => ({ ...si })), label: s.label, transition: s.transition, glide: s.glide },
    len: shotEnd(clip, index) - s.start,
    videos: pick(clip.videos),
    fx: pick(clip.fx),
  };
}

// Puts a copied shot at t for its length, over what was there; what was there goes on after it.
// `ids` maps the copied item ids to the ids of their copies on this level.
export function pasteShotPiece(clip: ClipData, t: number, piece: ShotPiece, ids: Map<string, string>): ClipData {
  const dur = clipDuration(clip);
  const at = Math.min(dur - MIN_SHOT, Math.max(0, t));
  let c = clip;
  if (at - c.shots[shotIndexAt(c, at)].start >= MIN_SHOT) c = cutAt(c, at);
  const i = shotIndexAt(c, at + MIN_SHOT / 2);
  const end = c.shots[i].start + piece.len;
  if (shotEnd(c, i) - end >= MIN_SHOT && end - c.shots[i].start >= MIN_SHOT) c = cutAt(c, end);
  const m = (id: string) => ids.get(id) ?? id;
  const remap = <T,>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).map(([k, v]) => [m(k), v]));
  const pasted = {
    ...piece.shot,
    from: { ...piece.shot.from }, to: { ...piece.shot.to },
    items: piece.shot.items.map((si) => ({ ...si, id: m(si.id) })),
    transition: i === 0 ? "cut" as const : piece.shot.transition,
  };
  c = patchShot(c, i, pasted);
  const videos = { ...c.videos, ...remap(piece.videos) };
  const fx = { ...(c.fx ?? {}), ...remap(piece.fx) };
  // Item timings were relative to the copied shot: clamp them to the slot they landed in.
  for (const si of c.shots[i].items) c = setShotItemTiming(c, i, si.id, {});
  return { ...c, videos, ...(Object.keys(fx).length ? { fx } : {}) };
}

export function formatTime(t: number): string {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? "0" : ""}${r.toFixed(1)}`;
}

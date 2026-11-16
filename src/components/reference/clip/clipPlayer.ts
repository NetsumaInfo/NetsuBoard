// Playback of the open clip: one clock (the music when there is one), the set of items present at
// the playhead, and the camera when it drives the board view (Follow camera, Present). Lives
// outside React like the board's other live channels: the time moves every frame and only the
// playhead and the camera rectangle subscribe to it.

import { create } from "zustand";
import { useBoard } from "../useReferenceBoard";
import { displaySrc, type BoardView } from "../referenceShared";
import {
  CLIP_ASPECT, addToShot, animatedIds, cameraAt, clipDuration, presentAt, shotIndexAt, viewForRect,
  type ClipData, type ClipRect,
} from "./clipModel";
import { openClipId, openClipRaw, readClip } from "./clipSelectors";
import { analyse, mixDown } from "./audioAnalysis";

// The board view, driven imperatively while the camera moves (no React render per frame), then
// committed to the store when it stops. Registered by ReferenceBoard.
export interface ViewDriver {
  apply(v: BoardView): void;
  commit(v: BoardView): void;
  size(): { w: number; h: number };
}
let driver: ViewDriver | null = null;
export function registerViewDriver(d: ViewDriver): () => void {
  driver = d;
  return () => { if (driver === d) driver = null; };
}

export interface ClipPlayerState {
  clipId: string | null;
  time: number;
  playing: boolean;
  follow: boolean;
  presenting: boolean;
  // Items present at the playhead. Replaced only when its content changes, so an item re-renders
  // only when it enters or leaves.
  present: Set<string>;
  // Long items pinned to the screen: drawn by the screen overlay, not on the board, while the
  // camera drives the view.
  pinned: Set<string>;
  // Waveform of the current music (not persisted: recomputed from the file).
  wave: { ref: string; peaks: number[] } | null;
  analysing: boolean;
  // Shot expanded in the timeline (its items as sub-bars).
  expanded: string | null;
  // Mood board side panel inside the clip.
  library: boolean;
}

export const useClipPlayer = create<ClipPlayerState>(() => ({
  clipId: null,
  time: 0,
  playing: false,
  follow: false,
  presenting: false,
  present: new Set(),
  pinned: new Set(),
  wave: null,
  analysing: false,
  expanded: null,
  library: false,
}));

const set = useClipPlayer.setState;
const get = useClipPlayer.getState;

let audio: HTMLAudioElement | null = null;
let audioRef = "";
function audioEl(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
  }
  return audio;
}

// Clock when the clip has no music.
let clockAt = 0;
let clockFrom = 0;
let raf = 0;
let lastView: BoardView | null = null;
let viewBeforePresent: BoardView | null = null;

export function currentClip(): ClipData | null {
  return readClip(openClipRaw(useBoard.getState()));
}

function hasMusic(clip: ClipData): boolean {
  return !!clip.music?.ref && audioRef === clip.music.ref && !!audio?.src;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// Moves everything that depends on the time: presence, camera, music ducking.
function applyTime(t: number) {
  const clip = currentClip();
  if (!clip) return;
  const present = presentAt(clip, t);
  const pinned = new Set(clip.long.filter((l) => l.pin).map((l) => l.id));
  const st = get();
  set({
    time: t,
    ...(sameSet(present, st.present) ? null : { present }),
    ...(sameSet(pinned, st.pinned) ? null : { pinned }),
  });
  if ((st.follow || st.presenting) && driver) {
    const { w, h } = driver.size();
    if (w > 0 && h > 0) {
      lastView = viewForRect(cameraAt(clip, t), w, h);
      driver.apply(lastView);
    }
  }
  if (audio) {
    const talking = [...present].some((id) => clip.videos[id]?.sound);
    audio.volume = talking ? 0.25 : 1;
  }
}

function tick() {
  raf = 0;
  const clip = currentClip();
  if (!clip || !get().playing) return;
  const dur = clipDuration(clip);
  let t = hasMusic(clip) ? audio!.currentTime : clockFrom + (performance.now() - clockAt) / 1000;
  if (t >= dur) {
    t = dur;
    applyTime(t);
    pause();
    return;
  }
  applyTime(t);
  raf = requestAnimationFrame(tick);
}

export function play() {
  const clip = currentClip();
  if (!clip) return;
  const dur = clipDuration(clip);
  let t = get().time;
  if (t >= dur - 0.05) t = 0;
  if (hasMusic(clip)) {
    audio!.currentTime = t;
    void audio!.play().catch(() => undefined);
  }
  clockFrom = t;
  clockAt = performance.now();
  set({ playing: true });
  applyTime(t);
  if (!raf) raf = requestAnimationFrame(tick);
}

export function pause() {
  audio?.pause();
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  set({ playing: false });
  // The camera drove the view imperatively: the store learns where it ended.
  if (lastView && driver && (get().follow || get().presenting)) driver.commit(lastView);
}

export function togglePlay() {
  if (get().playing) pause(); else play();
}

export function seek(t: number) {
  const clip = currentClip();
  if (!clip) return;
  const at = Math.min(clipDuration(clip), Math.max(0, t));
  if (audio && hasMusic(clip)) audio.currentTime = at;
  clockFrom = at;
  clockAt = performance.now();
  applyTime(at);
  if (!get().playing && lastView && driver && (get().follow || get().presenting)) driver.commit(lastView);
}

// How an item of the open clip shows: untouched outside a clip, normal when present at the
// playhead, a ghost when absent (editing), hidden when absent in Present. A pinned item is drawn by
// the screen overlay whenever the camera drives the view, so its board copy hides then.
export type ClipLook = "none" | "on" | "ghost" | "hidden";
export function clipLook(s: ClipPlayerState, id: string): ClipLook {
  if (!s.clipId) return "none";
  const drives = s.presenting || s.follow;
  if (drives && s.pinned.has(id)) return "hidden";
  if (s.present.has(id)) return "on";
  return s.presenting ? "hidden" : "ghost";
}

export function setFollow(on: boolean) {
  set({ follow: on });
  if (on) seek(get().time);
}

// ── Present ─────────────────────────────────────────────────────────────────

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); stopPresent(); }
  else if (e.key === " ") { e.preventDefault(); e.stopPropagation(); togglePlay(); }
}
function onFullscreen() {
  if (!document.fullscreenElement && get().presenting) stopPresent();
}

// Full-screen render from the start. Called right after entering the clip from its card, so the
// level may still be switching: the start waits one frame for the board to mount.
export function startPresent() {
  requestAnimationFrame(() => {
    if (!currentClip()) return;
    viewBeforePresent = useBoard.getState().view;
    set({ presenting: true });
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("fullscreenchange", onFullscreen);
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    // The board re-lays out at full size before the first framing is computed.
    setTimeout(() => { seek(0); play(); }, 120);
  });
}

export function stopPresent() {
  if (!get().presenting) return;
  pause();
  set({ presenting: false });
  window.removeEventListener("keydown", onKey, true);
  document.removeEventListener("fullscreenchange", onFullscreen);
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  if (viewBeforePresent && driver) driver.commit(viewBeforePresent);
  viewBeforePresent = null;
  lastView = null;
}

// ── Music ───────────────────────────────────────────────────────────────────

function musicSrc(ref: string): string {
  return displaySrc("image", ref);
}

function loadMusic(clip: ClipData | null) {
  const ref = clip?.music?.ref ?? "";
  if (ref === audioRef) return;
  audioRef = ref;
  const el = audioEl();
  el.pause();
  if (!ref) {
    el.removeAttribute("src");
    el.load();
    set({ wave: null });
    return;
  }
  el.src = musicSrc(ref);
  el.load();
  void analyseMusic(ref);
}

// Waveform always; beats only when the clip does not already carry them for this track.
async function analyseMusic(ref: string) {
  set({ analysing: true });
  try {
    const res = await fetch(musicSrc(ref));
    const buf = await res.arrayBuffer();
    const ctx = new AudioContext();
    const decoded = await ctx.decodeAudioData(buf);
    void ctx.close();
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
    const result = analyse(mixDown(channels), decoded.sampleRate);
    if (audioRef !== ref) return;
    set({ wave: { ref, peaks: result.peaks } });
    const id = get().clipId;
    const clip = currentClip();
    if (id && clip?.music?.ref === ref && !clip.beats?.length) {
      const dur = decoded.duration;
      useBoard.getState().patchClip(id, {
        ...clip,
        beats: result.beats,
        bpm: result.bpm ?? undefined,
        music: { ...clip.music, dur: clip.music.dur > 0 ? clip.music.dur : dur },
      }, { record: false });
    }
  } catch {
    if (audioRef === ref) set({ wave: null });
  } finally {
    if (audioRef === ref) set({ analysing: false });
  }
}

// Duration of a music file, read from its metadata.
export function probeDuration(ref: string): Promise<number> {
  return new Promise((resolve) => {
    const a = new Audio();
    a.preload = "metadata";
    const done = (d: number) => { a.removeAttribute("src"); resolve(d); };
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => done(0);
    a.src = musicSrc(ref);
  });
}

// The part of the board on screen, as a 16:9 framing centred in it.
export function framingFromView(): ClipRect | null {
  const size = driver?.size();
  if (!size || !size.w || !size.h) return null;
  const v = useBoard.getState().view;
  const vw = size.w / v.scale, vh = size.h / v.scale;
  const w = Math.min(vw, vh * CLIP_ASPECT);
  const h = w / CLIP_ASPECT;
  const cx = -v.tx / v.scale + vw / 2, cy = -v.ty / v.scale + vh / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

// Board point at the centre of the screen.
export function viewCentre(): { x: number; y: number } {
  const size = driver?.size() ?? { w: 0, h: 0 };
  const v = useBoard.getState().view;
  return { x: (size.w / 2 - v.tx) / v.scale, y: (size.h / 2 - v.ty) / v.scale };
}

// ── Following the board ─────────────────────────────────────────────────────

// Items added to the level of an open clip (a drop, a paste, a copy from the mood board) join the
// shot under the playhead, so they show up instead of waiting as ghosts.
let knownIds: Set<string> | null = null;
function adoptNewItems() {
  const s = useBoard.getState();
  const id = get().clipId;
  const clip = currentClip();
  if (!id || !clip) { knownIds = null; return; }
  const ids = s.items.filter((it) => it.kind !== "draw").map((it) => it.id);
  if (!knownIds) { knownIds = new Set(ids); return; }
  const fresh = ids.filter((x) => !knownIds!.has(x));
  knownIds = new Set(ids);
  if (!fresh.length) return;
  const animated = animatedIds(clip);
  const add = fresh.filter((x) => !animated.has(x));
  if (add.length) s.patchClip(id, addToShot(clip, shotIndexAt(clip, get().time), add), { record: false });
}

// Keeps the player on the clip that is open: entering another level stops playback and resets the
// playhead; a change of music reloads the track.
export function watchOpenClip(): () => void {
  const sync = () => {
    const s = useBoard.getState();
    const id = openClipId(s);
    if (id !== get().clipId) {
      if (get().presenting) stopPresent();
      pause();
      lastView = null;
      set({ clipId: id, time: 0, expanded: null, present: new Set(), follow: false });
      knownIds = null;
      if (id) applyTime(0);
    }
    loadMusic(id ? currentClip() : null);
    adoptNewItems();
  };
  sync();
  let prev = openClipRaw(useBoard.getState());
  let prevPath = useBoard.getState().folderPath;
  let prevItems = useBoard.getState().items;
  const unsub = useBoard.subscribe((s) => {
    const raw = openClipRaw(s);
    if (raw === prev && s.folderPath === prevPath && s.items === prevItems) return;
    const onlyItems = raw === prev && s.folderPath === prevPath;
    prev = raw;
    prevPath = s.folderPath;
    prevItems = s.items;
    if (onlyItems) { if (get().clipId && s.items.length !== knownIds?.size) adoptNewItems(); return; }
    sync();
    // An edit changes who is present at the playhead even when the time does not move.
    if (get().clipId && !get().playing) applyTime(get().time);
  });
  return () => {
    unsub();
    pause();
  };
}

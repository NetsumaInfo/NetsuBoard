// Playback of the open clip: one clock (the music when there is one), the set of items present at
// the playhead, and the camera when it drives the board view (Follow camera, Present). Lives
// outside React like the board's other live channels: the time moves every frame and only the
// playhead and the camera rectangle subscribe to it.

import { create } from "zustand";
import { useBoard } from "../useReferenceBoard";
import { displaySrc, type BoardView } from "../referenceShared";
import {
  CLIP_ASPECT, addToShot, animatedIds, cameraAt, clipDuration, fitToDuration, neighbourShotStart, presentAt, shotEnd, shotIndexAt, viewForRect,
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
  // The music file could not be read (moved, deleted, unsupported).
  musicError: boolean;
  // Timeline folded down to its toolbar, to give the board room.
  folded: boolean;
  // Playback loops on the shot under the playhead.
  loop: boolean;
  // The tracks area shows the shots as cards instead of lanes.
  storyboard: boolean;
  // Music level on this device (kept in localStorage), and muted while working.
  musicVolume: number;
  musicMuted: boolean;
}

const VOLUME_KEY = "netsuboard.animatic.volume";
function readVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(v) && localStorage.getItem(VOLUME_KEY) != null ? Math.min(1, Math.max(0, v)) : 1;
  } catch { return 1; }
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
  musicError: false,
  folded: false,
  loop: false,
  storyboard: false,
  musicVolume: readVolume(),
  musicMuted: false,
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
    audio.volume = get().musicMuted ? 0 : get().musicVolume * (talking ? 0.25 : 1);
  }
}

let loopRange: [number, number] | null = null;
// Playback stops here (a shot preview), then the playhead goes back to where the preview began.
let stopAt: { end: number; back: number } | null = null;
function armLoop(clip: ClipData, t: number) {
  const i = shotIndexAt(clip, t);
  loopRange = [clip.shots[i].start + 0.001, shotEnd(clip, i)];
}

// Loops playback on the shot under the playhead (key L).
export function setLoop(on: boolean) {
  set({ loop: on });
  const clip = currentClip();
  if (on && clip) armLoop(clip, get().time);
}

function tick() {
  raf = 0;
  const clip = currentClip();
  if (!clip || !get().playing) return;
  const dur = clipDuration(clip);
  let t = hasMusic(clip) ? audio!.currentTime : clockFrom + (performance.now() - clockAt) / 1000;
  // Loop on the shot that was under the playhead when the loop started.
  if (stopAt && t >= stopAt.end) {
    const back = stopAt.back;
    stopAt = null;
    pause();
    seek(back);
    return;
  }
  if (loopRange && get().loop && t >= loopRange[1]) {
    seek(loopRange[0]);
    raf = requestAnimationFrame(tick);
    return;
  }
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
  armLoop(clip, t);
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
  stopAt = null;
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

// Plays the shot under the playhead once from its start, then comes back to its start (Shift+Space).
export function previewShot() {
  const clip = currentClip();
  if (!clip) return;
  if (get().playing) pause();
  const i = shotIndexAt(clip, get().time);
  const start = clip.shots[i].start;
  seek(start + 0.001);
  play();
  stopAt = { end: shotEnd(clip, i), back: start + 0.001 };
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

// Music level of the Animatic on this device.
export function setMusicVolume(v: number) {
  const musicVolume = Math.min(1, Math.max(0, v));
  set({ musicVolume, musicMuted: false });
  try { localStorage.setItem(VOLUME_KEY, String(musicVolume)); } catch { /* private window: the level lasts the session */ }
  applyTime(get().time);
}

export function toggleMusicMute() {
  set({ musicMuted: !get().musicMuted });
  applyTime(get().time);
}

export function setFollow(on: boolean) {
  set({ follow: on });
  if (on) seek(get().time);
}

// ── Present ─────────────────────────────────────────────────────────────────

function onKey(e: KeyboardEvent) {
  // stopImmediatePropagation: the board shortcuts listen on the same window, and Escape there
  // would also leave the Animatic.
  if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); stopPresent(); }
  else if (e.key === " ") { e.preventDefault(); e.stopImmediatePropagation(); togglePlay(); }
  else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    e.stopImmediatePropagation();
    const clip = currentClip();
    if (clip) seek(neighbourShotStart(clip, get().time, e.key === "ArrowLeft" ? -1 : 1) + 0.001);
  }
}
function onFullscreen() {
  if (!document.fullscreenElement && get().presenting) stopPresent();
}

// Full-screen render from `from` (the start by default). Called right after entering the clip from
// its card, so the level may still be switching: the start waits one frame for the board to mount.
export function startPresent(from = 0) {
  requestAnimationFrame(() => {
    if (!currentClip()) return;
    viewBeforePresent = useBoard.getState().view;
    set({ presenting: true });
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("fullscreenchange", onFullscreen);
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    // The board re-lays out at full size before the first framing is computed.
    setTimeout(() => { seek(from); play(); }, 120);
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
  set({ musicError: false });
  el.onerror = () => { if (audioRef === ref) set({ musicError: true }); };
  el.onloadeddata = () => { if (audioRef === ref) set({ musicError: false }); };
  el.src = musicSrc(ref);
  el.load();
  void analyseMusic(ref);
}

// Last detection result per track, so "detect again" does not decode the file a second time.
let detected: { ref: string; beats: number[]; bpm: number | null } | null = null;

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
    // About 60 peaks a second, so the waveform stays sharp when the timeline is zoomed in.
    const buckets = Math.min(24000, Math.max(2000, Math.round(decoded.duration * 60)));
    const result = analyse(mixDown(channels), decoded.sampleRate, buckets);
    if (audioRef !== ref) return;
    detected = { ref, beats: result.beats, bpm: result.bpm };
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

// Puts back the grid found in the music, replacing a tempo set by hand.
export function redetectBeats() {
  const id = get().clipId;
  const clip = currentClip();
  if (!id || !clip?.music) return;
  if (detected?.ref === clip.music.ref) {
    useBoard.getState().patchClip(id, { ...clip, beats: detected.beats, bpm: detected.bpm ?? undefined });
    return;
  }
  // Not analysed yet (still decoding, or failed): clearing the grid lets the next analysis fill it.
  useBoard.getState().patchClip(id, { ...clip, beats: undefined, bpm: undefined });
  void analyseMusic(clip.music.ref);
}

// Sets the track of the open Animatic (a picked file, a dropped file, a sound of the mood board).
export async function setClipMusic(ref: string, name?: string) {
  const id = get().clipId;
  if (!id || !ref) return;
  const dur = await probeDuration(ref);
  const clip = currentClip();
  if (!clip) return;
  const label = name || ref.split(/[\\/]/).pop() || ref;
  useBoard.getState().patchClip(id, fitToDuration({ ...clip, music: { ref, name: label, dur }, beats: undefined, bpm: undefined }));
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

// Toolbar button: an animatic from the selection (the card appears beside it), or an empty one
// framed on the screen and opened at once, ready for media to be dropped in.
export function newAnimatic() {
  const s = useBoard.getState();
  if (openClipId(s)) return;
  const usable = s.selectedIds.some((id) => {
    const it = s.items.find((i) => i.id === id);
    return !!it && it.kind !== "draw" && !it.folder;
  });
  const area = framingFromView() ?? { x: 0, y: 0, w: 1600, h: 900 };
  const id = s.createClip(usable ? s.selectedIds : [], area);
  // Opened at once: its timeline is the point of making one.
  if (id) useBoard.getState().enterFolder(id);
}

// Frames the board on the camera at the playhead, once the level on screen has laid out.
export function frameCamera() {
  requestAnimationFrame(() => {
    const clip = currentClip();
    const size = driver?.size();
    if (!clip || !driver || !size?.w || !size.h) return;
    const r = cameraAt(clip, get().time);
    // A margin around the framing, so its handles stay on screen.
    const pad = { x: r.x - r.w * 0.06, y: r.y - r.h * 0.12, w: r.w * 1.12, h: r.h * 1.24 };
    driver.commit(viewForRect(pad, size.w, size.h));
  });
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
      set({ clipId: id, time: 0, expanded: null, present: new Set(), follow: false, musicError: false });
      knownIds = null;
      if (id) {
        applyTime(0);
        // Present frames the view itself; otherwise show the first shot as the camera sees it.
        if (!get().presenting) frameCamera();
      }
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

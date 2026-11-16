// Players of the audio cards. Each card's <audio> lives here, outside the board's DOM: a card the
// culling unmounts (panned far away, crowded board) keeps playing, and the card that mounts again
// finds its player where it left it. A player goes away with its item (deleted, other scene).

import { useSyncExternalStore } from "react";
import { useBoard } from "./useReferenceBoard";

export interface AudioState {
  playing: boolean;
  time: number;
  duration: number;
  failed: boolean;
}

interface Player {
  el: HTMLAudioElement;
  state: AudioState;
  listeners: Set<() => void>;
}

const IDLE: AudioState = { playing: false, time: 0, duration: 0, failed: false };
const players = new Map<string, Player>();

function emit(p: Player, patch: Partial<AudioState>) {
  p.state = { ...p.state, ...patch };
  for (const fn of p.listeners) fn();
}

function player(id: string, src: string): Player {
  const known = players.get(id);
  if (known) {
    if (src && known.el.getAttribute("src") !== src) {
      known.el.src = src;
      emit(known, { ...IDLE });
    }
    return known;
  }
  const el = new Audio();
  el.preload = "metadata";
  const p: Player = { el, state: IDLE, listeners: new Set() };
  el.addEventListener("play", () => emit(p, { playing: true }));
  el.addEventListener("pause", () => emit(p, { playing: false }));
  el.addEventListener("ended", () => emit(p, { playing: false }));
  el.addEventListener("timeupdate", () => emit(p, { time: el.currentTime }));
  el.addEventListener("loadedmetadata", () => emit(p, { duration: isFinite(el.duration) ? el.duration : 0, failed: false }));
  el.addEventListener("error", () => emit(p, { failed: true, playing: false }));
  if (src) el.src = src;
  players.set(id, p);
  return p;
}

function dispose(id: string) {
  const p = players.get(id);
  if (!p) return;
  p.el.pause();
  p.el.removeAttribute("src");
  p.el.load();
  players.delete(id);
}

// An item that left the board takes its sound with it.
useBoard.subscribe((s, prev) => {
  if (s.items === prev.items || !players.size) return;
  const alive = new Set(s.items.map((it) => it.id));
  for (const id of [...players.keys()]) if (!alive.has(id)) dispose(id);
});

/** Live state of a card's player; creates the player on first use. */
export function useAudioPlayer(id: string, src: string): AudioState {
  const p = player(id, src);
  return useSyncExternalStore(
    (fn) => { p.listeners.add(fn); return () => p.listeners.delete(fn); },
    () => p.state,
  );
}

export function audioSettings(id: string, opts: { volume: number; loop: boolean; rate?: number }) {
  const p = players.get(id);
  if (!p) return;
  p.el.volume = Math.min(1, Math.max(0, opts.volume));
  p.el.loop = opts.loop;
  p.el.playbackRate = opts.rate ?? 1;
}

export function togglePlay(id: string) {
  const p = players.get(id);
  if (!p) return;
  if (p.el.paused) void p.el.play().catch(() => emit(p, { playing: false }));
  else p.el.pause();
}

export function seekAudio(id: string, seconds: number) {
  const p = players.get(id);
  if (!p) return;
  const d = p.state.duration || p.el.duration || 0;
  p.el.currentTime = Math.max(0, d ? Math.min(d, seconds) : seconds);
  emit(p, { time: p.el.currentTime });
}

/** Stops every card (board closed, "pause everything"). */
export function pauseAllAudio() {
  for (const p of players.values()) p.el.pause();
}

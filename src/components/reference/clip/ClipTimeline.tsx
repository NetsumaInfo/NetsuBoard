// Timeline docked under the board while a clip is open: the music (waveform and beat grid), the
// Long lane, the shots (expandable into their items) and the playhead. Every edit goes through the
// board store (`patchClip`), so it is saved, shared and undone like any other change.

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { nr } from "@/lib/bridge";
import { Button } from "@/components/ui/button";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useBoard } from "../useReferenceBoard";
import type { BoardItem } from "../referenceShared";
import {
  DEFAULT_GLIDE, MIN_SHOT, SPEED_MAX, SPEED_MIN, addToShot, clipDuration, cutAt, fitSpeed, fitToDuration,
  formatTime, longToShot, mergeShot, moveBoundary, patchShot, pruneClip, removeFromShot, setLongPin, setLongSpan,
  setShotItemTiming, setVideo, shotEnd, shotIndexAt, shotItemSpan, snapTime, toLong,
  type ClipData, type PinCorner, type VideoLoop,
} from "./clipModel";
import { openClipId, openClipRaw, readClip } from "./clipSelectors";
import {
  framingFromView, probeDuration, seek, setFollow, startPresent, togglePlay, useClipPlayer,
} from "./clipPlayer";

const LABEL_W = 76;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma|aiff?)$/i;

function TipButton({ label, onClick, active, disabled, children, className }: {
  label: string; onClick: () => void; active?: boolean; disabled?: boolean; children: ReactNode; className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant={active ? "default" : "ghost"} size="icon-sm" aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick} className={className} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

function itemName(it: BoardItem | undefined, t: (k: string) => string): string {
  if (!it) return "—";
  const text = it.title || (it.kind === "text" ? it.text?.split("\n")[0] : "") || "";
  return text.trim().slice(0, 40) || t(`clip.kind.${it.kind}`);
}

// Pointer drag in seconds along a track of known width.
function useTimeDrag(width: number, dur: number) {
  return useCallback((e: ReactPointerEvent, onMove: (dt: number, ev: PointerEvent) => void, onEnd?: () => void) => {
    e.stopPropagation();
    e.preventDefault();
    const x0 = e.clientX;
    const move = (ev: PointerEvent) => onMove(((ev.clientX - x0) / Math.max(1, width)) * dur, ev);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      onEnd?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }, [width, dur]);
}

export function ClipTimeline() {
  const { t } = useTranslation("reference");
  const clipId = useBoard((s) => openClipId(s));
  const raw = useBoard((s) => openClipRaw(s));
  const items = useBoard((s) => s.items);
  const selectedIds = useBoard((s) => s.selectedIds);
  const readonly = useBoard((s) => s.collabRole === "viewer" && s.collabProjectId !== null);
  const playing = useClipPlayer((s) => s.playing);
  const follow = useClipPlayer((s) => s.follow);
  const analysing = useClipPlayer((s) => s.analysing);
  const expanded = useClipPlayer((s) => s.expanded);
  const library = useClipPlayer((s) => s.library);
  const shotAtHead = useClipPlayer((s) => {
    const c = readClip(raw);
    return c ? shotIndexAt(c, s.time) : 0;
  });

  const alive = useMemo(() => new Set(items.map((it) => it.id)), [items]);
  const clip = useMemo(() => {
    const c = readClip(raw);
    return c ? pruneClip(c, alive) : null;
  }, [raw, alive]);
  const byId = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);

  const trackRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [clipId]);

  const dur = clip ? clipDuration(clip) : 1;
  const drag = useTimeDrag(width, dur);
  const commit = useCallback((next: ClipData, tag: string | null = null) => {
    if (clipId && !readonly) useBoard.getState().patchClip(clipId, next, { tag });
  }, [clipId, readonly]);
  const latest = () => readClip(openClipRaw(useBoard.getState()));
  const snapT = useCallback((x: number, c: ClipData) =>
    (c.snap ? snapTime(x, c.beats, Math.max(0.04, dur * 0.006)) : x), [dur]);

  // M cuts a shot at the playhead (snapped to the beat), during playback or not.
  useEffect(() => {
    if (!clipId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "m" && e.key !== "M") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      const c = latest();
      if (!c || readonly) return;
      e.preventDefault();
      const at = snapT(useClipPlayer.getState().time, c);
      const next = cutAt(c, at);
      if (next !== c) useBoard.getState().patchClip(clipId, next, { tag: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clipId, readonly, snapT]);

  if (!clipId || !clip) return null;
  const xOf = (sec: number) => (sec / dur) * width;
  const shot = clip.shots[shotAtHead];

  const chooseMusic = async () => {
    const path = await nr.chooseAnyFile();
    if (!path) return;
    await setMusic(path);
  };
  const setMusic = async (path: string) => {
    const c = latest();
    if (!c) return;
    const d = await probeDuration(path);
    const name = path.split(/[\\/]/).pop() ?? path;
    const next = fitToDuration({ ...c, music: { ref: path, name, dur: d }, beats: undefined, bpm: undefined });
    commit(next);
  };
  const dropMusic = async (e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer.files).filter((f) => AUDIO_EXT.test(f.name) || f.type.startsWith("audio/"));
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    const [path] = await nr.pathsForFiles(files.slice(0, 1));
    if (path) await setMusic(path);
  };

  const sel = selectedIds.filter((id) => byId.has(id));
  const frameHere = (which: "from" | "to" | "both") => {
    const r = framingFromView();
    const c = latest();
    if (!r || !c) return;
    const i = shotIndexAt(c, useClipPlayer.getState().time);
    commit(patchShot(c, i, which === "both" ? { from: r, to: r } : { [which]: r }));
  };

  return (
    <div
      className="relative flex shrink-0 flex-col border-t border-border bg-[var(--color-surface)] text-xs select-none"
      onDragOver={(e) => { if (Array.from(e.dataTransfer.items).some((i) => i.kind === "file")) e.preventDefault(); }}
      onDrop={(e) => void dropMusic(e)}
    >
      {/* Toolbar */}
      <div className="flex h-10 items-center gap-1 px-2">
        <TipButton label={playing ? t("clip.pause") : t("clip.play")} onClick={togglePlay} active={playing}>
          <NetsuIcon name="play-pause" on={playing} />
        </TipButton>
        <TimeLabel dur={dur} />
        <Separator orientation="vertical" className="mx-1 h-5" />
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="sm" className="max-w-56 gap-1.5" onClick={() => void chooseMusic()} disabled={readonly} />}>
            <NetsuIcon name="music" />
            <span className="truncate">{clip.music?.name ?? t("clip.addMusic")}</span>
          </TooltipTrigger>
          <TooltipContent side="top">{clip.music ? t("clip.changeMusic") : t("clip.addMusicHint")}</TooltipContent>
        </Tooltip>
        {analysing && <Spinner className="size-3.5" />}
        <TipButton
          label={clip.bpm ? t("clip.snapBpm", { bpm: Math.round(clip.bpm) }) : t("clip.snap")}
          active={clip.snap}
          disabled={readonly}
          onClick={() => commit({ ...clip, snap: !clip.snap })}
        >
          <NetsuIcon name="snap" />
        </TipButton>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <TipButton label={t("clip.cut")} onClick={() => { const c = latest(); if (c) commit(cutAt(c, snapT(useClipPlayer.getState().time, c))); }} disabled={readonly}>
          <NetsuIcon name="cut" />
        </TipButton>
        <TipButton label={t("clip.addToShot")} disabled={readonly || !sel.length} onClick={() => { const c = latest(); if (c) commit(addToShot(c, shotIndexAt(c, useClipPlayer.getState().time), sel)); }}>
          <NetsuIcon name="add" />
        </TipButton>
        <TipButton label={t("clip.toLong")} disabled={readonly || !sel.length} onClick={() => { const c = latest(); if (c) commit(toLong(c, sel)); }}>
          <NetsuIcon name="lane-long" />
        </TipButton>
        <Popover>
          <PopoverTrigger render={<Button variant="ghost" size="sm" className="gap-1.5" disabled={readonly} />}>
            <NetsuIcon name="framing" /> {t("clip.framing")}
          </PopoverTrigger>
          <PopoverContent side="top" className="w-60 p-1.5">
            <div className="px-2 pb-1 pt-1 text-[11px] text-muted-foreground">{t("clip.framingHint")}</div>
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => frameHere("both")}>{t("clip.frameBoth")}</Button>
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => frameHere("from")}>{t("clip.frameStart")}</Button>
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => frameHere("to")}>{t("clip.frameEnd")}</Button>
          </PopoverContent>
        </Popover>
        <ShotTransition clip={clip} index={shotAtHead} readonly={readonly} commit={commit} />
        <div className="flex-1" />
        <TipButton label={t("clip.library")} active={library} onClick={() => useClipPlayer.setState({ library: !library })}>
          <NetsuIcon name="gallery" />
        </TipButton>
        <TipButton label={t("clip.follow")} active={follow} onClick={() => setFollow(!follow)}>
          <NetsuIcon name="camera-follow" on={follow} />
        </TipButton>
        <Button size="sm" className="gap-1.5" onClick={() => startPresent()}>
          <NetsuIcon name="monitor-play" /> {t("clip.present")}
        </Button>
      </div>

      {/* Tracks */}
      <div className="relative flex max-h-[40vh] flex-col overflow-y-auto pb-2">
        <Row label={t("clip.music")}>
          <div
            className="relative h-14 cursor-text"
            onPointerDown={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const at = ((e.clientX - r.left) / r.width) * dur;
              seek(at);
              drag(e, (dt) => seek(at + dt));
            }}
          >
            <Waveform clip={clip} width={width} />
          </div>
        </Row>

        <Row label={t("clip.long")}>
          <div className="flex min-h-7 flex-col gap-0.5 py-0.5">
            {clip.long.length === 0 && <div className="flex h-6 items-center px-2 text-muted-foreground">{t("clip.longEmpty")}</div>}
            {clip.long.map((l) => (
              <div key={l.id} className="relative h-6">
                <Bar
                  left={xOf(l.start)}
                  width={xOf(l.end) - xOf(l.start)}
                  label={itemName(byId.get(l.id), t)}
                  tone="long"
                  selected={selectedIds.includes(l.id)}
                  onSelect={() => useBoard.getState().select(l.id)}
                  onMove={readonly ? undefined : (e) => {
                    const start0 = l.start, end0 = l.end;
                    drag(e, (dt) => { const c = latest(); if (c) commit(setLongSpan(c, l.id, snapT(start0 + dt, c), snapT(start0 + dt, c) + (end0 - start0)), "clip-long"); });
                  }}
                  onLeft={readonly ? undefined : (e) => { const s0 = l.start; drag(e, (dt) => { const c = latest(); if (c) commit(setLongSpan(c, l.id, snapT(s0 + dt, c), l.end), "clip-long"); }); }}
                  onRight={readonly ? undefined : (e) => { const e0 = l.end; drag(e, (dt) => { const c = latest(); if (c) commit(setLongSpan(c, l.id, l.start, snapT(e0 + dt, c)), "clip-long"); }); }}
                  extra={!readonly && (
                    <>
                      <PinMenu
                        corner={l.pin?.corner ?? null}
                        size={l.pin?.size ?? 0.22}
                        onChange={(pin) => { const c = latest(); if (c) commit(setLongPin(c, l.id, pin)); }}
                      />
                      <MiniButton label={t("clip.backToShot")} onClick={() => { const c = latest(); if (c) commit(longToShot(c, l.id)); }}>
                        <NetsuIcon name="move-down" className="size-3" />
                      </MiniButton>
                    </>
                  )}
                />
              </div>
            ))}
          </div>
        </Row>

        <Row label={t("clip.shots")}>
          <div className="relative h-9">
            {clip.shots.map((s, i) => {
              const a = xOf(s.start), b = xOf(shotEnd(clip, i));
              const open = expanded === s.id;
              return (
                <div
                  key={s.id}
                  className={cn(
                    "absolute top-0.5 flex h-8 items-center gap-1 overflow-hidden rounded-md border px-1.5",
                    i === shotAtHead ? "border-[#a78bfa] bg-[#a78bfa]/25" : "border-border bg-muted/60 hover:bg-muted",
                  )}
                  style={{ left: a, width: Math.max(4, b - a - 1) }}
                  onPointerDown={(e) => { if (e.button === 0) seek(s.start + 0.001); }}
                  onDoubleClick={() => useClipPlayer.setState({ expanded: open ? null : s.id })}
                >
                  <button
                    type="button"
                    aria-label={t(open ? "clip.collapse" : "clip.expand")}
                    className="shrink-0 rounded p-0.5 hover:bg-foreground/10"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => useClipPlayer.setState({ expanded: open ? null : s.id })}
                  >
                    <NetsuIcon name="chevron-toggle" on={open} className="size-3" />
                  </button>
                  <span className="truncate font-medium">{s.label || t("clip.shotN", { n: i + 1 })}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{s.items.length}</span>
                </div>
              );
            })}
            {/* Boundaries: drag to move (snapped), double-click to merge. */}
            {!readonly && clip.shots.slice(1).map((s, k) => {
              const i = k + 1;
              return (
                <Tooltip key={`b-${s.id}`}>
                  <TooltipTrigger
                    render={
                      <div
                        className="absolute top-0 z-10 h-9 w-2 -translate-x-1/2 cursor-ew-resize"
                        style={{ left: xOf(s.start) }}
                        onPointerDown={(e) => { const t0 = s.start; drag(e, (dt) => { const c = latest(); if (c) commit(moveBoundary(c, i, snapT(t0 + dt, c)), "clip-boundary"); }); }}
                        onDoubleClick={() => { const c = latest(); if (c) commit(mergeShot(c, i)); }}
                      />
                    }
                  >
                    <span className="mx-auto block h-full w-0.5 bg-foreground/50" />
                  </TooltipTrigger>
                  <TooltipContent side="top">{t("clip.boundaryHint")}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </Row>

        {expanded && (() => {
          const i = clip.shots.findIndex((s) => s.id === expanded);
          if (i < 0) return null;
          const s = clip.shots[i];
          return (
            <Row label={s.label || t("clip.shotN", { n: i + 1 })}>
              <div className="flex flex-col gap-0.5 py-0.5">
                {s.items.length === 0 && <div className="flex h-6 items-center px-2 text-muted-foreground">{t("clip.shotEmpty")}</div>}
                {s.items.map((si) => {
                  const [a, b] = shotItemSpan(clip, i, si);
                  const it = byId.get(si.id);
                  const start = s.start, end = shotEnd(clip, i);
                  return (
                    <div key={si.id} className="relative h-6">
                      <Bar
                        left={xOf(a)}
                        width={xOf(b) - xOf(a)}
                        label={itemName(it, t)}
                        tone="item"
                        selected={selectedIds.includes(si.id)}
                        onSelect={() => useBoard.getState().select(si.id)}
                        onLeft={readonly ? undefined : (e) => { const a0 = a; drag(e, (dt) => { const c = latest(); if (c) commit(setShotItemTiming(c, i, si.id, { delay: snapT(a0 + dt, c) - start }), "clip-item"); }); }}
                        onRight={readonly ? undefined : (e) => { const b0 = b; drag(e, (dt) => { const c = latest(); if (c) commit(setShotItemTiming(c, i, si.id, { early: end - snapT(b0 + dt, c) }), "clip-item"); }); }}
                        extra={!readonly && (
                          <>
                            {it?.kind === "video" && <VideoMenu clip={clip} item={it} bar={b - a} commit={commit} />}
                            <MiniButton label={t("clip.toLong")} onClick={() => { const c = latest(); if (c) commit(toLong(c, [si.id])); }}>
                              <NetsuIcon name="lane-long" className="size-3" />
                            </MiniButton>
                            <MiniButton label={t("clip.removeFromShot")} onClick={() => { const c = latest(); if (c) commit(removeFromShot(c, i, [si.id])); }}>
                              <NetsuIcon name="close" className="size-3" />
                            </MiniButton>
                          </>
                        )}
                      />
                    </div>
                  );
                })}
              </div>
            </Row>
          );
        })()}

        {/* Playhead across every track */}
        <Playhead dur={dur} width={width} />
        {/* Measures the track width (everything right of the label column). */}
        <div ref={trackRef} className="pointer-events-none absolute right-2 top-0 h-0" style={{ left: LABEL_W }} />
      </div>
      {shot && clip.music == null && (
        <div className="pointer-events-none absolute right-3 top-11 text-[10px] text-muted-foreground">{t("clip.noMusic")}</div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-stretch border-b border-border/50 last:border-b-0">
      <div className="flex shrink-0 items-center truncate px-2 text-[11px] font-medium text-muted-foreground" style={{ width: LABEL_W }}>{label}</div>
      <div className="relative mr-2 min-w-0 flex-1">{children}</div>
    </div>
  );
}

function TimeLabel({ dur }: { dur: number }) {
  const time = useClipPlayer((s) => s.time);
  return <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{formatTime(time)} / {formatTime(dur)}</span>;
}

function Playhead({ dur, width }: { dur: number; width: number }) {
  const time = useClipPlayer((s) => s.time);
  return (
    <div className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-red-500" style={{ left: LABEL_W + (time / dur) * width }}>
      <span className="absolute -left-1 top-0 size-2 rotate-45 bg-red-500" />
    </div>
  );
}

function Waveform({ clip, width }: { clip: ClipData; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wave = useClipPlayer((s) => s.wave);
  const peaks = wave && wave.ref === clip.music?.ref ? wave.peaks : null;
  const dur = clipDuration(clip);
  useEffect(() => {
    const c = ref.current;
    if (!c || !width) return;
    const dpr = window.devicePixelRatio || 1;
    const h = 56;
    c.width = Math.floor(width * dpr);
    c.height = Math.floor(h * dpr);
    c.style.width = `${width}px`;
    c.style.height = `${h}px`;
    const g = c.getContext("2d");
    if (!g) return;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, width, h);
    const fg = getComputedStyle(c).color;
    if (peaks?.length) {
      g.fillStyle = fg;
      g.globalAlpha = 0.55;
      for (let x = 0; x < width; x++) {
        const p = peaks[Math.floor((x / width) * peaks.length)] ?? 0;
        const bar = Math.max(1, p * (h - 6));
        g.fillRect(x, (h - bar) / 2, 1, bar);
      }
    }
    if (clip.beats?.length) {
      g.globalAlpha = 0.35;
      g.fillStyle = "#a78bfa";
      for (const b of clip.beats) g.fillRect(Math.round((b / dur) * width), h - 6, 1, 6);
    }
  }, [peaks, width, clip.beats, dur]);
  return <canvas ref={ref} className="absolute inset-0 text-foreground" />;
}

function Bar({ left, width, label, tone, selected, onSelect, onMove, onLeft, onRight, extra }: {
  left: number; width: number; label: string; tone: "long" | "item"; selected: boolean;
  onSelect: () => void;
  onMove?: (e: ReactPointerEvent) => void;
  onLeft?: (e: ReactPointerEvent) => void;
  onRight?: (e: ReactPointerEvent) => void;
  extra?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "group absolute top-0 flex h-6 items-center gap-1 overflow-hidden rounded px-2",
        tone === "long" ? "bg-sky-500/30 text-foreground" : "bg-[#a78bfa]/35 text-foreground",
        selected && "ring-1 ring-primary",
        onMove && "cursor-grab",
      )}
      style={{ left, width: Math.max(8, width) }}
      onPointerDown={(e) => { if (e.button !== 0) return; onSelect(); onMove?.(e); }}
    >
      {onLeft && <span className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-foreground/20 opacity-0 group-hover:opacity-100" onPointerDown={(e) => { e.stopPropagation(); onLeft(e); }} />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100" onPointerDown={(e) => e.stopPropagation()}>{extra}</span>
      {onRight && <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-foreground/20 opacity-0 group-hover:opacity-100" onPointerDown={(e) => { e.stopPropagation(); onRight(e); }} />}
    </div>
  );
}

function MiniButton({ label, onClick, children, active }: { label: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<button type="button" aria-label={label} onClick={onClick} className={cn("rounded p-0.5 hover:bg-foreground/15", active && "bg-foreground/20")} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

function ShotTransition({ clip, index, readonly, commit }: { clip: ClipData; index: number; readonly: boolean; commit: (c: ClipData) => void }) {
  const { t } = useTranslation("reference");
  if (index < 1) return null;
  const s = clip.shots[index];
  const glide = s.transition === "glide";
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="sm" className="gap-1.5" disabled={readonly} />}>
        <NetsuIcon name={glide ? "glide" : "cut"} /> {t(glide ? "clip.glide" : "clip.cutTransition")}
      </PopoverTrigger>
      <PopoverContent side="top" className="w-56 p-2">
        <div className="pb-1.5 text-[11px] text-muted-foreground">{t("clip.transitionHint")}</div>
        <div className="flex gap-1">
          <Button size="sm" variant={glide ? "ghost" : "default"} className="flex-1" onClick={() => commit(patchShot(clip, index, { transition: "cut" }))}>{t("clip.cutTransition")}</Button>
          <Button size="sm" variant={glide ? "default" : "ghost"} className="flex-1" onClick={() => commit(patchShot(clip, index, { transition: "glide", glide: s.glide ?? DEFAULT_GLIDE }))}>{t("clip.glide")}</Button>
        </div>
        {glide && (
          <label className="mt-2 flex items-center gap-2 text-[11px]">
            <span className="text-muted-foreground">{t("clip.glideDuration")}</span>
            <input
              type="range" min={0.1} max={3} step={0.1} value={s.glide ?? DEFAULT_GLIDE}
              onChange={(e) => commit(patchShot(clip, index, { glide: Number(e.target.value) }))}
              className="flex-1 accent-[#a78bfa]"
            />
            <span className="w-8 tabular-nums">{(s.glide ?? DEFAULT_GLIDE).toFixed(1)} s</span>
          </label>
        )}
      </PopoverContent>
    </Popover>
  );
}

const CORNERS: PinCorner[] = ["tl", "tr", "bl", "br"];

function PinMenu({ corner, size, onChange }: { corner: PinCorner | null; size: number; onChange: (pin: { corner: PinCorner; size: number } | null) => void }) {
  const { t } = useTranslation("reference");
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger render={<PopoverTrigger render={<button type="button" aria-label={t("clip.pin")} className={cn("rounded p-0.5 hover:bg-foreground/15", corner && "bg-foreground/20")} />} />}>
          <NetsuIcon name="pin-screen" on={!!corner} className="size-3" />
        </TooltipTrigger>
        <TooltipContent side="top">{t("clip.pin")}</TooltipContent>
      </Tooltip>
      <PopoverContent side="top" className="w-52 p-2">
        <div className="pb-1.5 text-[11px] text-muted-foreground">{t("clip.pinHint")}</div>
        <div className="grid grid-cols-2 gap-1">
          {CORNERS.map((c) => (
            <Button key={c} size="sm" variant={corner === c ? "default" : "ghost"} onClick={() => onChange({ corner: c, size })}>
              {t(`clip.corner.${c}`)}
            </Button>
          ))}
        </div>
        {corner && (
          <>
            <label className="mt-2 flex items-center gap-2 text-[11px]">
              <span className="text-muted-foreground">{t("clip.pinSize")}</span>
              <input type="range" min={0.08} max={0.6} step={0.01} value={size} onChange={(e) => onChange({ corner, size: Number(e.target.value) })} className="flex-1 accent-[#a78bfa]" />
            </label>
            <Button size="sm" variant="ghost" className="mt-1 w-full" onClick={() => onChange(null)}>{t("clip.unpin")}</Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

const LOOPS: VideoLoop[] = ["loop", "pingpong", "once"];

function VideoMenu({ clip, item, bar, commit }: { clip: ClipData; item: BoardItem; bar: number; commit: (c: ClipData) => void }) {
  const { t } = useTranslation("reference");
  const v = clip.videos[item.id] ?? {};
  const speed = v.speed ?? 1;
  const loop = v.loop ?? "loop";
  const range = (item.trimOut ?? item.dur ?? 0) - (item.trimIn ?? 0);
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger render={<PopoverTrigger render={<button type="button" aria-label={t("clip.videoSettings")} className={cn("rounded p-0.5 hover:bg-foreground/15", Object.keys(v).length > 0 && "bg-foreground/20")} />} />}>
          <NetsuIcon name="video" className="size-3" />
        </TooltipTrigger>
        <TooltipContent side="top">{t("clip.videoSettings")}</TooltipContent>
      </Tooltip>
      <PopoverContent side="top" className="w-64 space-y-2 p-2 text-[11px]">
        <div className="flex gap-1">
          <Button size="sm" variant={v.frozen ? "ghost" : "default"} className="flex-1" onClick={() => commit(setVideo(clip, item.id, { frozen: undefined }))}>{t("clip.videoPlays")}</Button>
          <Button size="sm" variant={v.frozen ? "default" : "ghost"} className="flex-1" onClick={() => commit(setVideo(clip, item.id, { frozen: true }))}>{t("clip.videoFrozen")}</Button>
        </div>
        <Button size="sm" variant={v.sound ? "default" : "ghost"} className="w-full justify-start gap-1.5" onClick={() => commit(setVideo(clip, item.id, { sound: v.sound ? undefined : true }))}>
          <NetsuIcon name="mute" on={!v.sound} /> {t("clip.videoSound")}
        </Button>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span>{t("clip.videoSpeed")}</span>
            <span className="tabular-nums text-foreground">×{speed.toFixed(2)}</span>
          </div>
          <input
            type="range" min={Math.log2(SPEED_MIN)} max={Math.log2(SPEED_MAX)} step={0.05} value={Math.log2(speed)}
            onChange={(e) => commit(setVideo(clip, item.id, { speed: Math.round(Math.pow(2, Number(e.target.value)) * 100) / 100 }))}
            className="w-full accent-[#a78bfa]"
          />
          <Button size="sm" variant="ghost" className="w-full" disabled={!(range > 0) || bar < MIN_SHOT} onClick={() => commit(setVideo(clip, item.id, { speed: fitSpeed(range, bar) }))}>
            {t("clip.fitToBar")}
          </Button>
        </div>
        <div className="space-y-1">
          <div className="text-muted-foreground">{t("clip.videoLoop")}</div>
          <div className="flex gap-1">
            {LOOPS.map((l) => (
              <Button key={l} size="sm" variant={loop === l ? "default" : "ghost"} className="flex-1 gap-1" onClick={() => commit(setVideo(clip, item.id, { loop: l }))}>
                <NetsuIcon name={`seq-loop-mode-${l}`} /> {t(`clip.loop.${l}`)}
              </Button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

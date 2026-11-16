// Audio card on the board (MP3, WAV, FLAC, Ogg, Opus, M4A, or a track pulled out of a video):
// play button, title, loudness outline you can click or drag to seek, time, loop and mute. The
// sound itself plays in boardAudioPlayer, so it does not stop when the card leaves the screen.

import { useEffect, useMemo, useState, type PointerEvent as RPointerEvent } from "react";
import { VolumeControl } from "./VolumeControl";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { useTranslation } from "react-i18next";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { nr } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import { useBoard } from "./useReferenceBoard";
import { displaySrc, isCoreFileRef, type BoardItem } from "./referenceShared";
import { audioSettings, seekAudio, togglePlay, useAudioPlayer } from "./boardAudioPlayer";

const BARS = 96;

function clock(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Stand-in outline while the real one is measured (or when the file is not on this disk): stable
// heights drawn from the locator, so the card never jumps between two random shapes.
function placeholderPeaks(seed: string, n = BARS): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    out.push(0.15 + 0.5 * ((h % 1000) / 1000) * (0.4 + 0.6 * Math.sin((i / n) * Math.PI)));
  }
  return out;
}

const peaksCache = new Map<string, number[]>();

function usePeaks(ref: string): number[] | null {
  const [peaks, setPeaks] = useState<number[] | null>(() => peaksCache.get(ref) ?? null);
  useEffect(() => {
    if (peaksCache.has(ref)) { setPeaks(peaksCache.get(ref)!); return; }
    if (!isCoreFileRef(ref) || !nr.reference?.audioPeaks) return;
    let alive = true;
    void nr.reference.audioPeaks(ref, BARS).then((r) => {
      if (!alive || !r.ok || !r.peaks?.length) return;
      peaksCache.set(ref, r.peaks);
      setPeaks(r.peaks);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [ref]);
  return peaks;
}

// Controls inside the card answer the pointer themselves: a press on them must not start moving
// the item.
const keep = (e: RPointerEvent) => e.stopPropagation();

function CardButton({ label, onClick, children, className, active }: {
  label: string; onClick: () => void; children: React.ReactNode; className?: string; active?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <button
            type="button"
            aria-label={label}
            aria-pressed={active}
            onPointerDown={keep}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-4",
              active && "text-primary",
              className,
            )}
          />
        )}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// Playback speeds offered by the speed button, in the order a press cycles through them.
const SPEEDS = [1, 1.25, 1.5, 2, 0.75] as const;
const SKIP = 5; // seconds moved by the arrow keys on the outline

export function AudioContent({ item }: { item: BoardItem }) {
  const { t } = useTranslation("reference");
  const patchItem = useBoard((s) => s.patchItem);
  const state = useAudioPlayer(item.id, item.src);
  const volume = item.volume ?? 1;
  const muted = item.sound === false;
  const loop = !!item.loop;
  const rate = item.speed ?? 1;
  useEffect(() => { audioSettings(item.id, { volume: muted ? 0 : volume, loop, rate }); }, [item.id, volume, muted, loop, rate, item.src]);

  const real = usePeaks(item.ref);
  const fallback = useMemo(() => placeholderPeaks(item.ref || item.id), [item.ref, item.id]);
  const peaks = real ?? fallback;
  const duration = state.duration || item.dur || 0;
  const progress = duration ? Math.min(1, state.time / duration) : 0;
  // Pointer resting over the outline: a hairline and the time it would jump to.
  const [hover, setHover] = useState<number | null>(null);

  // A sound that will not load: a file that moved or was deleted becomes a "missing media" card,
  // with relocation (also in bulk), instead of a card that only says it cannot play. A file that
  // is there but in a format the webview cannot decode keeps the card and says so.
  useEffect(() => {
    if (!state.failed || item.missing || !isCoreFileRef(item.ref) || !nr.reference?.locateMedia) return;
    let alive = true;
    void nr.reference.locateMedia([item.ref], useBoard.getState().filePath || undefined).then((r) => {
      if (!alive) return;
      const moved = r.moves?.[item.ref];
      if (moved) patchItem(item.id, { ref: moved, src: displaySrc("audio", moved) }, false);
      else if (r.dead?.includes(item.ref)) {
        patchItem(item.id, { missing: { name: item.title || item.ref.split(/[\/]/).pop() || "", size: 0, kind: "audio" } }, false);
      }
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [state.failed, item.missing, item.ref, item.id, item.title, patchItem]);

  // Duration learned from the file is written once: it shows on the card before any playback.
  useEffect(() => {
    if (state.duration && Math.abs(state.duration - (item.dur ?? 0)) > 0.5) patchItem(item.id, { dur: state.duration }, false);
  }, [state.duration, item.dur, item.id, patchItem]);

  const ratioAt = (e: RPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return r.width ? Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) : 0;
  };
  const onOutlineDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (duration) seekAudio(item.id, ratioAt(e) * duration);
  };
  const onOutlineMove = (e: RPointerEvent<HTMLDivElement>) => {
    const at = ratioAt(e);
    setHover(at);
    if (e.buttons === 1 && duration) { e.stopPropagation(); seekAudio(item.id, at * duration); }
  };
  const onOutlineKey = (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? SKIP : e.key === "ArrowLeft" ? -SKIP : null;
    if (step != null) { e.preventDefault(); e.stopPropagation(); seekAudio(item.id, state.time + step); }
    else if (e.key === "Home") { e.preventDefault(); e.stopPropagation(); seekAudio(item.id, 0); }
    else if (e.key === " " || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); togglePlay(item.id); }
  };
  const setVolume = (v: number) => patchItem(item.id, { volume: v, sound: v > 0 ? undefined : false });
  const toggleMute = () => patchItem(item.id, { sound: muted ? undefined : false, ...(muted && volume === 0 ? { volume: 1 } : null) });
  const nextSpeed = () => {
    const at = SPEEDS.indexOf(rate as (typeof SPEEDS)[number]);
    const next = SPEEDS[(at + 1) % SPEEDS.length];
    patchItem(item.id, { speed: next === 1 ? undefined : next });
  };

  const title = item.title || item.ref.split(/[\/]/).pop() || t("audio.untitled");
  const playing = state.playing;

  return (
    <div className="flex h-full w-full flex-col gap-2.5 overflow-hidden rounded-[inherit] border border-border bg-card p-3 text-card-foreground">
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          aria-label={playing ? t("audio.pause") : t("audio.play")}
          disabled={state.failed}
          onPointerDown={keep}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); togglePlay(item.id); }}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card [&_svg]:size-5"
        >
          <NetsuIcon name="play-pause" on={playing} />
        </button>
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-sm font-medium leading-tight transition-colors", playing && "text-primary")}>{title}</p>
          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
            {state.failed ? t("audio.unplayable") : `${clock(state.time)} / ${clock(duration)}`}
          </p>
        </div>
        <CardButton label={t("audio.speed")} onClick={nextSpeed} active={rate !== 1} className="w-auto px-1.5 text-xs font-medium tabular-nums">
          {rate}×
        </CardButton>
        <CardButton label={loop ? t("audio.loopOn") : t("audio.loopOff")} active={loop} onClick={() => patchItem(item.id, { loop: !loop || undefined })}>
          <NetsuIcon name="seq-loop-mode" mode={loop ? "loop" : "once"} />
        </CardButton>
        <VolumeControl volume={volume} muted={muted} onVolume={setVolume} onToggleMute={toggleMute} />
      </div>
      <div
        role="slider"
        aria-label={t("audio.position")}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(state.time)}
        aria-valuetext={`${clock(state.time)} / ${clock(duration)}`}
        tabIndex={0}
        onPointerDown={onOutlineDown}
        onPointerMove={onOutlineMove}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onOutlineKey}
        className={cn(
          "relative flex min-h-5 flex-1 cursor-pointer items-center gap-px rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          !real && "opacity-60",
        )}
      >
        {peaks.map((v, i) => {
          const at = (i + 0.5) / peaks.length;
          return (
            <span
              key={i}
              className={cn(
                "min-w-0 flex-1 rounded-full transition-colors",
                at <= progress ? "bg-primary" : hover != null && at <= hover ? "bg-foreground/40" : "bg-foreground/20",
              )}
              style={{ height: `${Math.max(8, Math.round(v * 100))}%` }}
            />
          );
        })}
        {hover != null && duration > 0 && (
          <>
            <span className="pointer-events-none absolute inset-y-0 w-px bg-foreground/70" style={{ left: `${hover * 100}%` }} />
            <span
              className="pointer-events-none absolute top-0 -translate-x-1/2 rounded bg-popover/90 px-1.5 py-0.5 text-xs tabular-nums text-popover-foreground shadow ring-1 ring-foreground/10"
              style={{ left: `${Math.min(92, Math.max(8, hover * 100))}%` }}
            >
              {clock(hover * duration)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// The Inspector row of a selected sound: the same player as the card, at the size of the board's
// other controls whatever the zoom, plus what only makes sense there (open the file, show it in
// its folder).
export function AudioInspectorControls({ item }: { item: BoardItem }) {
  const { t } = useTranslation("reference");
  const patchItem = useBoard((s) => s.patchItem);
  const state = useAudioPlayer(item.id, item.src);
  const [scrub, setScrub] = useState<number | null>(null);
  const volume = item.volume ?? 1;
  const muted = item.sound === false;
  const loop = !!item.loop;
  const rate = item.speed ?? 1;
  const duration = state.duration || item.dur || 0;
  const shown = scrub ?? state.time;
  const local = isCoreFileRef(item.ref);
  const nextSpeed = () => {
    const at = SPEEDS.indexOf(rate as (typeof SPEEDS)[number]);
    const next = SPEEDS[(at + 1) % SPEEDS.length];
    patchItem(item.id, { speed: next === 1 ? undefined : next });
  };
  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger
          render={(
            <Button
              variant="default"
              size="icon-sm"
              className="rounded-full"
              aria-label={state.playing ? t("audio.pause") : t("audio.play")}
              disabled={state.failed}
              onClick={() => togglePlay(item.id)}
            />
          )}
        >
          <NetsuIcon name="play-pause" on={state.playing} />
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={12}>{state.playing ? t("audio.pause") : t("audio.play")}</TooltipContent>
      </Tooltip>
      <span className="w-[5.5rem] shrink-0 text-center text-xs tabular-nums text-muted-foreground">
        {clock(shown)} / {clock(duration)}
      </span>
      {/* Fixed width: a slider sized by its content collapses to its thumb. */}
      <div className="w-44 px-1">
        <Slider
          aria-label={t("audio.position")}
          className="w-full py-2"
          min={0}
          max={Math.max(duration, 0.01)}
          step={0.01}
          disabled={!duration || state.failed}
          value={[Math.min(shown, duration || 0)]}
          onValueChange={(v) => setScrub(Array.isArray(v) ? v[0] : v)}
          onValueCommitted={(v) => { seekAudio(item.id, Array.isArray(v) ? v[0] : v); setScrub(null); }}
        />
      </div>
      <Separator orientation="vertical" className="mx-1 h-6" />
      <Tooltip>
        <TooltipTrigger
          render={<Button variant={rate !== 1 ? "secondary" : "ghost"} size="sm" className="h-8 w-12 px-0 tabular-nums" aria-label={t("audio.speed")} onClick={nextSpeed} />}
        >
          {rate}×
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={12}>{t("audio.speed")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={<Button variant={loop ? "secondary" : "ghost"} size="icon-sm" aria-pressed={loop} aria-label={loop ? t("audio.loopOn") : t("audio.loopOff")} onClick={() => patchItem(item.id, { loop: !loop || undefined })} />}
        >
          <NetsuIcon name="seq-loop-mode" mode={loop ? "loop" : "once"} />
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={12}>{loop ? t("audio.loopOn") : t("audio.loopOff")}</TooltipContent>
      </Tooltip>
      <VolumeControl
        volume={volume}
        muted={muted}
        onVolume={(v) => patchItem(item.id, { volume: v, sound: v > 0 ? undefined : false })}
        onToggleMute={() => patchItem(item.id, { sound: muted ? undefined : false, ...(muted && volume === 0 ? { volume: 1 } : null) })}
      />
      {local && (
        <>
          <Separator orientation="vertical" className="mx-1 h-6" />
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("audio.openFile")} onClick={() => void nr.openPath(item.ref)} />}>
              <NetsuIcon name="open-in-app" />
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={12}>{t("audio.openFile")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("audio.showInFolder")} onClick={() => void nr.revealPath(item.ref)} />}>
              <NetsuIcon name="open-location" />
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={12}>{t("audio.showInFolder")}</TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );
}

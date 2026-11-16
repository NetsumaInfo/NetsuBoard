// Small building blocks of the Animatic timeline: buttons, rows, ruler, waveform, playhead, bars.

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { BoardItem } from "../referenceShared";
import { clipDuration, formatTime, rulerStep, type ClipData } from "./clipModel";
import { useClipPlayer } from "./clipPlayer";

export const LABEL_W = 76;

export function TipButton({ label, onClick, active, disabled, children, className }: {
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

export function MiniButton({ label, onClick, children, active }: { label: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<button type="button" aria-label={label} onClick={onClick} className={cn("rounded p-0.5 hover:bg-foreground/15", active && "bg-foreground/20")} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

export function itemName(it: BoardItem | undefined, t: (k: string) => string): string {
  if (!it) return "—";
  const text = it.title || (it.kind === "text" ? it.text?.split("\n")[0] : "") || "";
  return text.trim().slice(0, 40) || t(`clip.kind.${it.kind}`);
}

// A lane: its name stays pinned on the left while the tracks scroll sideways.
export function Row({ label, width, children }: { label: string; width: number; children: ReactNode }) {
  return (
    <div className="flex items-stretch border-b border-border/50 last:border-b-0">
      <div
        className="sticky left-0 z-20 flex shrink-0 items-center truncate bg-[var(--color-surface)] px-2 text-[11px] font-medium text-muted-foreground"
        style={{ width: LABEL_W }}
      >
        {label}
      </div>
      <div className="relative shrink-0" style={{ width }}>{children}</div>
    </div>
  );
}

// Pointer drag converted to seconds along a track of the given width.
export function useTimeDrag(width: number, dur: number) {
  return useCallback((e: ReactPointerEvent, onMove: (dt: number) => void, onEnd?: () => void) => {
    e.stopPropagation();
    e.preventDefault();
    const x0 = e.clientX;
    const move = (ev: PointerEvent) => onMove(((ev.clientX - x0) / Math.max(1, width)) * dur);
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

export function TimeLabel({ dur }: { dur: number }) {
  const time = useClipPlayer((s) => s.time);
  return <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{formatTime(time)} / {formatTime(dur)}</span>;
}

export function Playhead({ dur, width }: { dur: number; width: number }) {
  const time = useClipPlayer((s) => s.time);
  return (
    <div className="pointer-events-none absolute bottom-0 top-0 z-30 w-px bg-red-500" style={{ left: LABEL_W + (time / dur) * width }}>
      <span className="absolute -left-1 top-0 size-2 rotate-45 bg-red-500" />
    </div>
  );
}

// Seconds along the top, a tick at every step that leaves room for its label.
export function Ruler({ dur, width }: { dur: number; width: number }) {
  const step = rulerStep(width / Math.max(0.001, dur));
  const ticks: number[] = [];
  for (let s = 0; s <= dur + 1e-6; s += step) ticks.push(s);
  return (
    <div className="relative h-6 cursor-text">
      {ticks.map((s) => (
        <div key={s} className="pointer-events-none absolute bottom-0 top-1 border-l border-foreground/25 pl-1 text-[10px] tabular-nums text-muted-foreground" style={{ left: (s / dur) * width }}>
          {formatTime(s).replace(/\.0$/, "")}
        </div>
      ))}
    </div>
  );
}

export function Waveform({ clip, width }: { clip: ClipData; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wave = useClipPlayer((s) => s.wave);
  const peaks = wave && wave.ref === clip.music?.ref ? wave.peaks : null;
  const dur = clipDuration(clip);
  useEffect(() => {
    const c = ref.current;
    if (!c || !width) return;
    const dpr = window.devicePixelRatio || 1;
    const h = 48;
    // Canvas size is capped: a zoomed-in timeline stretches the drawing rather than allocating it.
    const w = Math.min(width, 8000);
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
    c.style.width = `${width}px`;
    c.style.height = `${h}px`;
    const g = c.getContext("2d");
    if (!g) return;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);
    g.fillStyle = getComputedStyle(c).color;
    if (peaks?.length) {
      g.globalAlpha = 0.55;
      for (let x = 0; x < w; x++) {
        const p = peaks[Math.floor((x / w) * peaks.length)] ?? 0;
        const bar = Math.max(1, p * (h - 6));
        g.fillRect(x, (h - bar) / 2, 1, bar);
      }
    }
    if (clip.beats?.length) {
      g.globalAlpha = 0.45;
      g.fillStyle = "#a78bfa";
      for (const b of clip.beats) g.fillRect(Math.round((b / dur) * w), h - 6, 1, 6);
    }
  }, [peaks, width, clip.beats, dur]);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 text-foreground" />;
}

export function Bar({ left, width, label, tone, selected, onSelect, onMove, onLeft, onRight, extra }: {
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
      onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); onSelect(); onMove?.(e); }}
    >
      {onLeft && <span className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-foreground/20 opacity-0 group-hover:opacity-100" onPointerDown={(e) => { e.stopPropagation(); onLeft(e); }} />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100" onPointerDown={(e) => e.stopPropagation()}>{extra}</span>
      {onRight && <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-foreground/20 opacity-0 group-hover:opacity-100" onPointerDown={(e) => { e.stopPropagation(); onRight(e); }} />}
    </div>
  );
}

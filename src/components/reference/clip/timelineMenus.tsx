// Popovers of the Animatic timeline: the transition into a shot, pinning a Long item to the screen,
// and how a video plays inside the Animatic.

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { NumberSpin } from "@/components/ui/number-spin";
import { Button } from "@/components/ui/button";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { BoardItem } from "../referenceShared";
import {
  BPM_MAX, BPM_MIN, DEFAULT_FX_DUR, DEFAULT_GLIDE, FX_DUR_MAX, MIN_SHOT, SPEED_MAX, SPEED_MIN, beatsToSeconds, cutOnBeats, fitSpeed, fxOf, patchShot,
  setFx, setTempo, setVideo, shotsPerItem, tapTempo,
  type ClipData, type FxKind, type PinCorner, type VideoLoop,
} from "./clipModel";

export type Commit = (next: ClipData, tag?: string | null) => void;

export function ShotTransition({ clip, index, readonly, commit }: { clip: ClipData; index: number; readonly: boolean; commit: Commit }) {
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
              onChange={(e) => commit(patchShot(clip, index, { glide: Number(e.target.value) }), "clip-glide")}
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

export function PinMenu({ corner, size, onChange }: { corner: PinCorner | null; size: number; onChange: (pin: { corner: PinCorner; size: number } | null, tag?: string) => void }) {
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
              <input type="range" min={0.08} max={0.6} step={0.01} value={size} onChange={(e) => onChange({ corner, size: Number(e.target.value) }, "clip-pin")} className="flex-1 accent-[#a78bfa]" />
            </label>
            <Button size="sm" variant="ghost" className="mt-1 w-full" onClick={() => onChange(null)}>{t("clip.unpin")}</Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

const FX_KINDS: FxKind[] = ["fade", "zoom", "slide", "cut"];
const FX_ICONS: Record<FxKind, string> = { fade: "eye", zoom: "zoom-in", slide: "move-up", cut: "cut" };

// How the given items appear and leave: effect, duration, opacity. Shows the first item's values;
// a change applies to all of them at once.
export function FxMenu({ clip, ids, commit, compact }: { clip: ClipData; ids: string[]; commit: Commit; compact?: boolean }) {
  const { t } = useTranslation("reference");
  const f = ids.length ? fxOf(clip, ids[0]) : fxOf(clip, "");
  const set = (patch: Parameters<typeof setFx>[2], tag?: string) => commit(setFx(clip, ids, patch), tag);
  const changed = ids.some((id) => clip.fx?.[id]);
  const trigger = compact
    ? <button type="button" aria-label={t("clip.fx")} className={cn("rounded p-0.5 hover:bg-foreground/15", changed && "bg-foreground/20")} />
    : <Button variant="ghost" size="sm" className="gap-1.5" disabled={!ids.length} />;
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger render={<PopoverTrigger render={trigger} />}>
          <NetsuIcon name="sparkles" className={compact ? "size-3" : undefined} />
          {!compact && t("clip.fx")}
        </TooltipTrigger>
        <TooltipContent side="top">{ids.length > 1 ? t("clip.fxMany", { count: ids.length }) : t("clip.fxHint")}</TooltipContent>
      </Tooltip>
      <PopoverContent side="top" className="w-64 space-y-3 p-2.5 text-[11px]">
        <div className="space-y-1">
          <div className="text-muted-foreground">{ids.length > 1 ? t("clip.fxMany", { count: ids.length }) : t("clip.fxKind")}</div>
          <div className="grid grid-cols-4 gap-1">
            {FX_KINDS.map((k) => (
              <Button key={k} size="sm" variant={f.kind === k ? "default" : "ghost"} className="h-auto flex-col gap-0.5 py-1.5" onClick={() => set({ kind: k })}>
                <NetsuIcon name={FX_ICONS[k]} />
                <span className="text-[10px]">{t(`clip.fxKinds.${k}`)}</span>
              </Button>
            ))}
          </div>
        </div>
        <label className="block space-y-1">
          <span className="flex justify-between text-muted-foreground">
            <span>{t("clip.fxDuration")}</span>
            <span className="tabular-nums text-foreground">{f.kind === "cut" ? "—" : `${f.dur.toFixed(2)} s`}</span>
          </span>
          <input
            type="range" min={0.05} max={FX_DUR_MAX} step={0.05} value={f.dur} disabled={f.kind === "cut"}
            onChange={(e) => set({ dur: Number(e.target.value) }, "clip-fx-dur")}
            className="w-full accent-[#a78bfa] disabled:opacity-40"
          />
        </label>
        <label className="block space-y-1">
          <span className="flex justify-between text-muted-foreground">
            <span>{t("clip.fxOpacity")}</span>
            <span className="tabular-nums text-foreground">{Math.round(f.opacity * 100)} %</span>
          </span>
          <input
            type="range" min={0.05} max={1} step={0.05} value={f.opacity}
            onChange={(e) => set({ opacity: Number(e.target.value) }, "clip-fx-opacity")}
            className="w-full accent-[#a78bfa]"
          />
        </label>
        {changed && (
          <Button size="sm" variant="ghost" className="w-full" onClick={() => set({ kind: "fade", dur: DEFAULT_FX_DUR, opacity: 1 })}>
            {t("clip.fxReset")}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

// Fast blocking: one shot per selected item from the playhead, or a cut every n beats.
export function BlockMenu({ clip, commit, picked, time, readonly }: {
  clip: ClipData; commit: Commit; picked: { id: string; box: { x: number; y: number; w: number; h: number } }[];
  time: () => number; readonly: boolean;
}) {
  const { t } = useTranslation("reference");
  const tempo = !!clip.bpm;
  const steps = tempo ? [2, 4, 8] : [1, 2, 4];
  const seconds = (n: number) => (tempo ? beatsToSeconds(clip, n)! : n);
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="sm" className="gap-1.5" disabled={readonly} />}>
        <NetsuIcon name="shots-from-items" /> {t("clip.block")}
      </PopoverTrigger>
      <PopoverContent side="top" className="w-72 space-y-3 p-2.5 text-[11px]">
        <section className="space-y-1.5">
          <div className="font-medium text-foreground">{t("clip.perItem")}</div>
          <p className="text-muted-foreground">
            {picked.length ? t("clip.perItemHint", { count: picked.length }) : t("clip.perItemNeedsSelection")}
          </p>
          <div className="flex gap-1">
            {steps.map((n) => (
              <Button
                key={n} size="sm" variant="outline" className="flex-1" disabled={!picked.length}
                onClick={() => commit(shotsPerItem(clip, time(), picked, seconds(n)))}
              >
                {t(tempo ? "clip.everyBeats" : "clip.everySeconds", { count: n })}
              </Button>
            ))}
          </div>
        </section>
        <section className="space-y-1.5">
          <div className="font-medium text-foreground">{t("clip.cutOnBeats")}</div>
          <p className="text-muted-foreground">{clip.beats?.length ? t("clip.cutOnBeatsHint") : t("clip.needsBeats")}</p>
          <div className="flex gap-1">
            {[4, 8, 16].map((n) => (
              <Button key={n} size="sm" variant="outline" className="flex-1" disabled={!clip.beats?.length} onClick={() => commit(cutOnBeats(clip, n))}>
                {t("clip.everyBeats", { count: n })}
              </Button>
            ))}
          </div>
        </section>
      </PopoverContent>
    </Popover>
  );
}

const LOOPS: VideoLoop[] = ["loop", "pingpong", "once"];

export function VideoMenu({ clip, item, bar, commit }: { clip: ClipData; item: BoardItem; bar: number; commit: Commit }) {
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
            onChange={(e) => commit(setVideo(clip, item.id, { speed: Math.round(Math.pow(2, Number(e.target.value)) * 100) / 100 }), "clip-speed")}
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
                <NetsuIcon name={`seq-loop-mode-${l}`} /> {t(`clip.loops.${l}`)}
              </Button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Tempo of the track by hand, for when detection misses: type it, tap it, halve or double it, put
// the first beat under the playhead, or go back to what was detected.
export function TempoMenu({ clip, commit, readonly, time, playing, onDetect }: {
  clip: ClipData; commit: Commit; readonly: boolean; time: () => number; playing: boolean; onDetect: () => void;
}) {
  const { t } = useTranslation("reference");
  const taps = useRef<number[]>([]);
  const [tapCount, setTapCount] = useState(0);
  const bpm = clip.bpm ?? null;
  const anchor = clip.beats?.[0] ?? 0;
  const apply = (b: number, at = anchor, tag: string | null = null) => commit(setTempo(clip, b, at), tag);
  const tap = () => {
    const now = performance.now() / 1000;
    const prev = taps.current;
    // A pause of two seconds starts a new count.
    taps.current = prev.length && now - prev[prev.length - 1] > 2 ? [now] : [...prev, now].slice(-12);
    setTapCount(taps.current.length);
    const found = tapTempo(taps.current);
    // While the music plays, the last tap is a beat: the grid lines up on it.
    if (found) apply(found, playing ? time() : anchor, "clip-tempo");
  };
  return (
    <Popover onOpenChange={(open) => { if (!open) { taps.current = []; setTapCount(0); } }}>
      <Tooltip>
        <TooltipTrigger render={<PopoverTrigger render={<Button variant="ghost" size="sm" className="shrink-0 gap-1.5 tabular-nums" disabled={readonly} />} />}>
          <NetsuIcon name="tempo" />
          {bpm ? t("clip.bpmValue", { bpm: Math.round(bpm) }) : t("clip.tempo")}
        </TooltipTrigger>
        <TooltipContent side="top">{t("clip.tempoHint")}</TooltipContent>
      </Tooltip>
      <PopoverContent side="top" className="w-64 space-y-2.5 p-2.5 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{t("clip.tempo")}</span>
          <NumberSpin
            value={bpm ?? 120} min={BPM_MIN} max={BPM_MAX} step={0.1} ariaLabel={t("clip.tempo")}
            className="h-7 w-20" onCommit={(v) => apply(v)}
          />
          <span className="text-muted-foreground">BPM</span>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" className="px-2" disabled={!bpm} onClick={() => bpm && apply(bpm / 2)}>÷2</Button>
          <Button size="sm" variant="ghost" className="px-2" disabled={!bpm} onClick={() => bpm && apply(bpm * 2)}>×2</Button>
        </div>
        <Button variant="outline" className="h-12 w-full flex-col gap-0" onClick={tap}>
          <span className="text-sm font-medium">{t("clip.tap")}</span>
          <span className="text-[10px] text-muted-foreground">{tapCount ? t("clip.tapCount", { count: tapCount }) : t("clip.tapHint")}</span>
        </Button>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" className="flex-1" disabled={!bpm} onClick={() => bpm && apply(bpm, time())}>{t("clip.beatHere")}</Button>
          <Button size="sm" variant="ghost" className="flex-1" disabled={!clip.music} onClick={onDetect}>{t("clip.detectTempo")}</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

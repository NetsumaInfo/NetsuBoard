// Popovers of the Animatic timeline: the transition into a shot, pinning a Long item to the screen,
// and how a video plays inside the Animatic.

import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { BoardItem } from "../referenceShared";
import {
  DEFAULT_GLIDE, MIN_SHOT, SPEED_MAX, SPEED_MIN, fitSpeed, patchShot, setVideo,
  type ClipData, type PinCorner, type VideoLoop,
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
                <NetsuIcon name={`seq-loop-mode-${l}`} /> {t(`clip.loop.${l}`)}
              </Button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

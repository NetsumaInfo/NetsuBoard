// Volume of a sound or a video, the way a media player does it: a press on the speaker mutes or
// unmutes, resting the pointer on it opens a panel with the slider and the level. The wheel only
// acts INSIDE that panel: over the speaker it stays the board's zoom, which silently turned the
// sound down to zero while one was zooming past.
// Used by the audio card and the Inspector of a video.

import { useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from "react";
import { useTranslation } from "react-i18next";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import { PopoverContent } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

// The board takes a press on an item as the start of a move; the popup is portalled but React
// still bubbles its events to the item, so both parts keep the pointer to themselves.
const keep = (e: RPointerEvent) => e.stopPropagation();
const STEP = 0.05;

export function VolumeControl({ volume, muted, onVolume, onToggleMute, className, side = "top" }: {
  volume: number;
  muted: boolean;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
  className?: string;
  side?: "top" | "bottom";
}) {
  const { t } = useTranslation("reference");
  const [open, setOpen] = useState(false);
  const level = muted ? 0 : volume;
  const silent = muted || volume === 0;
  const wheel = (e: RWheelEvent) => {
    e.stopPropagation();
    onVolume(Math.round(Math.min(1, Math.max(0, level + (e.deltaY < 0 ? STEP : -STEP))) * 100) / 100);
  };
  const muteLabel = silent ? t("audio.unmute") : t("audio.mute");
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger
        openOnHover
        delay={100}
        closeDelay={300}
        render={(
          <button
            type="button"
            aria-label={muteLabel}
            onPointerDown={keep}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onToggleMute(); }}
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4",
              open && "bg-muted text-foreground",
              className,
            )}
          />
        )}
      >
        <NetsuIcon name="mute" on={silent} />
      </PopoverPrimitive.Trigger>
      <PopoverContent side={side} sideOffset={8} className="w-auto p-2" onPointerDown={keep} onWheel={wheel}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={muteLabel}
            onClick={onToggleMute}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4"
          >
            <NetsuIcon name="mute" on={silent} />
          </button>
          {/* Fixed width: a slider sized by its content collapses to its thumb. */}
          <div className="w-40 px-1.5">
            <Slider
              aria-label={t("audio.volume")}
              className="w-full py-2"
              min={0}
              max={1}
              step={0.01}
              value={[level]}
              onValueChange={(v) => onVolume(Array.isArray(v) ? v[0] : v)}
            />
          </div>
          <span className="w-12 shrink-0 whitespace-nowrap pr-1 text-right text-sm tabular-nums text-foreground">
            {Math.round(level * 100)} %
          </span>
        </div>
      </PopoverContent>
    </PopoverPrimitive.Root>
  );
}

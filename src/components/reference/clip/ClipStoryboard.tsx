// Storyboard: the shots of the Animatic as cards, each with what its camera sees, read like a comic
// strip. Click to go to a shot, double-click its name to rename it, drag a card (or Ctrl+← →) to
// reorder (the time slots stay; the content moves), drop mood board items on a card to put them in
// that shot.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import type { BoardItem } from "../referenceShared";
import {
  cameraMoveOf, deleteShot, duplicateShot, formatTime, moveShot, shotEnd, type ClipData,
} from "./clipModel";
import { seek, useClipPlayer } from "./clipPlayer";
import { dropOnShot, isAnimaticDrag, readDrag } from "./clipDnd";
import { useShotThumb } from "./shotThumbs";
import { MiniButton } from "./timelineParts";
import { copyShot } from "./clipClipboard";
import type { Commit } from "./timelineMenus";

const SHOT_MIME = "application/x-netsu-shot";
const MOVE_ICON: Record<string, string> = { static: "framing", zoomIn: "zoom-in", zoomOut: "zoom-out", panLeft: "back", panRight: "forward" };

export function ClipStoryboard({ clip, items, readonly, commit, shotAtHead }: {
  clip: ClipData; items: BoardItem[]; readonly: boolean; commit: Commit; shotAtHead: number;
}) {
  const [over, setOver] = useState<number | null>(null);
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-3 p-3">
      {clip.shots.map((s, i) => (
        <ShotCard
          key={s.id}
          clip={clip}
          index={i}
          items={items}
          current={i === shotAtHead}
          over={over === i}
          readonly={readonly}
          commit={commit}
          onOver={setOver}
        />
      ))}
    </div>
  );
}

function ShotCard({ clip, index, items, current, over, readonly, commit, onOver }: {
  clip: ClipData; index: number; items: BoardItem[]; current: boolean; over: boolean; readonly: boolean;
  commit: Commit; onOver: (i: number | null) => void;
}) {
  const { t } = useTranslation("reference");
  const s = clip.shots[index];
  const thumb = useShotThumb(clip, index, items, 320);
  const [renaming, setRenaming] = useState(false);
  const end = shotEnd(clip, index);
  const progress = useClipPlayerTime(s.start, end);
  const move = cameraMoveOf(s);
  const name = s.label || t("clip.shotN", { n: index + 1 });

  return (
    <div
      draggable={!readonly && !renaming}
      onDragStart={(e) => { e.dataTransfer.setData(SHOT_MIME, String(index)); e.dataTransfer.effectAllowed = "move"; }}
      onDragOver={(e) => {
        if (readonly) return;
        if (e.dataTransfer.types.includes(SHOT_MIME) || isAnimaticDrag(e.dataTransfer)) { e.preventDefault(); onOver(index); }
      }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) onOver(null); }}
      onKeyDown={(e) => {
        if (readonly || renaming || !(e.ctrlKey || e.metaKey) || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
        e.preventDefault();
        e.stopPropagation();
        commit(moveShot(clip, index, index + (e.key === "ArrowLeft" ? -1 : 1)));
      }}
      onDrop={(e) => {
        onOver(null);
        if (readonly) return;
        const ids = readDrag(e.dataTransfer);
        if (ids) { e.preventDefault(); dropOnShot(ids, s.start); return; }
        const from = Number(e.dataTransfer.getData(SHOT_MIME));
        if (Number.isFinite(from) && e.dataTransfer.types.includes(SHOT_MIME)) {
          e.preventDefault();
          commit(moveShot(clip, from, index));
        }
      }}
      className={cn(
        "group relative flex cursor-grab flex-col overflow-hidden rounded-lg border bg-background text-left transition-colors active:cursor-grabbing",
        current ? "border-[#a78bfa] ring-1 ring-[#a78bfa]" : "border-border hover:border-foreground/30",
        over && "border-dashed border-primary ring-2 ring-primary/50",
      )}
    >
      <button type="button" className="relative block aspect-video w-full bg-black" onClick={() => seek(s.start + 0.001)} aria-label={name}>
        {thumb ? <img src={thumb} alt="" draggable={false} className="size-full object-cover" /> : <span className="absolute inset-0 animate-pulse bg-muted/30" />}
        <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 text-[11px] font-semibold tabular-nums text-white">{index + 1}</span>
        {index > 0 && (
          <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
            <NetsuIcon name={s.transition === "glide" ? "glide" : "cut"} className="size-3" />
            {t(s.transition === "glide" ? "clip.glide" : "clip.cutTransition")}
          </span>
        )}
        {move && move !== "static" && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 p-0.5 text-white">
            <NetsuIcon name={MOVE_ICON[move]} className="size-3" />
          </span>
        )}
      </button>
      <div className="flex items-center gap-1 px-2 py-1.5">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              autoFocus
              defaultValue={s.label ?? ""}
              placeholder={t("clip.shotN", { n: index + 1 })}
              aria-label={t("clip.rename")}
              className="w-full rounded bg-muted px-1 text-xs outline-none ring-1 ring-primary"
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenaming(false); }}
              onBlur={(e) => {
                setRenaming(false);
                const label = e.target.value.trim();
                commit({ ...clip, shots: clip.shots.map((x, k) => (k === index ? { ...x, label: label || undefined } : x)) });
              }}
            />
          ) : (
            <button type="button" className="block w-full truncate text-left text-xs font-medium" onDoubleClick={() => !readonly && setRenaming(true)} onClick={() => seek(s.start + 0.001)}>
              {name}
            </button>
          )}
          <div className="truncate text-[10px] tabular-nums text-muted-foreground">
            {formatTime(s.start)} – {formatTime(end)} · {t("clip.itemCount", { count: s.items.length })}
          </div>
        </div>
        {!readonly && (
          <span className="flex shrink-0 gap-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            <MiniButton label={t("clip.copyShot")} onClick={() => copyShot(index, name)}>
              <NetsuIcon name="copy-clipboard" className="size-3.5" />
            </MiniButton>
            <MiniButton label={t("clip.duplicateShot")} onClick={() => commit(duplicateShot(clip, index))}>
              <NetsuIcon name="duplicate" className="size-3.5" />
            </MiniButton>
            {clip.shots.length > 1 && (
              <MiniButton label={t("clip.deleteShot")} onClick={() => commit(deleteShot(clip, index))}>
                <NetsuIcon name="delete" className="size-3.5" />
              </MiniButton>
            )}
          </span>
        )}
      </div>
      <div className="h-0.5 bg-[#a78bfa]/60" style={{ width: `${Math.min(100, progress * 100)}%` }} />
    </div>
  );
}

// Progress of the playhead inside a shot, 0 outside it.
function useClipPlayerTime(start: number, end: number): number {
  return useClipPlayer((st) => (st.time >= start && st.time < end ? (st.time - start) / (end - start) : 0));
}

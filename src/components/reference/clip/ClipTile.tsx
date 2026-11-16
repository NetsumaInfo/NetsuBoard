// Closed clip on the mood board: a poster (the first shot), name, duration and shot count. Moving
// the mouse across the card scrubs through the shots' posters — stills only, no playback. The play
// button opens the clip straight into Present.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBoard } from "../useReferenceBoard";
import { folderChildren } from "../boardFolders";
import type { BoardItem } from "../referenceShared";
import { clipDuration, formatTime } from "./clipModel";
import { readClip } from "./clipSelectors";
import { startPresent } from "./clipPlayer";

// Poster of a shot: its first image (in paint order), else nothing.
function posters(item: BoardItem, children: BoardItem[]): string[] {
  const clip = readClip(item.clip);
  if (!clip) return [];
  const byId = new Map(children.map((c) => [c.id, c]));
  const visual = (c: BoardItem | undefined) => !!c && c.kind === "image" && !!c.src && !c.missing;
  return clip.shots.map((s) => {
    const first = s.items.map((si) => byId.get(si.id)).filter(visual).sort((a, b) => a!.z - b!.z)[0];
    return first?.src ?? "";
  });
}

export function ClipTile({ item }: { item: BoardItem }) {
  const { t } = useTranslation("reference");
  const color = item.color ?? "#a78bfa";
  const shots = useBoard(useShallow((s) => posters(item, folderChildren(item.id, s.stash))));
  const fallback = useBoard((s) => folderChildren(item.id, s.stash).find((c) => c.kind === "image" && c.src && !c.missing)?.src ?? "");
  const clip = useMemo(() => readClip(item.clip), [item.clip]);
  const [hover, setHover] = useState<number | null>(null);
  const poster = (hover != null ? shots[hover] : shots[0]) || shots.find(Boolean) || fallback;
  const label = item.text || t("clip.defaultName");
  const count = clip?.shots.length ?? 0;

  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-xl shadow-lg"
      style={{
        border: `2px solid color-mix(in srgb, ${color} 80%, transparent)`,
        background: `color-mix(in srgb, ${color} 14%, var(--color-surface))`,
      }}
      onPointerMove={(e) => {
        if (!count) return;
        const r = e.currentTarget.getBoundingClientRect();
        const k = Math.min(count - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * count)));
        if (k !== hover) setHover(k);
      }}
      onPointerLeave={() => setHover(null)}
    >
      {poster ? (
        <img src={poster} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
      ) : (
        <span className="pointer-events-none absolute left-1/2 top-[40%] -translate-x-1/2 -translate-y-1/2 opacity-40" style={{ color }}>
          <NetsuIcon name="music" className="size-16" />
        </span>
      )}
      {hover != null && count > 1 && (
        <div className="pointer-events-none absolute inset-x-3 top-2 flex gap-0.5">
          {Array.from({ length: count }, (_, i) => (
            <span key={i} className={`h-1 flex-1 rounded-full ${i === hover ? "bg-white" : "bg-white/35"}`} />
          ))}
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/85 to-transparent px-3 pb-2 pt-10 text-white">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 truncate font-medium" style={{ fontSize: item.fontSize ?? 14, fontFamily: item.fontFamily }}>
            <NetsuIcon name="music" className="size-3.5 shrink-0" />
            <span className="truncate">{label}</span>
          </div>
          <div className="truncate text-xs opacity-80">
            {clip ? `${formatTime(clipDuration(clip))} · ${t("clip.shotCount", { count })}` : null}
            {clip?.music?.name ? ` · ${clip.music.name}` : ""}
          </div>
        </div>
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={t("clip.present")}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                useBoard.getState().enterFolder(item.id);
                startPresent();
              }}
              className="absolute bottom-2 right-2 flex size-8 items-center justify-center rounded-full bg-white/90 text-black shadow transition-transform hover:scale-105"
            />
          }
        >
          <NetsuIcon name="seq-play" className="size-4" />
        </TooltipTrigger>
        <TooltipContent>{t("clip.present")}</TooltipContent>
      </Tooltip>
    </div>
  );
}

// Mood board panel inside a clip: the items of the board the clip lives in, to copy into the clip
// without leaving it. A copy lands at the centre of the screen and joins the shot under the
// playhead; the mood board keeps its original.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBoard } from "../useReferenceBoard";
import { topZ, uid, type BoardItem } from "../referenceShared";
import { openClipId } from "./clipSelectors";
import { useClipPlayer, viewCentre } from "./clipPlayer";

// Items of the level the open clip sits on. The top level's items carry no `parent`.
function parentLevelItems(s: { stash: BoardItem[]; folderPath: { id: string }[] }): BoardItem[] {
  const parent = s.folderPath.length >= 2 ? s.folderPath[s.folderPath.length - 2].id : null;
  return s.stash.filter((it) => (it.parent ?? null) === parent && it.kind !== "draw" && !it.folder);
}

function copyIntoClip(src: BoardItem) {
  const c = viewCentre();
  const { parent: _p, ...rest } = src;
  const z = topZ(useBoard.getState().items) + 1;
  useBoard.getState().addItems([{ ...rest, id: uid(), x: c.x - src.w / 2, y: c.y - src.h / 2, z }]);
}

export function ClipLibrary() {
  const { t } = useTranslation("reference");
  const open = useClipPlayer((s) => s.library && !s.presenting);
  const inClip = useBoard((s) => !!openClipId(s));
  const pool = useBoard(useShallow((s) => (inClip && open ? parentLevelItems(s) : [])));
  const sorted = useMemo(() => [...pool].sort((a, b) => a.y - b.y || a.x - b.x), [pool]);
  if (!open || !inClip) return null;
  return (
    <div className="absolute bottom-2 left-2 top-14 z-40 flex w-52 flex-col overflow-hidden rounded-lg border border-border bg-[var(--color-surface)] shadow-lg">
      <div className="flex h-9 items-center gap-1 border-b border-border px-2 text-xs font-medium">
        <NetsuIcon name="gallery" className="size-3.5" />
        <span className="flex-1 truncate">{t("clip.library")}</span>
        <Button variant="ghost" size="icon-xs" aria-label={t("common:action.close")} onClick={() => useClipPlayer.setState({ library: false })}>
          <NetsuIcon name="close" />
        </Button>
      </div>
      <div className="grid flex-1 grid-cols-2 content-start gap-1.5 overflow-y-auto p-1.5">
        {sorted.length === 0 && <p className="col-span-2 p-2 text-center text-[11px] text-muted-foreground">{t("clip.libraryEmpty")}</p>}
        {sorted.map((it) => (
          <Tooltip key={it.id}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={t("clip.libraryAdd")}
                  onClick={() => copyIntoClip(it)}
                  className="group relative aspect-square overflow-hidden rounded-md border border-border bg-muted/50 hover:border-primary"
                />
              }
            >
              <LibraryThumb item={it} />
              <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                <NetsuIcon name="add" className="size-5 text-white" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="right">{t("clip.libraryAdd")}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

function LibraryThumb({ item }: { item: BoardItem }) {
  if (item.kind === "image" && item.src) return <img src={item.src} alt="" draggable={false} className="h-full w-full object-cover" />;
  if (item.kind === "palette" && item.colors?.length) {
    return <span className="flex h-full w-full">{item.colors.map((c, i) => <span key={i} className="h-full flex-1" style={{ background: c }} />)}</span>;
  }
  const icon = item.kind === "video" || item.kind === "youtube" ? "video" : item.kind === "audio" ? "music" : item.kind === "text" ? "note" : item.kind === "sequence" ? "add-sequence" : "image";
  return (
    <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-muted-foreground">
      <NetsuIcon name={icon} className="size-5" />
      {(item.title || item.text) && <span className="line-clamp-2 text-center text-[10px] leading-tight">{item.title || item.text}</span>}
    </span>
  );
}

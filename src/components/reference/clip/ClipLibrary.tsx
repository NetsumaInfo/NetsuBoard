// Mood board panel inside an Animatic: the items of the board the Animatic lives in, as a list to
// search and filter. A click copies the item into the Animatic, at the centre of the screen and in
// the shot under the playhead; the mood board keeps its original. A sound can instead become the
// Animatic's music.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBoard } from "../useReferenceBoard";
import { topZ, uid, type BoardItem } from "../referenceShared";
import { openClipId, openClipRaw } from "./clipSelectors";
import { setClipMusic, useClipPlayer, viewCentre } from "./clipPlayer";
import { itemName } from "./timelineParts";

type Filter = "all" | "image" | "video" | "audio" | "text";
const FILTERS: Filter[] = ["all", "image", "video", "audio", "text"];

const groupOf = (it: BoardItem): Filter =>
  it.kind === "image" || it.kind === "sequence" || it.kind === "palette" ? "image"
  : it.kind === "video" || it.kind === "youtube" || it.kind === "embed" ? "video"
  : it.kind === "audio" ? "audio"
  : "text";

const ICONS: Record<string, string> = {
  image: "image", sequence: "add-sequence", palette: "palette", video: "video", youtube: "video",
  embed: "link", audio: "music", text: "note", frame: "frame",
};

// Items of the level the open Animatic sits on. The top level's items carry no `parent`.
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
  const musicRef = useBoard((s) => openClipRaw(s)?.music?.ref ?? "");
  const pool = useBoard(useShallow((s) => (inClip && open ? parentLevelItems(s) : [])));
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: pool.length, image: 0, video: 0, audio: 0, text: 0 };
    for (const it of pool) c[groupOf(it)]++;
    return c;
  }, [pool]);
  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return pool
      .filter((it) => filter === "all" || groupOf(it) === filter)
      .filter((it) => !q || `${it.title ?? ""} ${it.text ?? ""}`.toLocaleLowerCase().includes(q))
      .sort((a, b) => a.y - b.y || a.x - b.x);
  }, [pool, filter, query]);
  if (!open || !inClip) return null;

  return (
    <aside
      aria-label={t("clip.library")}
      className="absolute bottom-2 left-2 top-14 z-40 flex w-72 flex-col overflow-hidden rounded-lg border border-border bg-[var(--color-surface)] shadow-lg"
    >
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border pl-3 pr-1.5 text-sm font-medium">
        <NetsuIcon name="gallery" className="size-4" />
        <span className="flex-1 truncate">{t("clip.library")}</span>
        <Button variant="ghost" size="icon-sm" aria-label={t("common:action.close")} onClick={() => useClipPlayer.setState({ library: false })}>
          <NetsuIcon name="close" />
        </Button>
      </div>
      <div className="shrink-0 space-y-2 border-b border-border p-2">
        <label className="flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2 focus-within:border-primary">
          <NetsuIcon name="search" className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder={t("clip.librarySearch")}
            aria-label={t("clip.librarySearch")}
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </label>
        <div className="flex flex-wrap gap-1" role="group" aria-label={t("clip.libraryFilter")}>
          {FILTERS.filter((f) => f === "all" || counts[f] > 0).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "h-6 rounded-full border px-2 text-[11px] tabular-nums transition-colors",
                filter === f ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {t(`clip.filter.${f}`)} {counts[f]}
            </button>
          ))}
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1">
        {shown.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-muted-foreground">
            {pool.length ? t("clip.libraryNoMatch") : t("clip.libraryEmpty")}
          </li>
        )}
        {shown.map((it) => (
          <LibraryRow key={it.id} item={it} isMusic={it.kind === "audio" && it.ref === musicRef} />
        ))}
      </ul>
      <p className="shrink-0 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">{t("clip.libraryHint")}</p>
    </aside>
  );
}

function LibraryRow({ item, isMusic }: { item: BoardItem; isMusic: boolean }) {
  const { t } = useTranslation("reference");
  const name = itemName(item, t);
  const full = (item.title || item.text || name).trim();
  return (
    <li className="group flex items-center gap-1 rounded-md pr-1 hover:bg-muted focus-within:bg-muted">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={() => copyIntoClip(item)}
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-1.5 text-left focus-visible:outline-2 focus-visible:outline-primary"
            />
          }
        >
          <Thumb item={item} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs text-foreground">{name}</span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {isMusic ? t("clip.isMusic") : t(`clip.kind.${item.kind}`)}
            </span>
          </span>
          <NetsuIcon name="add" className="size-4 shrink-0 text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100" />
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-64">{full.length > name.length ? full : t("clip.libraryAdd")}</TooltipContent>
      </Tooltip>
      {item.kind === "audio" && item.ref && !isMusic && (
        <Button
          variant="outline"
          size="xs"
          className="shrink-0 gap-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
          onClick={() => void setClipMusic(item.ref, item.title)}
        >
          <NetsuIcon name="music" /> {t("clip.useAsMusic")}
        </Button>
      )}
    </li>
  );
}

function Thumb({ item }: { item: BoardItem }) {
  const box = "flex size-9 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-background";
  if (item.kind === "image" && item.src && !item.missing) {
    return <span className={box}><img src={item.src} alt="" draggable={false} className="size-full object-cover" /></span>;
  }
  if (item.kind === "palette" && item.colors?.length) {
    return <span className={box}>{item.colors.slice(0, 5).map((c, i) => <span key={i} className="h-full flex-1" style={{ background: c }} />)}</span>;
  }
  return (
    <span className={cn(box, "text-muted-foreground")}>
      <NetsuIcon name={ICONS[item.kind] ?? "image"} className="size-4" />
    </span>
  );
}

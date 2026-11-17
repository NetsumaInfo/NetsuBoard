// Mood board panel inside an Animatic: the items of the board the Animatic lives in, as a list to
// search, filter and select. Drag the selection onto the board, onto a shot or onto the Long lane;
// double-click or the footer buttons copy it into the shot under the playhead. A sound can instead
// become the Animatic's music. The mood board always keeps its originals.

import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBoard } from "../useReferenceBoard";
import type { BoardItem } from "../referenceShared";
import { knownThumb } from "../boardImageLod";
import { posterTime } from "../boardVideoLod";
import { openClipId, openClipRaw } from "./clipSelectors";
import { setClipMusic, useClipPlayer } from "./clipPlayer";
import { ANIMATIC_MIME, copyIntoAnimatic, dropOnLong, parentLevelItems } from "./clipDnd";
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

export function ClipLibrary() {
  const { t } = useTranslation("reference");
  const open = useClipPlayer((s) => s.library && !s.presenting);
  const inClip = useBoard((s) => !!openClipId(s));
  const musicRef = useBoard((s) => openClipRaw(s)?.music?.ref ?? "");
  const pool = useBoard(useShallow((s) => (inClip && open ? parentLevelItems(s) : [])));
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const anchor = useRef<number>(-1);
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

  const chosen = shown.filter((it) => picked.has(it.id)).map((it) => it.id);
  const click = (e: React.MouseEvent, index: number) => {
    const id = shown[index].id;
    if (e.shiftKey && anchor.current >= 0) {
      const [a, b] = [Math.min(anchor.current, index), Math.max(anchor.current, index)];
      setPicked(new Set([...picked, ...shown.slice(a, b + 1).map((it) => it.id)]));
      return;
    }
    anchor.current = index;
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(picked);
      if (next.has(id)) next.delete(id); else next.add(id);
      setPicked(next);
    } else setPicked(new Set([id]));
  };
  const dragStart = (e: React.DragEvent, id: string) => {
    // Dragging an unselected row drags it alone.
    const ids = picked.has(id) ? chosen : [id];
    if (!picked.has(id)) setPicked(new Set([id]));
    e.dataTransfer.setData(ANIMATIC_MIME, JSON.stringify(ids));
    e.dataTransfer.setData("text/plain", ids.map((x) => itemName(pool.find((it) => it.id === x), t)).join("\n"));
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <aside
      aria-label={t("clip.library")}
      className="absolute bottom-2 left-2 top-14 z-40 flex w-72 flex-col overflow-hidden rounded-lg border border-border bg-[var(--color-surface)] shadow-lg"
      onKeyDown={(e) => {
        e.stopPropagation();
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") { e.preventDefault(); setPicked(new Set(shown.map((it) => it.id))); }
        if (e.key === "Escape") setPicked(new Set());
        if (e.key === "Enter" && chosen.length) copyIntoAnimatic(chosen);
      }}
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
      <ul role="listbox" aria-multiselectable aria-label={t("clip.library")} className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1">
        {shown.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-muted-foreground">
            {pool.length ? t("clip.libraryNoMatch") : t("clip.libraryEmpty")}
          </li>
        )}
        {shown.map((it, i) => (
          <LibraryRow
            key={it.id}
            item={it}
            selected={picked.has(it.id)}
            isMusic={it.kind === "audio" && it.ref === musicRef}
            onClick={(e) => click(e, i)}
            onAdd={() => copyIntoAnimatic(picked.has(it.id) ? chosen : [it.id])}
            onDragStart={(e) => dragStart(e, it.id)}
          />
        ))}
      </ul>
      <div className="shrink-0 border-t border-border p-2">
        {chosen.length ? (
          <div className="flex items-center gap-1">
            <span className="flex-1 truncate text-xs tabular-nums">{t("clip.libraryPicked", { count: chosen.length })}</span>
            <Button size="xs" className="gap-1" onClick={() => copyIntoAnimatic(chosen)}>
              <NetsuIcon name="add" /> {t("clip.libraryToShot")}
            </Button>
            <Button size="xs" variant="outline" className="gap-1" onClick={() => dropOnLong(chosen)}>
              <NetsuIcon name="lane-long" /> {t("clip.long")}
            </Button>
            <Button size="icon-xs" variant="ghost" aria-label={t("clip.libraryClear")} onClick={() => setPicked(new Set())}>
              <NetsuIcon name="close" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2">
            {shown.length > 1 && (
              <Button size="xs" variant="ghost" onClick={() => setPicked(new Set(shown.map((it) => it.id)))}>{t("clip.librarySelectAll")}</Button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function LibraryRow({ item, selected, isMusic, onClick, onAdd, onDragStart }: {
  item: BoardItem; selected: boolean; isMusic: boolean;
  onClick: (e: React.MouseEvent) => void; onAdd: () => void; onDragStart: (e: React.DragEvent) => void;
}) {
  const { t } = useTranslation("reference");
  const name = itemName(item, t);
  const full = (item.title || item.text || name).trim();
  return (
    <li
      role="option"
      aria-selected={selected}
      tabIndex={0}
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      onDoubleClick={onAdd}
      onKeyDown={(e) => { if (e.key === " ") { e.preventDefault(); onClick(e as unknown as React.MouseEvent); } }}
      className={cn(
        "group flex cursor-grab items-center gap-2.5 rounded-md p-1.5 outline-none active:cursor-grabbing",
        selected ? "bg-primary/15 ring-1 ring-primary/60" : "hover:bg-muted focus-visible:bg-muted",
        "focus-visible:ring-2 focus-visible:ring-primary",
      )}
    >
      <Preview item={item} />
      <Tooltip>
        <TooltipTrigger render={<span className="min-w-0 flex-1" />}>
          <span className="block truncate text-xs text-foreground">{name}</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {isMusic ? t("clip.isMusic") : t(`clip.kind.${item.kind}`)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-64 whitespace-pre-line">{full}</TooltipContent>
      </Tooltip>
      {item.kind === "audio" && item.ref && !isMusic ? (
        <Button
          variant="outline"
          size="xs"
          className="shrink-0 gap-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
          onClick={(e) => { e.stopPropagation(); void setClipMusic(item.ref, item.title); }}
        >
          <NetsuIcon name="music" /> {t("clip.useAsMusic")}
        </Button>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={t("clip.libraryAdd")}
                onClick={(e) => { e.stopPropagation(); onAdd(); }}
                className="shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
              />
            }
          >
            <NetsuIcon name="add" className="size-4" />
          </TooltipTrigger>
          <TooltipContent side="right">{t("clip.libraryAdd")}</TooltipContent>
        </Tooltip>
      )}
    </li>
  );
}

// What the item looks like, small: the picture, the video's poster, the note's first words.
function Preview({ item }: { item: BoardItem }) {
  const box = "relative flex h-11 w-14 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-background";
  const poster = item.kind === "video" ? knownThumb(item.ref, posterTime(item)) : null;
  const pic = item.kind === "image" && item.src && !item.missing ? item.src : poster;
  if (pic) {
    return (
      <span className={box}>
        <img src={pic} alt="" draggable={false} className="size-full object-cover" />
        {item.kind === "video" && <NetsuIcon name="video" className="absolute bottom-0.5 right-0.5 size-3 text-white drop-shadow" />}
      </span>
    );
  }
  if (item.kind === "palette" && item.colors?.length) {
    return <span className={box}>{item.colors.slice(0, 5).map((c, i) => <span key={i} className="h-full flex-1" style={{ background: c }} />)}</span>;
  }
  if (item.kind === "text" && item.text?.trim()) {
    const bg = item.bg && item.bg !== "transparent" ? item.bg : undefined;
    return (
      <span className={cn(box, "items-start justify-start p-1")} style={{ background: bg }}>
        <span className="line-clamp-3 break-words text-left text-[8px] leading-[1.15]" style={{ color: bg ? item.color ?? "#111" : undefined, fontFamily: item.fontFamily }}>
          {item.text.trim().slice(0, 80)}
        </span>
      </span>
    );
  }
  return (
    <span className={cn(box, "text-muted-foreground")}>
      <NetsuIcon name={ICONS[item.kind] ?? "image"} className="size-4" />
    </span>
  );
}

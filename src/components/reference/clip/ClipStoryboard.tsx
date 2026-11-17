// Storyboard: the shots of the Animatic as cards, each with what its camera sees, read like a comic
// strip. Click to go to a shot, double-click its name to rename it, drag a card (or Ctrl+← →) to
// reorder (the time slots stay; the content moves), drop mood board items on a card to put them in
// that shot. Each card carries a note (what the shot is about); the whole board exports as one
// picture.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { nr } from "@/lib/bridge";
import { Button } from "@/components/ui/button";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import { Spinner } from "@/components/ui/spinner";
import { useBoard } from "../useReferenceBoard";
import type { BoardItem } from "../referenceShared";
import {
  cameraMoveOf, clipDuration, deleteShot, duplicateShot, formatTime, moveShot, patchShot, shotEnd, type ClipData,
} from "./clipModel";
import { openClipCard } from "./clipSelectors";
import { renderStoryboardSheet } from "./storyboardSheet";
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
  const { t } = useTranslation("reference");
  const [over, setOver] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const title = useBoard((s) => openClipCard(s)?.title) || t("clip.defaultName");
  const save = async () => {
    const api = nr.reference;
    const dest = await nr.saveFile(`${title.replace(/[\\/:*?"<>|]+/g, "_")}.png`);
    if (!dest || !api) return;
    setSaving(true);
    try {
      const subtitle = [clip.music?.name, t("clip.shotCount", { count: clip.shots.length }), formatTime(clipDuration(clip))].filter(Boolean).join(" · ");
      const canvas = await renderStoryboardSheet(clip, items, { title, subtitle, shot: (n) => t("clip.shotN", { n }) });
      const url = canvas.toDataURL("image/png");
      const res = await api.writeFile(dest, url.slice(url.indexOf(",") + 1), "base64");
      if (!res.ok) throw new Error(res.error || "write failed");
      useBoard.getState().setNotice({ kind: "ok", text: t("clip.sheetSaved") });
    } catch (e) {
      useBoard.getState().setNotice({ kind: "error", text: t("clip.sheetFailed", { error: e instanceof Error ? e.message : String(e) }) });
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="p-3 pt-2">
      <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>{t("clip.shotCount", { count: clip.shots.length })} · {formatTime(clipDuration(clip))}</span>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" className="gap-1.5" disabled={saving} onClick={() => void save()}>
          {saving ? <Spinner className="size-3.5" /> : <NetsuIcon name="export-image-png" />} {t("clip.saveSheet")}
        </Button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-3">
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
          <ShotNote clip={clip} index={index} readonly={readonly} commit={commit} />
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

// The intent of a shot, in a line or two: shown on its card and on the exported sheet.
function ShotNote({ clip, index, readonly, commit }: { clip: ClipData; index: number; readonly: boolean; commit: Commit }) {
  const { t } = useTranslation("reference");
  const [editing, setEditing] = useState(false);
  const note = clip.shots[index].note;
  if (editing) {
    return (
      <textarea
        autoFocus
        rows={2}
        defaultValue={note ?? ""}
        placeholder={t("clip.notePlaceholder")}
        aria-label={t("clip.note")}
        className="mt-1 w-full resize-none rounded bg-muted px-1 py-0.5 text-[11px] outline-none ring-1 ring-primary"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") setEditing(false);
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); }
        }}
        onBlur={(e) => {
          setEditing(false);
          const text = e.target.value.trim();
          if (text !== (note ?? "")) commit(patchShot(clip, index, { note: text || undefined }));
        }}
      />
    );
  }
  if (!note && readonly) return null;
  return (
    <button
      type="button"
      disabled={readonly}
      onClick={() => setEditing(true)}
      className={cn(
        "mt-0.5 block w-full text-left text-[11px] leading-snug",
        note ? "line-clamp-2 text-foreground/80" : "text-muted-foreground/70 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100",
      )}
    >
      {note || t("clip.addNote")}
    </button>
  );
}

// Lanes of the Animatic timeline: the Long lane, the shots (with their right-click menu and inline
// rename) and the items of the expanded shot.

import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
  ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useBoard } from "../useReferenceBoard";
import type { BoardItem } from "../referenceShared";
import {
  cameraMove, cameraMoveOf, cascade, deleteShot, duplicateShot, frameOnItems, longToShot, mergeShot, moveBoundary, patchShot, removeFromShot, resetTiming, setLongPin, setLongSpan,
  setShotItemTiming, shiftLong, shiftShotItems, shotEnd, shotItemSpan, toLong, addToShot, type CameraMove, type ClipData,
} from "./clipModel";
import { framingFromView, play, seek, setLoop, useClipPlayer } from "./clipPlayer";
import { Bar, MiniButton, itemName } from "./timelineParts";
import { dropOnLong, dropOnShot, isAnimaticDrag, readDrag } from "./clipDnd";
import { FxMenu, PinMenu, VideoMenu, type Commit } from "./timelineMenus";
import { useShotThumb } from "./shotThumbs";
import { copyShot, pasteShot, useShotClipboard } from "./clipClipboard";

const CAMERA_MOVES: CameraMove[] = ["static", "zoomIn", "zoomOut", "panLeft", "panRight"];

type Drag = (e: ReactPointerEvent, onMove: (dt: number) => void, onEnd?: () => void) => void;

interface RowProps {
  clip: ClipData;
  width: number;
  dur: number;
  readonly: boolean;
  commit: Commit;
  latest: () => ClipData | null;
  drag: Drag;
  snapT: (t: number, c: ClipData) => number;
  byId: Map<string, BoardItem>;
  selectedIds: string[];
}

const xOf = (sec: number, dur: number, width: number) => (sec / dur) * width;

// Click on a bar: Ctrl / Shift adds or removes it; a plain click on a bar already in a group keeps
// the group, so the whole group can be dragged.
function pickBar(id: string, additive: boolean) {
  const st = useBoard.getState();
  if (additive) st.toggleSelect(id);
  else if (!st.selectedIds.includes(id)) st.select(id);
}

// The bars a drag moves: the selected ones of the same lane when the grabbed bar is one of them.
function dragged(id: string, lane: string[]): string[] {
  const sel = useBoard.getState().selectedIds;
  return sel.includes(id) ? lane.filter((x) => sel.includes(x)) : [id];
}

// Items in reading order on the board: top to bottom, then left to right (rows of a mood board).
export function boardOrder(ids: string[], byId: Map<string, BoardItem>): string[] {
  return [...ids].sort((a, b) => {
    const p = byId.get(a), q = byId.get(b);
    if (!p || !q) return 0;
    return Math.abs(p.y - q.y) > Math.min(p.h, q.h) / 2 ? p.y - q.y : p.x - q.x;
  });
}

// A lane that takes items dragged from the mood board panel, lit while one hovers it.
function useDropZone(readonly: boolean, onDrop: (ids: string[], e: React.DragEvent) => void) {
  const [over, setOver] = useState(false);
  if (readonly) return { over: false, props: {} };
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => { if (isAnimaticDrag(e.dataTransfer)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; setOver(true); } },
      onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); },
      onDrop: (e: React.DragEvent) => {
        setOver(false);
        const ids = readDrag(e.dataTransfer);
        if (!ids) return;
        e.preventDefault();
        e.stopPropagation();
        onDrop(ids, e);
      },
    },
  };
}

export function LongRow({ clip, width, dur, readonly, commit, latest, drag, snapT, byId, selectedIds }: RowProps) {
  const { t } = useTranslation("reference");
  const zone = useDropZone(readonly, (ids) => dropOnLong(ids));
  return (
    <div {...zone.props} className={cn("flex min-h-7 flex-col gap-0.5 py-0.5", zone.over && "bg-sky-500/15 outline-1 outline-dashed outline-sky-500")}>
      {clip.long.length === 0 && <div className="flex h-6 items-center px-2 text-muted-foreground">{t(zone.over ? "clip.dropHere" : "clip.longEmpty")}</div>}
      {clip.long.map((l) => (
        <div key={l.id} className="relative h-6">
          <Bar
            left={xOf(l.start, dur, width)}
            width={xOf(l.end - l.start, dur, width)}
            label={itemName(byId.get(l.id), t)}
            tone="long"
            selected={selectedIds.includes(l.id)}
            onSelect={(add) => pickBar(l.id, add)}
            onMove={readonly ? undefined : (e) => {
              const origin = latest();
              if (!origin) return;
              const ids = dragged(l.id, origin.long.map((x) => x.id));
              const s0 = l.start;
              drag(e, (dt) => commit(shiftLong(origin, ids, snapT(s0 + dt, origin) - s0), "clip-long"));
            }}
            onDelete={readonly ? undefined : () => { const c = latest(); if (c) commit({ ...c, long: c.long.filter((x) => x.id !== l.id) }); }}
            onLeft={readonly ? undefined : (e) => { const s0 = l.start; drag(e, (dt) => { const c = latest(); if (c) commit(setLongSpan(c, l.id, snapT(s0 + dt, c), l.end), "clip-long"); }); }}
            onRight={readonly ? undefined : (e) => { const e0 = l.end; drag(e, (dt) => { const c = latest(); if (c) commit(setLongSpan(c, l.id, l.start, snapT(e0 + dt, c)), "clip-long"); }); }}
            extra={!readonly && (
              <>
                <PinMenu
                  corner={l.pin?.corner ?? null}
                  size={l.pin?.size ?? 0.22}
                  onChange={(pin, tag) => { const c = latest(); if (c) commit(setLongPin(c, l.id, pin), tag); }}
                />
                <MiniButton label={t("clip.backToShot")} onClick={() => { const c = latest(); if (c) commit(longToShot(c, l.id)); }}>
                  <NetsuIcon name="move-down" className="size-3" />
                </MiniButton>
              </>
            )}
          />
        </div>
      ))}
    </div>
  );
}

// What the camera of a shot sees, small, at the start of its block when there is room.
function ShotThumb({ clip, index, items }: { clip: ClipData; index: number; items: BoardItem[] }) {
  const url = useShotThumb(clip, index, items, 96);
  return (
    <span className="relative h-6 w-[43px] shrink-0 overflow-hidden rounded-sm bg-black/60">
      {url && <img src={url} alt="" draggable={false} className="size-full object-cover" />}
    </span>
  );
}

export function ShotsRow({ clip, width, dur, readonly, commit, latest, drag, snapT, selectedIds, byId, shotAtHead, items }: RowProps & { shotAtHead: number; items: BoardItem[] }) {
  const { t } = useTranslation("reference");
  const expanded = useClipPlayer((s) => s.expanded);
  const [menuShot, setMenuShot] = useState(0);
  const [renaming, setRenaming] = useState<string | null>(null);
  const name = (i: number) => clip.shots[i].label || t("clip.shotN", { n: i + 1 });
  const copied = useShotClipboard((s) => s.copied?.name ?? null);
  const at = (i: number, fn: (c: ClipData, i: number) => ClipData) => { const c = latest(); if (c) commit(fn(c, i)); };
  // Mood board items dropped on a shot go into that shot.
  const [dropShot, setDropShot] = useState<number | null>(null);
  const shotUnder = (e: React.DragEvent) => {
    const idx = (e.target as HTMLElement).closest("[data-shot]")?.getAttribute("data-shot");
    return idx == null ? null : Number(idx);
  };
  const dropProps = readonly ? {} : {
    onDragOver: (e: React.DragEvent) => {
      if (!isAnimaticDrag(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      setDropShot(shotUnder(e));
    },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropShot(null); },
    onDrop: (e: React.DragEvent) => {
      const ids = readDrag(e.dataTransfer);
      const i = shotUnder(e);
      setDropShot(null);
      if (!ids || i == null) return;
      e.preventDefault();
      e.stopPropagation();
      dropOnShot(ids, clip.shots[i].start);
    },
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger
        className="relative block h-9"
        {...dropProps}
        onContextMenuCapture={(e) => {
          const idx = (e.target as HTMLElement).closest("[data-shot]")?.getAttribute("data-shot");
          if (idx == null) return;
          setMenuShot(Number(idx));
          seek(clip.shots[Number(idx)].start + 0.001);
        }}
      >
        {clip.shots.map((s, i) => {
          const a = xOf(s.start, dur, width), b = xOf(shotEnd(clip, i), dur, width);
          const open = expanded === s.id;
          return (
            <div
              key={s.id}
              data-shot={i}
              className={cn(
                "absolute top-0.5 flex h-8 items-center gap-1 overflow-hidden rounded-md border px-1",
                i === shotAtHead ? "border-[#a78bfa] bg-[#a78bfa]/25" : "border-border bg-muted/60 hover:bg-muted",
                dropShot === i && "border-dashed border-primary bg-primary/25",
              )}
              style={{ left: a, width: Math.max(4, b - a - 1) }}
            >
              <button
                type="button"
                aria-label={t(open ? "clip.collapse" : "clip.expand")}
                aria-expanded={open}
                className="shrink-0 rounded p-0.5 hover:bg-foreground/10"
                onClick={() => useClipPlayer.setState({ expanded: open ? null : s.id })}
              >
                <NetsuIcon name="chevron-toggle" on={open} className="size-3" />
              </button>
              {b - a > 110 && s.items.length > 0 && <ShotThumb clip={clip} index={i} items={items} />}
              {renaming === s.id ? (
                <input
                  autoFocus
                  defaultValue={s.label ?? ""}
                  placeholder={t("clip.shotN", { n: i + 1 })}
                  aria-label={t("clip.rename")}
                  className="min-w-0 flex-1 rounded bg-background px-1 text-xs outline-none ring-1 ring-primary"
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Escape") setRenaming(null);
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  onBlur={(e) => {
                    const label = e.target.value.trim();
                    setRenaming(null);
                    at(i, (c, k) => patchShot(c, k, { label: label || undefined }));
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left font-medium"
                  onClick={() => seek(s.start + 0.001)}
                  onDoubleClick={() => !readonly && setRenaming(s.id)}
                  onKeyDown={(e) => {
                    if (readonly) return;
                    // F2 renames; Delete removes the shot (kept from the board, which would delete items).
                    if (e.key === "F2") { e.preventDefault(); setRenaming(s.id); }
                    else if ((e.key === "Delete" || e.key === "Backspace") && clip.shots.length > 1) {
                      e.preventDefault();
                      e.stopPropagation();
                      at(i, deleteShot);
                    }
                  }}
                >
                  {name(i)}
                </button>
              )}
              <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {b - a > 160 && `${(shotEnd(clip, i) - s.start).toFixed(1)} s · `}
                {s.items.length}
              </span>
            </div>
          );
        })}
        {/* Boundaries: drag to move (snapped), double-click to merge. */}
        {!readonly && clip.shots.slice(1).map((s, k) => {
          const i = k + 1;
          return (
            <Tooltip key={`b-${s.id}`}>
              <TooltipTrigger
                render={
                  <div
                    className="absolute top-0 z-10 h-9 w-2 -translate-x-1/2 cursor-ew-resize"
                    style={{ left: xOf(s.start, dur, width) }}
                    onPointerDown={(e) => { const t0 = s.start; drag(e, (dt) => { const c = latest(); if (c) commit(moveBoundary(c, i, snapT(t0 + dt, c)), "clip-boundary"); }); }}
                    onDoubleClick={() => at(i, mergeShot)}
                  />
                }
              >
                <span className="mx-auto block h-full w-0.5 bg-foreground/50" />
              </TooltipTrigger>
              <TooltipContent side="top">{t("clip.boundaryHint")}</TooltipContent>
            </Tooltip>
          );
        })}
      </ContextMenuTrigger>
      {!readonly && (
        <ContextMenuContent>
          <ContextMenuItem onClick={() => setRenaming(clip.shots[menuShot]?.id ?? null)}>
            <NetsuIcon name="edit-label" /> {t("clip.rename")}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!selectedIds.length}
            onClick={() => at(menuShot, (c, k) => addToShot(c, k, useBoard.getState().selectedIds))}
          >
            <NetsuIcon name="add" /> {t("clip.addToShot")}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={(clip.shots[menuShot]?.items.length ?? 0) < 2}
            onClick={() => at(menuShot, (c, k) => cascade(c, k, boardOrder(c.shots[k].items.map((si) => si.id), byId)))}
          >
            <NetsuIcon name="cascade" /> {t("clip.cascade")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => at(menuShot, (c, k) => resetTiming(c, k, c.shots[k].items.map((si) => si.id)))}>
            <NetsuIcon name="reset" /> {t("clip.resetTiming")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => { const r = framingFromView(); if (r) at(menuShot, (c, k) => patchShot(c, k, { from: r, to: r })); }}>
            <NetsuIcon name="framing" /> {t("clip.frameBoth")}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!clip.shots[menuShot]?.items.length}
            onClick={() => at(menuShot, (c, k) => frameOnItems(c, k, c.shots[k].items.flatMap((si) => {
              const it = byId.get(si.id);
              return it ? [{ x: it.x, y: it.y, w: it.w, h: it.h }] : [];
            })))}
          >
            <NetsuIcon name="framing" /> {t("clip.frameOnItems")}
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger><NetsuIcon name="camera-move" /> {t("clip.cameraMove")}</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {CAMERA_MOVES.map((m) => (
                <ContextMenuCheckboxItem
                  key={m}
                  checked={!!clip.shots[menuShot] && cameraMoveOf(clip.shots[menuShot]) === m}
                  onCheckedChange={() => at(menuShot, (c, k) => cameraMove(c, k, m))}
                >
                  {t(`clip.moves.${m}`)}
                </ContextMenuCheckboxItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem onClick={() => at(menuShot, duplicateShot)}>
            <NetsuIcon name="duplicate" /> {t("clip.duplicateShot")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => copyShot(menuShot, name(menuShot))}>
            <NetsuIcon name="copy-clipboard" /> {t("clip.copyShot")}
          </ContextMenuItem>
          <ContextMenuItem disabled={copied === null} onClick={() => pasteShot()}>
            <NetsuIcon name="paste" /> {copied === null ? t("clip.pasteShotEmpty") : t("clip.pasteShot", { name: copied })}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => { seek(clip.shots[menuShot].start + 0.001); setLoop(true); play(); }}>
            <NetsuIcon name="seq-loop-mode-loop" /> {t("clip.loopShot")}
          </ContextMenuItem>
          {menuShot > 0 && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => at(menuShot, (c, k) => patchShot(c, k, { transition: "cut" }))}>
                <NetsuIcon name="cut" /> {t("clip.cutTransition")}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => at(menuShot, (c, k) => patchShot(c, k, { transition: "glide" }))}>
                <NetsuIcon name="glide" /> {t("clip.glide")}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => at(menuShot, mergeShot)}>
                <NetsuIcon name="merge-shot" /> {t("clip.mergePrev")}
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" disabled={clip.shots.length < 2} onClick={() => at(menuShot, deleteShot)}>
            <NetsuIcon name="delete" /> {t("clip.deleteShot")}
          </ContextMenuItem>
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}

export function ExpandedRow({ clip, width, dur, readonly, commit, latest, drag, snapT, byId, selectedIds, index }: RowProps & { index: number }) {
  const { t } = useTranslation("reference");
  const s = clip.shots[index];
  const start = s.start, end = shotEnd(clip, index);
  const zone = useDropZone(readonly, (ids) => dropOnShot(ids, start));
  return (
    <div {...zone.props} className={cn("flex flex-col gap-0.5 py-0.5", zone.over && "bg-primary/10 outline-1 outline-dashed outline-primary")}>
      {s.items.length === 0 && <div className="flex h-6 items-center px-2 text-muted-foreground">{t(zone.over ? "clip.dropHere" : "clip.shotEmpty")}</div>}
      {s.items.map((si) => {
        const [a, b] = shotItemSpan(clip, index, si);
        const it = byId.get(si.id);
        return (
          <div key={si.id} className="relative h-6">
            <Bar
              left={xOf(a, dur, width)}
              width={xOf(b - a, dur, width)}
              label={itemName(it, t)}
              tone="item"
              selected={selectedIds.includes(si.id)}
              onSelect={(add) => pickBar(si.id, add)}
              onMove={readonly ? undefined : (e) => {
                const origin = latest();
                if (!origin) return;
                const ids = dragged(si.id, origin.shots[index].items.map((x) => x.id));
                const a0 = a;
                drag(e, (dt) => commit(shiftShotItems(origin, index, ids, snapT(a0 + dt, origin) - a0), "clip-item"));
              }}
              onDelete={readonly ? undefined : () => { const c = latest(); if (c) commit(removeFromShot(c, index, [si.id])); }}
              onLeft={readonly ? undefined : (e) => { const a0 = a; drag(e, (dt) => { const c = latest(); if (c) commit(setShotItemTiming(c, index, si.id, { delay: snapT(a0 + dt, c) - start }), "clip-item"); }); }}
              onRight={readonly ? undefined : (e) => { const b0 = b; drag(e, (dt) => { const c = latest(); if (c) commit(setShotItemTiming(c, index, si.id, { early: end - snapT(b0 + dt, c) }), "clip-item"); }); }}
              extra={!readonly && (
                <>
                  <FxMenu clip={clip} ids={selectedIds.includes(si.id) ? selectedIds : [si.id]} commit={commit} compact />
                  {it?.kind === "video" && <VideoMenu clip={clip} item={it} bar={b - a} commit={commit} />}
                  <MiniButton label={t("clip.toLong")} onClick={() => { const c = latest(); if (c) commit(toLong(c, [si.id])); }}>
                    <NetsuIcon name="lane-long" className="size-3" />
                  </MiniButton>
                  <MiniButton label={t("clip.removeFromShot")} onClick={() => { const c = latest(); if (c) commit(removeFromShot(c, index, [si.id])); }}>
                    <NetsuIcon name="close" className="size-3" />
                  </MiniButton>
                </>
              )}
            />
          </div>
        );
      })}
    </div>
  );
}

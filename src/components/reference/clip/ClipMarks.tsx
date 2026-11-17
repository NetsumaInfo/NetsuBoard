// Marks of the music (intro, verse, drop) on the ruler of the Animatic timeline: double-click the
// ruler or press K to add one at the playhead, drag a mark to move it (snapped), double-click it to
// name it, right-click for the rest. A faint line carries each mark down across the lanes.

import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { cutAtMarks, patchMark, removeMark, type ClipData, type ClipMark } from "./clipModel";
import { seek } from "./clipPlayer";
import { LABEL_W } from "./timelineParts";
import type { Commit } from "./timelineMenus";

type Drag = (e: ReactPointerEvent, onMove: (dt: number) => void, onEnd?: () => void) => void;

export function markName(m: ClipMark, index: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  return m.label || t("clip.markN", { n: index + 1 });
}

export function RulerMarks({ clip, width, dur, readonly, commit, latest, drag, snapT }: {
  clip: ClipData; width: number; dur: number; readonly: boolean; commit: Commit;
  latest: () => ClipData | null; drag: Drag; snapT: (t: number, c: ClipData) => number;
}) {
  const { t } = useTranslation("reference");
  const [renaming, setRenaming] = useState<string | null>(null);
  const marks = clip.marks ?? [];
  return (
    <>
      {marks.map((m, i) => {
        const name = markName(m, i, t);
        return (
          <ContextMenu key={m.id}>
            <ContextMenuTrigger
              className="absolute top-0 z-10 flex h-[18px] max-w-40 -translate-x-px items-center rounded-r-sm border-l-2 border-amber-400 bg-amber-400/25 pl-1 pr-1.5 text-[10px] font-medium text-foreground"
              style={{ left: (m.t / dur) * width }}
              onPointerDown={(e: ReactPointerEvent) => {
                if (e.button !== 0 || renaming === m.id) return;
                e.stopPropagation();
                let moved = false;
                if (readonly) { seek(m.t); return; }
                drag(e, (dt) => {
                  moved = true;
                  const c = latest();
                  if (c) commit(patchMark(c, m.id, { t: snapT(m.t + dt, c) }), "clip-mark");
                }, () => { if (!moved) seek(m.t); });
              }}
              onDoubleClick={(e: React.MouseEvent) => { e.stopPropagation(); if (!readonly) setRenaming(m.id); }}
            >
              {renaming === m.id ? (
                <input
                  autoFocus
                  defaultValue={m.label ?? ""}
                  placeholder={name}
                  aria-label={t("clip.rename")}
                  className="w-24 rounded bg-background px-1 text-[10px] outline-none ring-1 ring-amber-400"
                  onPointerDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Escape") setRenaming(null);
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  onBlur={(e) => {
                    setRenaming(null);
                    const c = latest();
                    if (c) commit(patchMark(c, m.id, { label: e.target.value.trim() || null }));
                  }}
                />
              ) : (
                <span className="truncate">{name}</span>
              )}
            </ContextMenuTrigger>
            {!readonly && (
              <ContextMenuContent>
                <ContextMenuItem onClick={() => setRenaming(m.id)}>
                  <NetsuIcon name="edit-label" /> {t("clip.rename")}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => { const c = latest(); if (c) commit(cutAtMarks(c)); }}>
                  <NetsuIcon name="cut" /> {t("clip.cutAtMarks")}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" onClick={() => { const c = latest(); if (c) commit(removeMark(c, m.id)); }}>
                  <NetsuIcon name="delete" /> {t("clip.removeMark")}
                </ContextMenuItem>
              </ContextMenuContent>
            )}
          </ContextMenu>
        );
      })}
    </>
  );
}

// The marks carried down across every lane, under the playhead.
export function MarkLines({ clip, width, dur }: { clip: ClipData; width: number; dur: number }) {
  return (
    <>
      {(clip.marks ?? []).map((m) => (
        <div
          key={m.id}
          className="pointer-events-none absolute bottom-0 top-6 z-[5] w-px bg-amber-400/40"
          style={{ left: LABEL_W + (m.t / dur) * width }}
        />
      ))}
    </>
  );
}

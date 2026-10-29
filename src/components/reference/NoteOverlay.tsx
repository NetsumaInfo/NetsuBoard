// Open note sheet: the BlockNote editor laid over the board, full size. The editor module (and its
// CSS) is loaded on first open only. Edits reach the board debounced, and one opening costs one
// Ctrl+Z on the board, however long the writing session.

import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";
import { useBoard } from "./useReferenceBoard";
import { sceneItems } from "./boardFolders";
import { noteTitle } from "./NoteCard";
import { youtubeId, type BoardItem } from "./referenceShared";
import type { Mentionable } from "./note/NoteEditor";

const NoteEditor = lazy(() => import("./note/NoteEditor"));

const SAVE_DELAY = 400;
const WIDE_KEY = "nb.noteWide";

function readWide(): boolean {
  try { return localStorage.getItem(WIDE_KEY) === "1"; } catch { return false; }
}

function mentionLabel(it: BoardItem): string {
  if (it.doc) return noteTitle(it.doc) || "";
  return (it.title || it.text || "").split("\n")[0].trim();
}

export function NoteOverlay() {
  const { t } = useTranslation("reference");
  const id = useBoard((s) => s.noteOpenId);
  const item = useBoard((s) => (s.noteOpenId ? s.items.find((it) => it.id === s.noteOpenId) ?? null : null));
  const readOnly = useBoard((s) => s.collabProjectId !== null && s.collabRole === "viewer");
  const pending = useRef<{ doc: unknown[]; plain: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recorded = useRef(false);
  const [wide, setWide] = useState(readWide);
  const toggleWide = () => {
    const next = !wide;
    setWide(next);
    try { localStorage.setItem(WIDE_KEY, next ? "1" : "0"); } catch { /* storage unavailable */ }
  };

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const next = pending.current;
    const target = useBoard.getState().noteOpenId;
    pending.current = null;
    if (!next || !target) return;
    useBoard.getState().patchItem(target, { doc: next.doc, text: next.plain }, !recorded.current);
    recorded.current = true;
  }, []);

  const close = useCallback(() => {
    flush();
    useBoard.getState().openNote(null);
  }, [flush]);

  // A new sheet opened: its first edit starts a new undo entry.
  useEffect(() => { recorded.current = false; return flush; }, [id, flush]);

  // The sheet vanished (deleted, undone, removed by a collaborator): nothing left to show.
  useEffect(() => { if (id && !item) useBoard.getState().openNote(null); }, [id, item]);

  const onChange = useCallback((doc: unknown[], plain: string) => {
    pending.current = { doc, plain };
    if (!timer.current) timer.current = setTimeout(flush, SAVE_DELAY);
  }, [flush]);

  const mentionables = useCallback((): Mentionable[] => {
    const st = useBoard.getState();
    const folder = st.folderPath.length ? st.folderPath[st.folderPath.length - 1].id : null;
    const all = sceneItems(st.items, st.stash, folder);
    const byId = new Map(all.map((it) => [it.id, it]));
    const pathOf = (it: BoardItem) => {
      const names: string[] = [];
      for (let p = it.parent, guard = 0; p && guard < 64; guard++) {
        const f = byId.get(p);
        if (!f) break;
        names.unshift(f.text || t("item.frameDefault"));
        p = f.parent;
      }
      return names.join(" › ");
    };
    return all
      .filter((it) => it.kind !== "draw" && it.id !== st.noteOpenId)
      .map((it) => ({
        id: it.id,
        kind: it.folder ? "folder" : it.doc ? "note" : it.kind,
        label: mentionLabel(it) || t(`noteCard.kind.${it.folder ? "folder" : it.doc ? "note" : it.kind}`, { defaultValue: it.kind }),
        thumb: it.kind === "image" ? it.src : undefined,
        path: pathOf(it) || undefined,
      }));
  }, [t]);

  const onOpenMention = useCallback((itemId: string) => {
    flush();
    useBoard.getState().openNote(null);
    useBoard.getState().revealItem(itemId);
  }, [flush]);

  // A link of the sheet becomes a card on the board, laid in a column to the right of the sheet.
  const onPlaceLink = useCallback((url: string) => {
    const st = useBoard.getState();
    const sheet = st.items.find((it) => it.id === st.noteOpenId);
    if (!sheet) return;
    const yt = youtubeId(url);
    const placed = st.items.filter((it) => it.x >= sheet.x + sheet.w && it.x < sheet.x + sheet.w + 80 && it.y >= sheet.y - 1);
    const y = placed.reduce((m, it) => Math.max(m, it.y + it.h + 24), sheet.y);
    const z = st.items.reduce((m, it) => Math.max(m, it.z), 0) + 1;
    const base = { ref: yt ?? url, src: "", x: sheet.x + sheet.w + 40, y, rotation: 0, z };
    st.addItem(yt
      ? { ...base, kind: "youtube", src: yt, w: 480, h: 270 }
      : { ...base, kind: "embed", src: url, w: 360, h: 300, linkCard: { mode: "preview" } });
    st.setNotice({ kind: "ok", text: t("noteCard.placed") });
  }, [t]);

  if (!id || !item) return null;
  const wideLabel = t(wide ? "noteCard.narrow" : "noteCard.wide");
  // The blur sits on its own layer: a backdrop-filter on the wrapper would make it the containing
  // block of every fixed popup of the editor (paste-as menu, mention cards, lightbox), shifting
  // them off their anchor.
  return (
    <div
      className="absolute inset-0 z-50 flex items-stretch justify-center p-4 sm:p-8"
      onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}
      // The sheet lives outside the board's context menu: keep that one from opening behind it.
      // The text menu (app root, TextContextMenu) handles the sheet's own right-clicks first.
      onContextMenu={(e) => { e.stopPropagation(); e.preventDefault(); }}
      onKeyDown={(e) => {
        // The board's own shortcuts (delete, arrows, Ctrl+A…) must not act while writing.
        e.stopPropagation();
        // Escape closes the sheet unless an editor menu (slash, @, toolbar) took it first.
        if (e.key === "Escape" && !e.defaultPrevented) close();
      }}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className={`relative flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-[var(--color-surface)] shadow-2xl ${wide ? "max-w-none" : "max-w-[1200px]"}`}>
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={toggleWide} aria-label={wideLabel} />}>
              <NetsuIcon name="fullscreen" on={wide} />
            </TooltipTrigger>
            <TooltipContent>{wideLabel}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={close} aria-label={t("noteCard.close")} />}>
              <NetsuIcon name="close" />
            </TooltipTrigger>
            <TooltipContent>{t("noteCard.close")}</TooltipContent>
          </Tooltip>
        </div>
        {/* Inline padding leaves room for the side menu (handle and +) left of the blocks; the
            document keeps its own bottom padding so menus can open below the last line. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-12 pb-12 pt-12 sm:px-20">
          <Suspense fallback={<div className="flex h-full items-center justify-center"><Spinner /></div>}>
            <NoteEditor
              key={id}
              initialBlocks={item.doc?.length ? item.doc : undefined}
              onChange={onChange}
              mentionables={mentionables}
              onOpenMention={onOpenMention}
              onPlaceLink={onPlaceLink}
              readOnly={readOnly}
              autoFocus
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

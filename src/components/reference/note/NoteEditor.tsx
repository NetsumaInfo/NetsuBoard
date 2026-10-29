// Note editor — BlockNote (Mantine flavour) themed on the app palette. Props-driven: the host owns
// persistence and the board. It is meant to be lazy-loaded (React.lazy / import()), which keeps
// BlockNote, Mantine, KaTeX and their CSS out of the main bundle.
//
// Contract: `initialBlocks` is read ONCE at mount (remount with a `key` to load another note);
// `onChange` receives the document JSON and its plain text; `mentionables` is called when the "@"
// menu opens; `onOpenMention` is called when a board-mention chip is clicked.
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "./note.css";
import { createElement, memo, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BlockNoteView, type Theme } from "@blocknote/mantine";
import { useCreateBlockNote, SuggestionMenuController, getDefaultReactSlashMenuItems, type DefaultReactSuggestionItem, LinkToolbarController } from "@blocknote/react";
import { NoteLinkToolbar } from "./NoteLinkToolbar";
import { filterSuggestionItems } from "@blocknote/core";
import * as bnLocales from "@blocknote/core/locales";
import { codeBlockOptions } from "@blocknote/code-block";
import { TextSelection } from "prosemirror-state";
import { nr } from "@/lib/bridge";
import { displaySrc } from "../referenceShared";
import { isImageUrl, isVideoUrl } from "../embeds";
import { noteSchema, noteSlashItems, insertOrUpdate, todayIso } from "./noteSchema";
import { applyPasteAs, type LinkAs } from "./notePaste";
import { PasteAsMenu, type PasteAnchor } from "./PasteAsMenu";
import { NoteSideMenu } from "./NoteSideMenu";
import { useNoteTextMenu } from "./NoteTextMenu";
import { parseUrls } from "./blocks/GalleryBlock";
import { boardKindIcon, setBoardMentionOpener } from "./blocks/BoardMention";
import { setBoardPlacer } from "./boardPlacer";
import { blocksToPlain } from "./noteExport";

export interface Mentionable { id: string; label: string; kind: string; thumb?: string; path?: string }

export interface NoteEditorProps {
  /** BlockNote document JSON; read once at mount. */
  initialBlocks: unknown[] | undefined;
  /** `plain` = whole document as plain text (block text joined by \n), for fallback/search. */
  onChange: (blocks: unknown[], plain: string) => void;
  /** Board items offered by the "@" menu. */
  mentionables: () => Mentionable[];
  /** Click on a board-mention chip. */
  onOpenMention: (itemId: string) => void;
  // A link of the note put on the board as a card ("Put on the board" in a link's menu).
  onPlaceLink?: (url: string) => void;
  readOnly?: boolean;
  autoFocus?: boolean;
}

// BlockNote theme built from the app's CSS tokens (single source = the palette of index.css).
// Passing a theme OBJECT (not "dark") injects the --bn-* variables inline on the Mantine portal
// roots, so menus and popovers follow the palette whatever the stylesheet load order.
function bnThemeFromTokens(): Theme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const fg = v("--color-fg", "#e3e4e8");
  const surface = v("--color-surface", "#111319");
  const surface2 = v("--color-surface-2", "#1a1d25");
  const muted = v("--color-muted", "#888d99");
  return {
    colors: {
      editor: { text: fg, background: "transparent" },
      menu: { text: fg, background: surface },
      tooltip: { text: fg, background: surface2 },
      hovered: { text: fg, background: surface2 },
      selected: { text: v("--color-primary-fg", "#ffffff"), background: v("--color-primary", "#4f86f7") },
      disabled: { text: muted, background: surface2 },
      shadow: "rgba(0, 0, 0, 0.45)",
      border: v("--color-border", "#262a34"),
      sideMenu: muted,
    },
    borderRadius: 10,
  };
}

function NoteEditorInner({ initialBlocks, onChange, mentionables, onOpenMention, onPlaceLink, readOnly = false, autoFocus = false }: NoteEditorProps) {
  const { t, i18n } = useTranslation("note");
  const editorWrap = useRef<HTMLDivElement>(null);
  // Latest callbacks: the editor is created once, the parent's closures change on every render.
  const latest = useRef({ onChange, mentionables, onOpenMention, onPlaceLink });
  latest.current = { onChange, mentionables, onOpenMention, onPlaceLink };
  // Anchor of the "Paste as" menu (null = closed). Opened when a lone link is pasted.
  const [pasteAnchor, setPasteAnchor] = useState<PasteAnchor | null>(null);
  // Theme frozen at mount (the app palette is static).
  const nbTheme = useMemo(() => bnThemeFromTokens(), []);
  const language = i18n.language.slice(0, 2);

  const editor = useCreateBlockNote({
    schema: noteSchema,
    dictionary: bnLocales[language as keyof typeof bnLocales] ?? bnLocales.en,
    codeBlock: codeBlockOptions, // syntax highlighting (shiki) + language picker on the code block
    initialContent: (initialBlocks && initialBlocks.length ? initialBlocks : undefined) as never,
    // Computer media (upload / drag-drop / pasted image) → written to disk by the core; the block
    // keeps the display URL of that asset. Feeds the image/video/audio/file blocks.
    uploadFile: async (file: File): Promise<string> => {
      const ext = (file.name.split(".").pop() || file.type.split("/")[1] || "png").toLowerCase();
      const res = await nr.reference?.saveAsset(await file.arrayBuffer(), ext, { title: file.name });
      if (res?.ok && res.path) return displaySrc(file.type.startsWith("video/") ? "video" : "image", res.path);
      throw new Error(res?.error || t("editor.uploadFailed"));
    },
    // A lone link: direct image/video → media block; otherwise the "Paste as" menu (Mention / Link /
    // Bookmark / Embed). Everything else (text, markdown, clipboard images) keeps BlockNote's default.
    pasteHandler: ({ event, editor: ed, defaultPasteHandler }) => {
      const text = event.clipboardData?.getData("text/plain")?.trim() || "";
      const isLoneUrl = /^https?:\/\/\S+$/i.test(text) && !/\s/.test(text);
      if (!isLoneUrl || event.clipboardData?.files.length) return defaultPasteHandler();
      // Selected text + pasted link: wrap the selection in a link instead of replacing it.
      if (ed.getSelectedText()) { ed.createLink(text); return true; }
      if (isImageUrl(text)) { insertOrUpdate(ed, { type: "image", props: { url: text } }); return true; }
      if (isVideoUrl(text)) { insertOrUpdate(ed, { type: "video", props: { url: text } }); return true; }
      // Collapsed caret: floating menu at its exact position. The DOM selection can be missing or
      // collapsed (and report 0,0); ProseMirror always knows the real client position.
      const view = ed.prosemirrorView;
      const pos = ed.prosemirrorState.selection.from;
      const readSelectionRect = () => {
        try {
          const selection = window.getSelection();
          const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
          const rect = range?.getBoundingClientRect();
          if (rect && (rect.width || rect.height || rect.left || rect.top)) return rect;
          const line = range?.getClientRects?.()[0];
          if (line && (line.width || line.height || line.left || line.top)) return line;
        } catch { /* the caret can be absent while pasting */ }
        return null;
      };
      const initialSelectionRect = readSelectionRect();
      setPasteAnchor({
        url: text,
        getRect: () => {
          const currentSelectionRect = readSelectionRect();
          if (currentSelectionRect) return currentSelectionRect;
          try {
            const coords = view.coordsAtPos(pos);
            return new DOMRect(coords.left, coords.top, Math.max(1, coords.right - coords.left), Math.max(1, coords.bottom - coords.top));
          } catch {
            // Last resort: stay inside the editor area, never at (0, 0).
            if (initialSelectionRect) return initialSelectionRect;
            const rect = editorWrap.current?.getBoundingClientRect();
            return rect ? new DOMRect(rect.left, rect.top, 1, 20) : null;
          }
        },
      });
      return true;
    },
  });

  // Right-click menu: formatting, "Turn into" and block actions on top of the app-wide text menu.
  useNoteTextMenu(editor, editorWrap, readOnly);

  // Board-mention chips call back into the host through the module-level opener slot.
  useEffect(() => setBoardMentionOpener((id) => latest.current.onOpenMention(id)), []);
  // Same for "Put on the board" on links, when the host offers it.
  useEffect(() => setBoardPlacer((url) => latest.current.onPlaceLink?.(url)), []);

  useEffect(() => {
    if (!autoFocus || readOnly) return;
    const raf = requestAnimationFrame(() => { try { editor.focus(); } catch { /* view not ready */ } });
    return () => cancelAnimationFrame(raf);
  }, [autoFocus, readOnly, editor]);

  const onPasteAs = (kind: LinkAs) => { if (pasteAnchor) applyPasteAs(editor, pasteAnchor.url, kind); setPasteAnchor(null); };

  // "@" menu: board items (filtered by label, newest-first order kept as given) + today's date.
  const mentionItems = async (query: string): Promise<DefaultReactSuggestionItem[]> => {
    const q = query.trim().toLowerCase();
    const matches = latest.current.mentionables()
      .filter((m) => !q || m.label.toLowerCase().includes(q))
      .slice(0, 30)
      .map((m): DefaultReactSuggestionItem => ({
        title: m.label || t("boardMention.untitled"),
        badge: m.path ? (m.path.length > 22 ? `…${m.path.slice(-21)}` : m.path) : undefined,
        icon: m.thumb
          ? createElement("img", { src: m.thumb, alt: "", draggable: false, style: { width: 18, height: 18, borderRadius: 3, objectFit: "cover" } })
          : createElement(boardKindIcon(m.kind), { className: "size-4" }),
        onItemClick: () => editor.insertInlineContent([{ type: "boardMention", props: { itemId: m.id, label: m.label, kind: m.kind } }, " "] as never),
      }));
    if (!q || "date".includes(q) || t("editor.dateToday").toLowerCase().includes(q)) {
      matches.unshift({
        title: t("editor.dateToday"),
        onItemClick: () => editor.insertInlineContent([{ type: "dateMention", props: { date: todayIso() } }, " "] as never),
      });
    }
    return matches;
  };

  // External links must open in the system browser, never navigate the webview.
  const onClickCapture = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest?.("a[href]") as HTMLAnchorElement | null;
    const href = a?.getAttribute("href") || "";
    if (!a || !/^https?:\/\//i.test(href)) return;
    e.preventDefault(); e.stopPropagation();
    void nr.openExternal(href);
  };

  // Selection fix: when BLOCKS are selected (blue block selection), a click-drag inside the text did
  // not return to text selection. On pointerdown inside editable content, a non-text selection is
  // converted to a caret at the clicked spot BEFORE the drag, so text selection works at once.
  const onEditorPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (!target.closest(".bn-block-content") || target.closest("a, button, input, textarea")) return;
    try {
      const view = editor.prosemirrorView;
      const state = editor.prosemirrorState;
      if (!view || !state || state.selection instanceof TextSelection) return;
      const coords = view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (!coords) return;
      view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(coords.pos))));
    } catch { /* ProseMirror API missing → no-op */ }
  };

  // A click in the empty area below the last block puts the caret at the end of the document.
  // Never steals an existing text selection and ignores clicks beside a paragraph.
  const onEmptyClick = (e: React.MouseEvent) => {
    if (readOnly) return;
    const target = e.target as HTMLElement;
    if (target.closest(".bn-block-content") || target.closest("a, button, input, textarea")) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const editable = (e.currentTarget as HTMLElement).querySelector(".bn-editor");
    const bottom = editable?.getBoundingClientRect().bottom ?? 0;
    if (e.clientY < bottom) return;
    const blocks = editor.document;
    const last = blocks[blocks.length - 1];
    if (last) { editor.focus(); editor.setTextCursorPosition(last, "end"); }
  };

  // Dropping image(s) ON an existing image/gallery block merges them into a gallery (carousel). We
  // intercept in the capture phase BEFORE BlockNote's own drop handler, then upload the files.
  const onDropCapture = (e: React.DragEvent) => {
    if (readOnly) return;
    const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    const host = (e.target as HTMLElement).closest?.("[data-id]") as HTMLElement | null;
    const id = host?.getAttribute("data-id");
    const blk = id ? editor.getBlock(id) : null;
    if (!blk || (blk.type !== "image" && blk.type !== "gallery")) return; // let BlockNote handle it
    e.preventDefault(); e.stopPropagation(); e.nativeEvent.stopImmediatePropagation();
    void (async () => {
      const up: string[] = [];
      for (const f of files) { const u = await editor.uploadFile?.(f); if (typeof u === "string") up.push(u); }
      if (!up.length) return;
      if (blk.type === "image") {
        const imgUrl = (blk.props as Record<string, unknown>).url;
        const first = imgUrl ? [String(imgUrl)] : [];
        editor.replaceBlocks([blk], [{ type: "gallery", props: { urls: JSON.stringify([...first, ...up]), layout: "carousel" } }] as never);
      } else {
        const cur = parseUrls((blk.props as Record<string, unknown>).urls);
        editor.updateBlock(blk, { type: "gallery", props: { urls: JSON.stringify([...cur, ...up]) } } as never);
      }
    })();
  };

  return (
    <div ref={editorWrap} className="bn-container nb-doc" lang={language} onPointerDownCapture={onEditorPointerDown} onClickCapture={onClickCapture} onClick={onEmptyClick} onDropCapture={onDropCapture}>
      <BlockNoteView
        editor={editor}
        editable={!readOnly}
        theme={nbTheme}
        lang={language}
        slashMenu={false}
        sideMenu={false}
        linkToolbar={false}
        onChange={() => {
          if (readOnly) return;
          const doc = editor.document as unknown as unknown[];
          latest.current.onChange(doc, blocksToPlain(doc));
        }}
      >
        <NoteSideMenu />
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) => {
            // Our custom blocks replace audio/video/file: drop the default items whose title collides
            // (two entries with the same key would warn in React).
            const custom = noteSlashItems(editor);
            const taken = new Set(custom.map((i) => i.title));
            const defaults = getDefaultReactSlashMenuItems(editor).filter((i) => !taken.has(i.title));
            // Group by name (first appearance): default and custom items share a group, and two
            // non-contiguous groups with the same name would produce duplicate React keys.
            const merged = [...defaults, ...custom];
            const groups = [...new Set(merged.map((i) => i.group))];
            return filterSuggestionItems(groups.flatMap((g) => merged.filter((i) => i.group === g)), query);
          }}
        />
        <SuggestionMenuController triggerCharacter="@" getItems={mentionItems} />
        <LinkToolbarController linkToolbar={NoteLinkToolbar} />
      </BlockNoteView>
      {pasteAnchor && <PasteAsMenu anchor={pasteAnchor} onPick={onPasteAs} onClose={() => setPasteAnchor(null)} />}
    </div>
  );
}

// Memoised on `readOnly` only: the parent hands new closures on every render, and the editor owns
// its content, so re-rendering BlockNote per keystroke would only cause editing jank.
const NoteEditor = memo(NoteEditorInner, (a, b) => a.readOnly === b.readOnly && a.autoFocus === b.autoFocus);
export default NoteEditor;

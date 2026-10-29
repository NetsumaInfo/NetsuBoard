// Markdown text block on the board (mode "block" of a text element, see blockModel). Read rendered:
// headings, nested lists, tasks you tick right on the board, links that open outside, tables. A
// double-click writes the raw Markdown in place, in the same box (the shortcuts and the formatting bar
// are in blockEditing / BlockEditBar); Escape, Ctrl+Enter or a click outside leaves it. The source is `item.text`, written live so a shared board follows keystroke by
// keystroke. A box too small for its content scrolls inside (the wheel is the block's only while it
// can scroll). No JS animation.

import { useEffect, useMemo, useRef, type CSSProperties, type MouseEvent, type PointerEvent, type WheelEvent } from "react";
import { useTranslation } from "react-i18next";
import { nr } from "@/lib/bridge";
import { renderMarkdown } from "./boardDocs";
import {
  blockAccent, blockRadius, blockSource, blockSurface, toggleTaskLine, BLOCK_PAD, DEFAULT_BLOCK_SIZE,
} from "./blockModel";
import { continueList, indent, moveLines, shortcutFormat } from "./blockEditing";
import { afterInput, formatBlock, runEdit } from "./blockEditorDom";
import { noteTextFactor } from "./boardTextZoom";
import { useBoard } from "./useReferenceBoard";
import type { BoardItem } from "./referenceShared";
import "./textBlock.css";

export function TextBlock({ item, editing }: { item: BoardItem; editing: boolean }) {
  const { t } = useTranslation("reference");
  const patchItem = useBoard((s) => s.patchItem);
  const setEditing = useBoard((s) => s.setEditing);
  const scale = useBoard((s) => s.view.scale);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const source = blockSource(item);
  const html = useMemo(() => renderMarkdown(source, { tasks: "interactive" }), [source]);
  const accent = blockAccent(item);

  // A legacy post-it still holds its lines in `doc`: the first edit moves them to `text`.
  useEffect(() => {
    if (editing && item.doc) patchItem(item.id, { text: source, doc: undefined });
  }, [editing, item.doc, item.id, source, patchItem]);
  useEffect(() => {
    if (editing) {
      const ta = taRef.current;
      ta?.focus();
      ta?.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, [editing]);

  const base = item.fontSize ?? DEFAULT_BLOCK_SIZE;
  const look = item.blockLook;
  const style = {
    "--nr-accent": accent ?? "transparent",
    "--nr-pad": BLOCK_PAD[look?.pad ?? "m"],
    fontSize: base * (editing ? 1 : noteTextFactor({ ...item, text: source, fontSize: base }, scale)),
    fontFamily: item.fontFamily,
    color: item.color,
    background: blockSurface(item),
    borderRadius: blockRadius(item),
    borderWidth: look?.border === false ? 0 : undefined,
  } as CSSProperties;

  if (editing) {
    return (
      <div className="nr-block" style={style}>
        <textarea
          ref={taRef}
          aria-label={t("textMode.editLabel")}
          placeholder={t("textMode.placeholder")}
          className="nr-block-edit"
          autoComplete="off"
          value={source}
          spellCheck={false}
          data-block-editor={item.id}
          onChange={(e) => {
            patchItem(item.id, { text: e.target.value });
            afterInput(e.target, item.id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
          onBlur={(e) => {
            // Staying in the formatting bar or the inspector's controls keeps the edit going.
            if ((e.relatedTarget as HTMLElement | null)?.closest?.("[data-note-toolbar]")) return;
            setEditing(null);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.nativeEvent.isComposing) return;
            const ta = e.currentTarget;
            if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
              e.preventDefault();
              setEditing(null);
              return;
            }
            const fmt = shortcutFormat(e);
            if (fmt) {
              e.preventDefault();
              formatBlock(item.id, fmt);
              return;
            }
            if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) {
              e.preventDefault();
              runEdit(ta, item.id, (ed) => indent(ed, e.shiftKey));
            } else if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
              if (runEdit(ta, item.id, continueList)) e.preventDefault();
            } else if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
              e.preventDefault();
              runEdit(ta, item.id, (ed) => moveLines(ed, e.key === "ArrowUp" ? -1 : 1));
            }
          }}
        />
      </div>
    );
  }

  // Links open in the system browser, never in the board's webview; a checkbox flips its source line.
  const onClick = (e: MouseEvent) => {
    const el = e.target as HTMLElement;
    const a = el.closest("a");
    if (a) {
      e.preventDefault();
      e.stopPropagation();
      const href = a.getAttribute("href") || "";
      if (/^(https?:\/\/|mailto:)/i.test(href)) void nr.openExternal(href);
      return;
    }
    const box = el.closest<HTMLElement>(".md-box");
    if (box) {
      e.stopPropagation();
      const line = Number(box.dataset.line);
      if (Number.isInteger(line)) patchItem(item.id, { text: toggleTaskLine(source, line), doc: undefined });
    }
  };
  // A press on a link or a checkbox must not start a move: the move captures the pointer, which would
  // hand the click to the item instead of the link. The block is still selected.
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.shiftKey || !(e.target as HTMLElement).closest("a, .md-box")) return;
    e.stopPropagation();
    if (!useBoard.getState().selectedIds.includes(item.id)) useBoard.getState().select(item.id);
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight > el.clientHeight + 1) e.stopPropagation();
  };

  return (
    <div className="nr-block" style={style}>
      {source.trim() ? (
        <div className="nr-block-body" onClick={onClick} onPointerDown={onPointerDown} onWheel={onWheel} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="nr-block-body nr-block-empty">{t("textMode.empty")}</div>
      )}
    </div>
  );
}

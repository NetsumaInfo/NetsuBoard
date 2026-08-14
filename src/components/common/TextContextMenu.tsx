// App-wide right-click policy, mounted once per window.
//
// The WebView2 native menu is never appropriate here (it offers page reload, "save image as",
// devtools…), so it is suppressed everywhere. Suppressing it alone would leave text fields with no
// menu at all, so this component replaces it with an in-app edit menu:
//
//   - inside a text field (input, textarea, contenteditable) → Cut / Copy / Paste / Select all;
//   - on a plain text selection outside any field → Copy;
//   - on a surface that carries its own <ContextMenu> (board, home cards, error badge) → that menu
//     wins, this one stays out of the way.
//
// The capture-phase listener runs before every React handler, so a right-click inside a field being
// edited on the board opens the edit menu instead of the board menu.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Scissors, Copy, ClipboardPaste, TextSelect } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

// Field types that behave like text. Sliders, colours and checkboxes have nothing to cut or paste.
const TEXT_INPUT_TYPES = new Set(["", "text", "search", "url", "email", "tel", "password", "number"]);

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

function editableFrom(target: EventTarget | null): Field | null {
  if (!(target instanceof HTMLElement)) return null;
  const el = target.closest<HTMLElement>("input, textarea, [contenteditable]");
  if (!el) return null;
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type) ? el : null;
  if (el instanceof HTMLTextAreaElement) return el;
  return el.isContentEditable ? el : null;
}

const isTextField = (el: Field | null): el is HTMLInputElement | HTMLTextAreaElement =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;

type Ctx = {
  x: number;
  y: number;
  el: Field | null;            // null → selection-only menu (Copy)
  container: HTMLElement | null; // dialog content when the click happened inside one
  readOnly: boolean;
  secret: boolean;             // password field: its content is never exposed through the menu
  empty: boolean;
  selection: string;
  range: { start: number; end: number } | null;
  domRange: Range | null;
};

// The menu takes focus while open; the field must get its caret back before any clipboard command.
function restore(c: Ctx) {
  const el = c.el;
  if (!el) return;
  el.focus({ preventScroll: true });
  if (isTextField(el) && c.range) el.setSelectionRange(c.range.start, c.range.end);
  else if (c.domRange) {
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(c.domRange);
  }
}

// React tracks the last value it wrote to a field; assigning `.value` directly would make the
// synthetic change event look like a no-op. The native setter clears that tracker.
function setFieldValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function copyText(c: Ctx) {
  if (c.el) {
    restore(c);
    if (document.execCommand("copy")) return;
  }
  void navigator.clipboard?.writeText(c.selection);
}

function cutText(c: Ctx) {
  restore(c);
  if (document.execCommand("cut")) return;
  void navigator.clipboard?.writeText(c.selection);
  insertText(c, "");
}

async function pasteText(c: Ctx) {
  let text = "";
  try { text = await navigator.clipboard.readText(); } catch { return; }
  if (!text) return;
  insertText(c, text);
}

function insertText(c: Ctx, text: string) {
  restore(c);
  // `insertText` keeps the field's own undo stack and fires a proper input event.
  if (document.execCommand("insertText", false, text)) return;
  const el = c.el;
  if (!isTextField(el)) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  setFieldValue(el, el.value.slice(0, start) + text + el.value.slice(end));
  el.setSelectionRange(start + text.length, start + text.length);
}

function selectAll(c: Ctx) {
  restore(c);
  if (isTextField(c.el)) c.el.select();
  else document.execCommand("selectAll");
}

export function TextContextMenu() {
  const { t } = useTranslation("common");
  const [ctx, setCtx] = useState<Ctx | null>(null);
  // Focus goes back to the field the menu was opened from, not to the document body.
  const fieldRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onCapture = (e: MouseEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const el = editableFrom(target);
      const sel = window.getSelection();
      const selection = sel?.toString() ?? "";

      if (!el) {
        // Surfaces with their own context menu keep it; a bare surface with no selection gets none.
        if (target?.closest('[data-slot="context-menu-trigger"]')) return;
        if (!selection.trim() || !sel?.anchorNode || !target?.contains(sel.anchorNode)) return;
      }

      const input = isTextField(el) ? el : null;
      const readOnly = !!input && (input.readOnly || input.disabled);
      e.preventDefault();
      e.stopPropagation();
      fieldRef.current = el;
      setCtx({
        x: e.clientX,
        y: e.clientY,
        el,
        container: target?.closest<HTMLElement>('[data-slot="dialog-content"], [role="dialog"], [role="alertdialog"]') ?? null,
        readOnly,
        secret: input?.type === "password",
        empty: input ? input.value === "" : !el?.textContent,
        selection: input ? input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0) : selection,
        range: input ? { start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0 } : null,
        domRange: !input && sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null,
      });
    };
    // Bubble phase, after every in-app menu has had the event: the native menu never shows.
    const suppressNative = (e: MouseEvent) => e.preventDefault();

    document.addEventListener("contextmenu", onCapture, true);
    document.addEventListener("contextmenu", suppressNative);
    return () => {
      document.removeEventListener("contextmenu", onCapture, true);
      document.removeEventListener("contextmenu", suppressNative);
    };
  }, []);

  const anchor = useMemo(
    () => (ctx ? { getBoundingClientRect: () => new DOMRect(ctx.x, ctx.y, 0, 0) } : undefined),
    [ctx],
  );

  if (!ctx) return null;

  const hasSelection = !!ctx.selection;
  const editable = !!ctx.el && !ctx.readOnly;

  return (
    <DropdownMenu open onOpenChange={(open) => { if (!open) setCtx(null); }} modal={false}>
      <DropdownMenuContent
        anchor={anchor}
        container={ctx.container ?? undefined}
        sideOffset={0}
        finalFocus={fieldRef}
        className="min-w-44"
      >
        {editable && !ctx.secret && (
          <DropdownMenuItem disabled={!hasSelection} onClick={() => cutText(ctx)}>
            <Scissors /> {t("action.cut")}
          </DropdownMenuItem>
        )}
        {!ctx.secret && (
          <DropdownMenuItem disabled={!hasSelection} onClick={() => copyText(ctx)}>
            <Copy /> {t("action.copy")}
          </DropdownMenuItem>
        )}
        {editable && (
          <DropdownMenuItem onClick={() => void pasteText(ctx)}>
            <ClipboardPaste /> {t("action.paste")}
          </DropdownMenuItem>
        )}
        {!!ctx.el && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={ctx.empty} onClick={() => selectAll(ctx)}>
              <TextSelect /> {t("action.selectAll")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

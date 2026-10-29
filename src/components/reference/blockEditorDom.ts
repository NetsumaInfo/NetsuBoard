// The bridge between the pure transforms (blockEditing) and the block's textarea: reads its state,
// applies an edit, writes the text back through the store and restores the selection.

import { useBoard } from "./useReferenceBoard";
import { applyFormat, autoFormat, type BlockFormat, type Edit } from "./blockEditing";

/** The textarea of the block being written (one at a time). */
export function blockEditor(id: string): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>(`textarea[data-block-editor="${CSS.escape(id)}"]`);
}

/** Runs `fn` on the textarea's current state. False when it had nothing to do. */
export function runEdit(ta: HTMLTextAreaElement, id: string, fn: (e: Edit) => Edit | null): boolean {
  const r = fn({ value: ta.value, start: ta.selectionStart, end: ta.selectionEnd });
  if (!r) return false;
  if (r.value !== ta.value) useBoard.getState().patchItem(id, { text: r.value, doc: undefined });
  // The controlled value lands on the next render; the selection is restored right after it.
  requestAnimationFrame(() => {
    if (ta.isConnected) { ta.focus(); ta.setSelectionRange(r.start, r.end); }
  });
  return true;
}

export function formatBlock(id: string, f: BlockFormat): void {
  const ta = blockEditor(id);
  if (ta) runEdit(ta, id, (e) => applyFormat(e, f));
}

/** After an input event: typing conveniences ("[] " becomes a task…). */
export function afterInput(ta: HTMLTextAreaElement, id: string): void {
  runEdit(ta, id, autoFormat);
}

// "Put on the board": a link inside a note becomes a card on the board, next to the sheet. The
// blocks live in a static schema and cannot receive props, so the host (NoteEditor) registers the
// handler here, like the board-mention opener.

let placer: ((url: string) => void) | null = null;

/** Registers the handler; returns a disposer that only clears its own registration. */
export function setBoardPlacer(fn: ((url: string) => void) | null): () => void {
  placer = fn;
  return () => { if (placer === fn) placer = null; };
}

export function canPlaceOnBoard(): boolean {
  return placer !== null;
}

export function placeOnBoard(url: string): void {
  placer?.(url);
}

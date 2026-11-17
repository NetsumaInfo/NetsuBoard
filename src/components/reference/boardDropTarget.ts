// A place outside the board that takes items dragged off it (the Animatic's shots lane). Board
// items move by pointer, not by HTML drag and drop, so the move gesture asks this target where the
// pointer is while it moves and, on release over it, hands the items over instead of moving them.

export interface ItemDropTarget {
  // The point (client pixels) is over the target.
  over(x: number, y: number): boolean;
  // The pointer moves during an item drag: over the target, or `null` when it left or the drag ended.
  hover(x: number | null): void;
  // Items released over the target. They go back to where they were on the board.
  drop(x: number, ids: string[]): void;
}

let target: ItemDropTarget | null = null;

export function registerItemDropTarget(t: ItemDropTarget): () => void {
  target = t;
  return () => { if (target === t) target = null; };
}

export const itemDropTarget = () => target;

// Double-click detection for a text element, from the pointer itself. The browser's `dblclick` is
// retargeted by pointer capture, swallowed when the first click moved the item, and never fires when
// the two presses land a pixel apart; entering the editor must not depend on it. A "tap" is a press
// and release that stayed put; two taps on the same item close in time and space are a double tap.

export interface Tap { id: string; x: number; y: number; t: number }

export const DOUBLE_TAP_MS = 450;
export const DOUBLE_TAP_PX = 8;
export const TAP_SLOP_PX = 4;

/** True when a press at `down` and its release at `up` stayed within the tap slop. */
export function isTap(down: { x: number; y: number }, up: { x: number; y: number }): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= TAP_SLOP_PX;
}

/**
 * Registers a tap against the previous one. A double tap consumes both (the next tap starts over), so
 * a triple click is one double tap and a lone tap, never two.
 */
export function registerTap(prev: Tap | null, cur: Tap): { double: boolean; next: Tap | null } {
  const double = !!prev
    && prev.id === cur.id
    && cur.t - prev.t <= DOUBLE_TAP_MS
    && cur.t >= prev.t
    && Math.hypot(cur.x - prev.x, cur.y - prev.y) <= DOUBLE_TAP_PX;
  return { double, next: double ? null : cur };
}

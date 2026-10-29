// Size of the board's chrome (handles, link labels, link strokes, outlines) against the zoom.
// Zoomed in, chrome keeps a constant size on screen — a handle must not become a dinner plate.
// Zoomed out, it stops compensating below CHROME_MIN_SCALE and shrinks with the board, then
// disappears: at that distance one looks at the composition, and chrome that kept its screen size
// would end up bigger than the items it belongs to.

// Below this zoom, chrome shrinks with the board instead of keeping its screen size.
export const CHROME_MIN_SCALE = 0.6;
// Below this zoom, handles and labels are not drawn at all.
export const CHROME_HIDE_SCALE = 0.25;

// World units for one screen pixel of chrome.
export function chromePx(scale: number): number {
  return 1 / Math.max(scale, CHROME_MIN_SCALE);
}

export function chromeVisible(scale: number): boolean {
  return scale >= CHROME_HIDE_SCALE;
}

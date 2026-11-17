// Word wrapping for text drawn on a canvas (the storyboard sheet). Pure: the width of a string comes
// from the caller.

// Lines of `text` that fit in `max` pixels, words kept whole (a word longer than a line is cut),
// at most `limit` lines, the last one ending in "…" when text is left over.
export function wrapText(text: string, max: number, measure: (s: string) => number, limit = 3): string[] {
  const lines: string[] = [];
  let cur = "";
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  for (let k = 0; k < words.length; k++) {
    let w = words[k];
    while (measure(w) > max && w.length > 1) {
      // A word wider than a line goes on its own lines.
      let cut = w.length - 1;
      while (cut > 1 && measure(w.slice(0, cut)) > max) cut--;
      if (cur) { lines.push(cur); cur = ""; }
      lines.push(w.slice(0, cut));
      w = w.slice(cut);
    }
    const next = cur ? `${cur} ${w}` : w;
    if (measure(next) <= max) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length <= limit) return lines;
  const out = lines.slice(0, limit);
  let last = out[limit - 1];
  while (last && measure(`${last}…`) > max) last = last.slice(0, -1);
  out[limit - 1] = `${last}…`;
  return out;
}

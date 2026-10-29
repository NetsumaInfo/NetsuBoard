// Text transforms of the Markdown block editor (a raw textarea). Pure: every function takes the
// textarea state ({ value, start, end }) and returns the next one, so the keyboard shortcuts, the
// formatting bar and the "/" menu all apply the same edit — and it is testable without a DOM.

export interface Edit { value: string; start: number; end: number }

export type BlockFormat =
  | "h1" | "h2" | "h3" | "paragraph" | "bullet" | "numbered" | "task" | "quote"
  | "bold" | "italic" | "strike" | "code" | "link" | "divider" | "codeBlock" | "table";

// ---------- lines ----------

interface Span { from: number; to: number } // [from, to) of the lines a selection touches, newline excluded

function lineSpan(e: Edit): Span {
  const { value, start } = e;
  // A selection ending right after a newline does not touch the next line.
  const end = e.end > start && value[e.end - 1] === "\n" ? e.end - 1 : e.end;
  const from = value.lastIndexOf("\n", start - 1) + 1;
  const nl = value.indexOf("\n", end);
  return { from, to: nl === -1 ? value.length : nl };
}

function mapLines(e: Edit, fn: (line: string, index: number) => string): Edit {
  const { from, to } = lineSpan(e);
  const lines = e.value.slice(from, to).split("\n");
  const out = lines.map(fn);
  const next = out.join("\n");
  const value = e.value.slice(0, from) + next + e.value.slice(to);
  // Caret/selection ends follow the change a line got at its head (prefix added or removed).
  const shift = (pos: number): number => {
    if (pos < from) return pos;
    let oldOff = from;
    let newOff = from;
    for (let i = 0; i < lines.length; i++) {
      const len = lines[i].length;
      if (pos <= oldOff + len) {
        const off = pos - oldOff;
        const d = out[i].length - len;
        const moved = off === 0 && len > 0 ? 0 : Math.max(0, off + d);
        return newOff + Math.min(moved, out[i].length);
      }
      oldOff += len + 1;
      newOff += out[i].length + 1;
    }
    return pos + (next.length - (to - from));
  };
  const clamp = (n: number) => Math.max(0, Math.min(n, value.length));
  return { value, start: clamp(shift(e.start)), end: clamp(shift(e.end)) };
}

// ---------- line prefixes ----------

type Kind = "bullet" | "numbered" | "task" | null;
interface Parsed { indent: string; kind: Kind; marker: string; num: number; checked: boolean; prefixLen: number; rest: string }

const LIST_RE = /^(\s*)(?:([-*+])|(\d+)([.)]))\s+(?:\[( |x|X)\]\s+)?/;

export function parseLine(line: string): Parsed {
  const m = LIST_RE.exec(line);
  if (!m) {
    const indent = /^\s*/.exec(line)![0];
    return { indent, kind: null, marker: "", num: 0, checked: false, prefixLen: indent.length, rest: line.slice(indent.length) };
  }
  const kind: Kind = m[5] !== undefined ? "task" : m[3] !== undefined ? "numbered" : "bullet";
  return {
    indent: m[1], kind, marker: m[2] ?? m[4], num: m[3] !== undefined ? Number(m[3]) : 0,
    checked: m[5] === "x" || m[5] === "X", prefixLen: m[0].length, rest: line.slice(m[0].length),
  };
}

const HEADING_RE = /^(#{1,6})\s+/;
const QUOTE_RE = /^>\s?/;

/** The line without any block prefix (heading, quote, list, task), with its indent. */
function stripBlock(line: string): { indent: string; body: string } {
  const p = parseLine(line);
  if (p.kind) return { indent: p.indent, body: p.rest };
  const body = p.rest.replace(HEADING_RE, "").replace(QUOTE_RE, "");
  return { indent: p.indent, body };
}

function headingLevel(line: string): number {
  const m = HEADING_RE.exec(parseLine(line).rest);
  return m ? m[1].length : 0;
}

function isQuote(line: string): boolean { return QUOTE_RE.test(parseLine(line).rest); }

/** Sets (or toggles off) a block format on the lines the selection touches. */
export function setBlock(e: Edit, f: "h1" | "h2" | "h3" | "paragraph" | "bullet" | "numbered" | "task" | "quote"): Edit {
  const { from, to } = lineSpan(e);
  const lines = e.value.slice(from, to).split("\n");
  const live = lines.filter((l) => l.trim());
  const targets = live.length ? live : lines;
  const has = (l: string): boolean => {
    const p = parseLine(l);
    switch (f) {
      case "h1": case "h2": case "h3": return headingLevel(l) === Number(f[1]);
      case "paragraph": return !p.kind && !headingLevel(l) && !isQuote(l);
      case "bullet": return p.kind === "bullet";
      case "numbered": return p.kind === "numbered";
      case "task": return p.kind === "task";
      case "quote": return isQuote(l);
    }
  };
  const off = f !== "paragraph" && targets.every(has);
  let n = 0;
  const edited = mapLines(e, (line) => {
    if (live.length && !line.trim()) return line;
    const { indent, body } = stripBlock(line);
    if (f === "paragraph" || off) return indent + body;
    switch (f) {
      case "h1": case "h2": case "h3": return `${"#".repeat(Number(f[1]))} ${body}`;
      case "bullet": return `${indent}- ${body}`;
      case "numbered": return `${indent}${++n}. ${body}`;
      case "task": return `${indent}- [ ] ${body}`;
      case "quote": return `> ${body}`;
    }
  });
  return f === "numbered" || off ? renumber(edited) : edited;
}

// ---------- inline ----------

/** Wraps the selection in `mark` (bold `**`, italic `*`, strike `~~`, code `` ` ``), or unwraps it. */
export function toggleInline(e: Edit, mark: string): Edit {
  const { value, start, end } = e;
  const n = mark.length;
  const sel = value.slice(start, end);
  // `*` must not be mistaken for the edge of a `**` pair.
  const stray = (i: number): boolean => mark === "*" && value[i] === "*";
  const around = value.slice(start - n, start) === mark && value.slice(end, end + n) === mark
    && !stray(start - n - 1) && !stray(end + n);
  if (around) {
    return { value: value.slice(0, start - n) + sel + value.slice(end + n), start: start - n, end: end - n };
  }
  if (sel.length > 2 * n && sel.startsWith(mark) && sel.endsWith(mark) && !(mark === "*" && sel.startsWith("**"))) {
    const inner = sel.slice(n, sel.length - n);
    return { value: value.slice(0, start) + inner + value.slice(end), start, end: start + inner.length };
  }
  return { value: value.slice(0, start) + mark + sel + mark + value.slice(end), start: start + n, end: end + n };
}

/** Link: the selection becomes the text and `url` is selected; a selected URL becomes the target. */
export function insertLink(e: Edit): Edit {
  const { value, start, end } = e;
  const sel = value.slice(start, end);
  if (/^(https?:\/\/|mailto:)\S+$/i.test(sel)) {
    return { value: `${value.slice(0, start)}[](${sel})${value.slice(end)}`, start: start + 1, end: start + 1 };
  }
  const text = sel || "text";
  const next = `${value.slice(0, start)}[${text}](url)${value.slice(end)}`;
  if (!sel) return { value: next, start: start + 1, end: start + 1 + text.length };
  const urlAt = start + text.length + 3;
  return { value: next, start: urlAt, end: urlAt + 3 };
}

// ---------- blocks ----------

/** Puts `block` in place of an empty current line, or on its own lines after a written one. */
function insertBlock(e: Edit, block: string, caret: number): Edit {
  const { value } = e;
  const from = value.lastIndexOf("\n", e.start - 1) + 1;
  const nl = value.indexOf("\n", e.start);
  const to = nl === -1 ? value.length : nl;
  if (!value.slice(from, to).trim()) {
    return { value: value.slice(0, from) + block + value.slice(to), start: from + caret, end: from + caret };
  }
  return { value: `${value.slice(0, to)}\n${block}${value.slice(to)}`, start: to + 1 + caret, end: to + 1 + caret };
}

export const TABLE_TEMPLATE = "| Column | Column |\n| --- | --- |\n|  |  |\n";

export function applyFormat(e: Edit, f: BlockFormat): Edit {
  switch (f) {
    case "bold": return toggleInline(e, "**");
    case "italic": return toggleInline(e, "*");
    case "strike": return toggleInline(e, "~~");
    case "code": return toggleInline(e, "`");
    case "link": return insertLink(e);
    case "divider": return insertBlock(e, "---\n", 4);
    case "codeBlock": return insertBlock(e, "```\n\n```\n", 4);
    case "table": return insertBlock(e, TABLE_TEMPLATE, 2);
    default: return setBlock(e, f);
  }
}

// ---------- indentation ----------

const STEP = "  ";

/** Tab / Shift+Tab. Lines of a selection or a list item shift by two spaces; a caret elsewhere types them. */
export function indent(e: Edit, out: boolean): Edit {
  const multi = e.value.slice(e.start, e.end).includes("\n");
  const line = e.value.slice(e.value.lastIndexOf("\n", e.start - 1) + 1).split("\n")[0];
  if (!out && !multi && !parseLine(line).kind && e.start === e.end) {
    return { value: e.value.slice(0, e.start) + STEP + e.value.slice(e.end), start: e.start + 2, end: e.start + 2 };
  }
  const shifted = mapLines(e, (l) => (out ? l.replace(/^ {1,2}|^\t/, "") : l.trim() ? STEP + l : l));
  return renumber(shifted);
}

// ---------- Enter in a list ----------

/** Enter on a list line: continue the list, or end it on an empty item. Null = let the browser type. */
export function continueList(e: Edit): Edit | null {
  if (e.start !== e.end) return null;
  const { value, start } = e;
  const from = value.lastIndexOf("\n", start - 1) + 1;
  const nl = value.indexOf("\n", start);
  const to = nl === -1 ? value.length : nl;
  const line = value.slice(from, to);
  const p = parseLine(line);
  if (!p.kind || start - from < p.prefixLen) return null;
  if (!p.rest.trim() && start === to) {
    // Empty item: one level out, or out of the list.
    const stripped = p.indent.length >= 2 ? p.indent.slice(2) + line.slice(p.indent.length) : "";
    const replaced = p.indent.length >= 2 ? stripped : "";
    const next = value.slice(0, from) + replaced + value.slice(to);
    return renumber({ value: next, start: from + replaced.length, end: from + replaced.length });
  }
  const mark = p.kind === "numbered" ? `${p.num + 1}${p.marker} ` : p.kind === "task" ? `${p.marker} [ ] ` : `${p.marker} `;
  const insert = `\n${p.indent}${mark}`;
  const next = value.slice(0, start) + insert + value.slice(start);
  const pos = start + insert.length;
  return renumber({ value: next, start: pos, end: pos });
}

// ---------- renumbering ----------

/** Renumbers every ordered list from the number its first item carries, level by level. */
export function renumber(e: Edit): Edit {
  const lines = e.value.split("\n");
  const counters = new Map<number, number>();
  const deltas: number[] = [];
  let changed = false;
  const out = lines.map((line, i) => {
    deltas[i] = 0;
    const p = parseLine(line);
    const w = p.indent.replace(/\t/g, "  ").length;
    if (!p.kind) {
      if (line.trim()) counters.clear();
      return line;
    }
    for (const k of [...counters.keys()]) if (k > w) counters.delete(k);
    if (p.kind !== "numbered") { counters.delete(w); return line; }
    const num = counters.has(w) ? counters.get(w)! + 1 : p.num;
    counters.set(w, num);
    if (num === p.num) return line;
    changed = true;
    const fixed = `${p.indent}${num}${p.marker} ${p.rest}`;
    deltas[i] = fixed.length - line.length;
    return fixed;
  });
  if (!changed) return e;
  const shift = (pos: number): number => {
    let off = 0;
    let delta = 0;
    for (let i = 0; i < lines.length; i++) {
      const end = off + lines[i].length;
      if (pos <= end) return pos + delta + (pos - off > parseLine(lines[i]).indent.length ? deltas[i] : 0);
      delta += deltas[i];
      off = end + 1;
    }
    return pos + delta;
  };
  const value = out.join("\n");
  return { value, start: Math.min(shift(e.start), value.length), end: Math.min(shift(e.end), value.length) };
}

// ---------- moving lines ----------

export function moveLines(e: Edit, dir: -1 | 1): Edit {
  const { value } = e;
  const { from, to } = lineSpan(e);
  if (dir < 0) {
    if (from === 0) return e;
    const prevFrom = value.lastIndexOf("\n", from - 2) + 1;
    const prev = value.slice(prevFrom, from - 1);
    const cur = value.slice(from, to);
    const next = value.slice(0, prevFrom) + cur + "\n" + prev + value.slice(to);
    const d = prev.length + 1;
    return renumber({ value: next, start: e.start - d, end: e.end - d });
  }
  if (to >= value.length) return e;
  const nl = value.indexOf("\n", to + 1);
  const nextTo = nl === -1 ? value.length : nl;
  const nextLine = value.slice(to + 1, nextTo);
  const cur = value.slice(from, to);
  const next = value.slice(0, from) + nextLine + "\n" + cur + value.slice(nextTo);
  const d = nextLine.length + 1;
  return renumber({ value: next, start: e.start + d, end: e.end + d });
}

// ---------- typing conveniences ----------

/** After a keystroke: "[] " at line start becomes a task, "1) " becomes "1. ". Null = nothing to do. */
export function autoFormat(e: Edit): Edit | null {
  if (e.start !== e.end) return null;
  const { value, start } = e;
  const from = value.lastIndexOf("\n", start - 1) + 1;
  const head = value.slice(from, start);
  const m = /^(\s*)(?:\[\]|\[ \]) $/.exec(head);
  if (m) {
    const lead = `${m[1]}- [ ] `;
    return { value: value.slice(0, from) + lead + value.slice(start), start: from + lead.length, end: from + lead.length };
  }
  const n = /^(\s*)(\d+)\) $/.exec(head);
  if (n) {
    const lead = `${n[1]}${n[2]}. `;
    return renumber({ value: value.slice(0, from) + lead + value.slice(start), start: from + lead.length, end: from + lead.length });
  }
  return null;
}

// ---------- "/" menu ----------

export const SLASH_COMMANDS: { id: BlockFormat; keywords: string }[] = [
  { id: "h1", keywords: "h1 heading title 1" },
  { id: "h2", keywords: "h2 heading title 2" },
  { id: "h3", keywords: "h3 heading title 3" },
  { id: "bullet", keywords: "bullet list ul puce" },
  { id: "numbered", keywords: "numbered ordered list ol" },
  { id: "task", keywords: "task todo checkbox check" },
  { id: "quote", keywords: "quote blockquote citation" },
  { id: "codeBlock", keywords: "code block pre" },
  { id: "divider", keywords: "divider rule hr line separator" },
  { id: "table", keywords: "table grid" },
];

/** The "/query" typed at the start of the caret's line, or null. `from` = index of the slash. */
export function slashContext(value: string, caret: number): { from: number; query: string } | null {
  const lineFrom = value.lastIndexOf("\n", caret - 1) + 1;
  const m = /^(\s*)\/([\p{L}\d]*)$/u.exec(value.slice(lineFrom, caret));
  return m ? { from: lineFrom + m[1].length, query: m[2].toLowerCase() } : null;
}

export function filterSlash(query: string, label: (id: BlockFormat) => string = (id) => id): typeof SLASH_COMMANDS {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((c) => c.keywords.includes(q) || label(c.id).toLowerCase().includes(q));
}

/** Removes the typed "/query" and applies the chosen command in its place. */
export function applySlash(value: string, ctx: { from: number; query: string }, caret: number, f: BlockFormat): Edit {
  const cleared = value.slice(0, ctx.from) + value.slice(caret);
  return applyFormat({ value: cleared, start: ctx.from, end: ctx.from }, f);
}

// ---------- shortcuts ----------

// Shown in the tooltips of the formatting bar; `shortcutFormat` is the matching reader.
export const FORMAT_SHORTCUTS: Partial<Record<BlockFormat, string>> = {
  bold: "Ctrl+B", italic: "Ctrl+I", strike: "Ctrl+Shift+X", code: "Ctrl+E", link: "Ctrl+K",
  h1: "Ctrl+1", h2: "Ctrl+2", h3: "Ctrl+3", paragraph: "Ctrl+0",
  numbered: "Ctrl+Shift+7", bullet: "Ctrl+Shift+8", task: "Ctrl+Shift+9",
};

export interface KeyLike { key: string; code: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }

/** The format a Ctrl/Cmd shortcut stands for, or null. Digits read the physical key (AZERTY needs Shift for them). */
export function shortcutFormat(k: KeyLike): BlockFormat | null {
  if (!(k.ctrlKey || k.metaKey) || k.altKey) return null;
  if (k.shiftKey) {
    if (k.key.toLowerCase() === "x") return "strike";
    return ({ Digit7: "numbered", Digit8: "bullet", Digit9: "task" } as Record<string, BlockFormat>)[k.code] ?? null;
  }
  const letter = ({ b: "bold", i: "italic", e: "code", k: "link" } as Record<string, BlockFormat>)[k.key.toLowerCase()];
  if (letter) return letter;
  return ({ Digit0: "paragraph", Digit1: "h1", Digit2: "h2", Digit3: "h3" } as Record<string, BlockFormat>)[k.code] ?? null;
}

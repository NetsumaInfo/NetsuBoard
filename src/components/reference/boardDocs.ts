// Documents on the board, pure part: file name -> document type, a tiny CSV parser, a tiny and safe
// Markdown renderer, card geometry. No DOM and no heavy library here (the rendering side is
// boardDocRender.ts, loaded lazily) so everything in this file is unit-tested under node.

export type DocType = "pdf" | "docx" | "text" | "markdown" | "csv" | "file";

const TEXT_EXT = new Set([
  "txt", "log", "json", "srt", "ass", "ssa", "vtt", "xml", "yaml", "yml", "ini", "cfg", "conf", "toml",
  "nfo", "lrc", "tex", "bat", "sh", "js", "tsx", "jsx", "py", "rs", "css", "html", "htm",
]);
const MARKDOWN_EXT = new Set(["md", "markdown"]);
const CSV_EXT = new Set(["csv", "tsv"]);

/** Extensions the core accepts in `saveAsset` for a document (mirrors `EXT_OK` in core/reference.js). */
export const DOC_SAVE_EXTS = new Set([
  "pdf", "docx", "doc", "odt", "rtf", "xlsx", "xls", "ods", "pptx", "ppt", "odp", "zip", "rar", "7z",
  "txt", "log", "json", "srt", "ass", "ssa", "vtt", "xml", "yaml", "yml", "ini", "cfg", "conf", "toml",
  "nfo", "lrc", "tex", "md", "markdown", "csv", "tsv", "bin",
]);

/** Lower-case extension of a name or path, without the dot ("" when there is none). */
export function docExt(nameOrPath: string): string {
  const base = nameOrPath.split(/[?#]/)[0].split(/[\\/]/).pop() || "";
  const dot = base.lastIndexOf(".");
  return dot > 0 || (dot === 0 && base.length > 1) ? base.slice(dot + 1).toLowerCase() : "";
}

/**
 * Document type of a file, or null when it is not a document candidate (no extension and no
 * document MIME). Images and videos are the caller's business: ask this only for the rest.
 * Everything with an extension that is not readable here is a plain "file" card.
 */
export function docTypeOf(nameOrPath: string, mime = ""): DocType | null {
  const ext = docExt(nameOrPath);
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (MARKDOWN_EXT.has(ext)) return "markdown";
  if (CSV_EXT.has(ext)) return "csv";
  if (TEXT_EXT.has(ext)) return "text";
  if (ext) return "file";
  return null;
}

/** Extension under which the original bytes are saved when the file has no disk path. */
export function docSaveExt(name: string): string {
  const ext = docExt(name);
  return DOC_SAVE_EXTS.has(ext) ? ext : "bin";
}

/** Types whose live viewer is a reader inside the card (a plain "file" just opens its app). */
export const isReadable = (type: DocType): boolean => type !== "file";

/** Long side (board px) of a freshly placed document card: bigger than a photo, never tiny. */
export const DOC_MIN_SIDE = 560;
export function docLongSide(type: DocType, mediaMaxSize: number): number {
  const box = Math.max(1, mediaMaxSize || 0);
  return type === "file" ? box : Math.max(box, DOC_MIN_SIDE);
}

/** Card size for a page of `natW`x`natH` whose long side is `long` (scales up as well as down). */
export function docCardSize(natW: number, natH: number, long: number): { w: number; h: number } {
  if (!(natW > 0) || !(natH > 0)) return { w: Math.round(long * 0.75), h: long };
  const k = long / Math.max(natW, natH);
  return { w: Math.max(1, Math.round(natW * k)), h: Math.max(1, Math.round(natH * k)) };
}

export function formatBytes(n: number): string {
  if (!(n >= 0)) return "";
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

// --- Pages (PDF) ------------------------------------------------------------------------------

export const PDF_EXTRACT_MAX = 100;
export const PDF_EXTRACT_SIDE = 2048;

/** Pages to extract from a document of `total` pages (capped). */
export function extractCount(total: number): number {
  return Math.max(0, Math.min(Math.floor(total) || 0, PDF_EXTRACT_MAX));
}

/** Previous / next page in carousel mode, clamped (1-based). */
export function stepPage(current: number, dir: 1 | -1, total: number): number {
  return Math.min(Math.max(1, total), Math.max(1, current + dir));
}

/**
 * Grid of `count` cells of `cellW`x`cellH`, its top-left corner at `origin`, `cols = ceil(sqrt(n))`.
 * Used to lay extracted pages next to their PDF card.
 */
export function gridFrom(
  count: number,
  cellW: number,
  cellH: number,
  origin: { x: number; y: number },
  gap = 24,
): { x: number; y: number }[] {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  return Array.from({ length: count }, (_, i) => ({
    x: origin.x + (i % cols) * (cellW + gap),
    y: origin.y + Math.floor(i / cols) * (cellH + gap),
  }));
}

// --- CSV (RFC 4180) ---------------------------------------------------------------------------

/** Delimiter of a table: tab for .tsv, else the most frequent of , ; tab in the first line. */
export function csvDelimiter(name: string, text: string): string {
  if (docExt(name) === "tsv") return "\t";
  const first = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  let best = ",";
  let bestN = 0;
  for (const d of [",", ";", "\t"]) {
    const n = first.split(d).length - 1;
    if (n > bestN) { best = d; bestN = n; }
  }
  return best;
}

/** RFC 4180 parser: quoted fields, doubled quotes, newlines inside quotes, CRLF or LF. */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let touched = false; // the current row holds something (even an empty quoted field)
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") { quoted = true; touched = true; }
    else if (c === delimiter) { row.push(field); field = ""; touched = true; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      if (touched || field !== "") { row.push(field); rows.push(row); }
      row = []; field = ""; touched = false;
    } else { field += c; touched = true; }
  }
  if (touched || field !== "") { row.push(field); rows.push(row); }
  return rows;
}

// --- Markdown (small, safe) -------------------------------------------------------------------

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

// Inline syntax on TEXT THAT IS ALREADY ESCAPED: nothing typed by the author can become markup,
// only what this function writes. Code spans and links are lifted into a stash first, so emphasis
// never rewrites their content or a URL.
const MARK = "\u0000";

function format(escaped: string, stash: string[]): string {
  const keep = (html: string) => {
    stash.push(html);
    return `${MARK}${stash.length - 1}${MARK}`;
  };
  let s = escaped.replace(/`([^`]+)`/g, (_m, code: string) => keep(`<code>${code}</code>`));
  // Images never load anything: the alt text stands in.
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]*)\)/g, (_m, alt: string) => alt);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) =>
    SAFE_HREF.test(url) ? keep(`<a href="${url}">${format(label, stash)}</a>`) : label);
  s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a: string, b: string) => `<strong>${a ?? b}</strong>`);
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_\w])_([^_\s][^_]*)_(?![_\w])/g, "$1<em>$2</em>");
  return s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
}

function inline(escaped: string): string {
  const stash: string[] = [];
  let s = format(escaped.split(MARK).join(""), stash);
  // A stashed link may hold stashed code: unwind until nothing is left.
  const slot = new RegExp(`${MARK}(\\d+)${MARK}`, "g");
  for (let pass = 0; pass < 4 && s.includes(MARK); pass++) {
    s = s.replace(slot, (_m, i: string) => stash[Number(i)] ?? "");
  }
  return s;
}

export interface MarkdownOptions {
  /**
   * "interactive": a task item (`- [ ] x`) is written as a checkbox element carrying its source
   * line (`data-line`) so the caller can flip it. Otherwise it is a plain glyph.
   */
  tasks?: "interactive";
}

interface ListItem { indent: number; ordered: boolean; text: string; line: number; depth: number }

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TASK = /^\[( |x|X)\]\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const HR = /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/;

function taskHtml(done: boolean, body: string, line: number, opts: MarkdownOptions): string {
  if (opts.tasks !== "interactive") return `<li>${done ? "☑" : "☐"} ${body}</li>`;
  return `<li class="md-task"${done ? ' data-done="1"' : ""}><span class="md-box" role="checkbox" aria-checked="${done}" data-line="${line}"></span><span>${body}</span></li>`;
}

// Nested lists by indentation: `depth` is the nesting level, derived with a stack of the indents
// seen so far, so uneven indentation (2 then 3 spaces, tabs) still nests one level at a time.
function listHtml(items: ListItem[], opts: MarkdownOptions): string {
  const stack: number[] = [];
  for (const it of items) {
    while (stack.length && stack[stack.length - 1] > it.indent) stack.pop();
    if (!stack.length || stack[stack.length - 1] < it.indent) stack.push(it.indent);
    it.depth = stack.length - 1;
  }
  let i = 0;
  const build = (depth: number): string => {
    const ordered = items[i].ordered;
    const tag = ordered ? "ol" : "ul";
    let html = `<${tag}>`;
    while (i < items.length && items[i].depth >= depth) {
      if (items[i].depth === depth && items[i].ordered !== ordered) break;
      const it = items[i++];
      const task = TASK.exec(it.text);
      const body = inline(escapeHtml(task ? task[2] : it.text));
      let sub = "";
      while (i < items.length && items[i].depth > depth) sub += build(depth + 1);
      html += task ? taskHtml(task[1] !== " ", body, it.line, opts).replace(/<\/li>$/, `${sub}</li>`) : `<li>${body}${sub}</li>`;
    }
    return `${html}</${tag}>`;
  };
  let out = "";
  while (i < items.length) out += build(0);
  return out;
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function pipeTable(rows: string[]): string {
  const head = splitRow(rows[0]);
  const align = splitRow(rows[1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : ""));
  const cell = (tag: string, v: string | undefined, c: number) =>
    `<${tag}${align[c] ? ` style="text-align:${align[c]}"` : ""}>${inline(escapeHtml(v ?? ""))}</${tag}>`;
  const line = (tag: string, r: string[]) => `<tr>${head.map((_h, c) => cell(tag, r[c], c)).join("")}</tr>`;
  return `<table><thead>${line("th", head)}</thead><tbody>${rows.slice(2).map((r) => line("td", splitRow(r))).join("")}</tbody></table>`;
}

/**
 * Markdown to HTML: headings, nested bullet / numbered / task lists, bold / italic / strike,
 * links, inline code, code blocks, quotes, rules and pipe tables. HTML is escaped first.
 */
export function renderMarkdown(src: string, opts: MarkdownOptions = {}): string {
  const lines = src.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  const isTableAt = (n: number) =>
    n + 1 < lines.length && lines[n].includes("|") && lines[n + 1].includes("|") && TABLE_SEP.test(lines[n + 1])
    && splitRow(lines[n]).length === splitRow(lines[n + 1]).length;
  const startsBlock = (l: string, n: number) =>
    /^\s{0,3}(#{1,6}\s|>|```)/.test(l) || LIST_ITEM.test(l) || HR.test(l) || isTableAt(n);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = /^\s{0,3}```/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s{0,3}```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) { out.push(`<h${h[1].length}>${inline(escapeHtml(h[2]))}</h${h[1].length}>`); i++; continue; }
    if (HR.test(line)) { out.push("<hr>"); i++; continue; }
    if (/^\s{0,3}>/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) q.push(lines[i++].replace(/^\s{0,3}>\s?/, ""));
      out.push(`<blockquote>${inline(escapeHtml(q.join(" ")))}</blockquote>`);
      continue;
    }
    if (isTableAt(i)) {
      const rows = [lines[i], lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) rows.push(lines[i++]);
      out.push(pipeTable(rows));
      continue;
    }
    if (LIST_ITEM.test(line) && !HR.test(line)) {
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i]);
        if (!m || HR.test(lines[i])) break;
        items.push({ indent: m[1].replace(/\t/g, "    ").length, ordered: /^\d/.test(m[2]), text: m[3], line: i, depth: 0 });
        i++;
      }
      out.push(listHtml(items, opts));
      continue;
    }
    const para: string[] = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], i)) para.push(lines[i++].trim());
    out.push(`<p>${inline(escapeHtml(para.join(" ")))}</p>`);
  }
  return out.join("\n");
}

/** Rows to an HTML table; the first row is the header. `limit` caps the rows written. */
export function tableHtml(rows: string[][], limit = Infinity): string {
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const cell = (tag: string, v: string | undefined) => `<${tag}>${escapeHtml(v ?? "")}</${tag}>`;
  const line = (tag: string, r: string[]) => `<tr>${Array.from({ length: width }, (_, c) => cell(tag, r[c])).join("")}</tr>`;
  const body = rows.slice(1, Number.isFinite(limit) ? limit + 1 : undefined).map((r) => line("td", r)).join("");
  return `<table><thead>${line("th", rows[0])}</thead><tbody>${body}</tbody></table>`;
}

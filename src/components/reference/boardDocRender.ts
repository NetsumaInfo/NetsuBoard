// Document rendering of the board, lazy side: Word (mammoth, BSD-2-Clause), text / Markdown / CSV
// to sanitised HTML, and the card thumbnail (html-to-image, MIT, or plain canvas for a "file").
// Loaded only when a document is added or opened; never at board start.

import "./docPaper.css";
import {
  type DocType, csvDelimiter, docExt, escapeHtml, formatBytes, parseCsv, renderMarkdown, tableHtml,
} from "./boardDocs";

export const DOC_THUMB_W = 800;
export const DOC_THUMB_H = 1000;
export const FILE_THUMB_H = 600;

const MAX_TEXT_BYTES = 1_000_000;
const MAX_CSV_BYTES = 2_000_000;
const THUMB_TABLE_ROWS = 40;
const LIVE_TABLE_ROWS = 5000;

// --- Sanitising -------------------------------------------------------------------------------

const ALLOWED_TAGS = new Set([
  "a", "b", "strong", "i", "em", "u", "s", "del", "sub", "sup", "br", "hr", "p", "div", "span",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "code",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "img",
]);
// Dropped with everything inside; any other unknown tag is unwrapped (its text survives).
const DROP_TAGS = new Set(["script", "style", "iframe", "object", "embed", "link", "meta", "svg", "math", "form", "template", "noscript", "base"]);

/**
 * Allowlist sanitiser. The markup is parsed by DOMParser (inert: nothing runs, nothing loads), then
 * rebuilt: no script, no event handler, no style attribute, only http(s)/mailto links, and images
 * only as `data:image/` (no external fetch).
 */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const clean = (node: Element): void => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase();
      if (DROP_TAGS.has(tag)) { child.remove(); continue; }
      clean(child);
      if (!ALLOWED_TAGS.has(tag)) { child.replaceWith(...Array.from(child.childNodes)); continue; }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim();
        const ok =
          (tag === "a" && name === "href" && /^(https?:|mailto:)/i.test(value))
          || (tag === "img" && name === "src" && /^data:image\//i.test(value))
          || (tag === "img" && name === "alt")
          || ((tag === "td" || tag === "th") && (name === "colspan" || name === "rowspan") && /^\d{1,3}$/.test(value));
        if (!ok) child.removeAttribute(attr.name);
      }
      if (tag === "img" && !child.getAttribute("src")) child.remove();
      if (tag === "a") child.setAttribute("rel", "noreferrer noopener");
    }
  };
  clean(doc.body);
  return doc.body.innerHTML;
}

// --- Building the HTML of a document ----------------------------------------------------------

function decode(buf: ArrayBuffer, max: number): string {
  return new TextDecoder("utf-8").decode(buf.byteLength > max ? buf.slice(0, max) : buf);
}

async function wordToHtml(buf: ArrayBuffer): Promise<string> {
  const m = await import("mammoth");
  const mammoth = (m as { default?: unknown }).default ?? m;
  const api = mammoth as { convertToHtml: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }> };
  // The default image handler inlines pictures as data: URIs, which the sanitiser keeps.
  return (await api.convertToHtml({ arrayBuffer: buf })).value;
}

/** The sanitised HTML shown on the paper, plus whether it uses the monospace "plain" look. */
export async function buildDocHtml(
  type: DocType,
  buf: ArrayBuffer,
  name: string,
  opts: { thumb?: boolean } = {},
): Promise<{ html: string; plain: boolean }> {
  if (type === "docx") return { html: sanitizeHtml(await wordToHtml(buf)), plain: false };
  if (type === "markdown") return { html: sanitizeHtml(renderMarkdown(decode(buf, MAX_TEXT_BYTES))), plain: false };
  if (type === "csv") {
    const text = decode(buf, MAX_CSV_BYTES);
    const rows = parseCsv(text, csvDelimiter(name, text));
    return { html: tableHtml(rows, opts.thumb ? THUMB_TABLE_ROWS : LIVE_TABLE_ROWS), plain: false };
  }
  const text = decode(buf, opts.thumb ? 20_000 : MAX_TEXT_BYTES);
  return { html: `<pre>${escapeHtml(text)}</pre>`, plain: true };
}

export async function fetchDocBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`document fetch ${res.status}`);
  return res.arrayBuffer();
}

// --- Thumbnails -------------------------------------------------------------------------------

const toBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));

// Canvas fallback when the HTML rasteriser fails: the first lines of the plain text on paper.
async function textThumb(text: string): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = DOC_THUMB_W;
  canvas.height = DOC_THUMB_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1b1b1f";
  ctx.font = "20px ui-monospace, Consolas, monospace";
  ctx.textBaseline = "top";
  const maxW = DOC_THUMB_W - 80;
  const bottom = DOC_THUMB_H - 60;
  let y = 40;
  for (const raw of text.split(/\r?\n/)) {
    let line = "";
    for (const word of raw.split(/(\s+)/)) {
      if (line && ctx.measureText(line + word).width > maxW) {
        ctx.fillText(line, 40, y);
        y += 28;
        line = word.trimStart();
        if (y > bottom) break;
      } else line += word;
    }
    if (y > bottom) break;
    ctx.fillText(line, 40, y);
    y += 28;
  }
  const blob = await toBlob(canvas);
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error("thumbnail encode failed");
  return blob;
}

/** First screen of a readable document, as an 800x1000 PNG on white paper. */
export async function renderDocThumb(
  type: Exclude<DocType, "pdf" | "file">,
  buf: ArrayBuffer,
  name: string,
): Promise<{ blob: Blob; w: number; h: number }> {
  const { html, plain } = await buildDocHtml(type, buf, name, { thumb: true });
  // Offscreen host (positioned on the wrapper, so the captured node itself carries no offset).
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${DOC_THUMB_W}px;height:${DOC_THUMB_H}px;overflow:hidden;pointer-events:none;`;
  const paper = document.createElement("div");
  paper.className = plain ? "doc-paper doc-plain" : "doc-paper";
  paper.style.cssText = `width:${DOC_THUMB_W}px;height:${DOC_THUMB_H}px;font-size:${type === "csv" ? 18 : 20}px;overflow:hidden;`;
  paper.innerHTML = html;
  host.appendChild(paper);
  document.body.appendChild(host);
  try {
    const { toBlob: rasterise } = await import("html-to-image");
    const blob = await rasterise(paper, {
      width: DOC_THUMB_W,
      height: DOC_THUMB_H,
      pixelRatio: 1,
      backgroundColor: "#fff",
      skipFonts: true,
      cacheBust: false,
    });
    if (!blob) throw new Error("rasteriser returned nothing");
    return { blob, w: DOC_THUMB_W, h: DOC_THUMB_H };
  } catch {
    return { blob: await textThumb(paper.innerText), w: DOC_THUMB_W, h: DOC_THUMB_H };
  } finally {
    host.remove();
  }
}

const BADGE: Record<string, string> = {
  doc: "#2b7de9", docx: "#2b7de9", odt: "#2b7de9", rtf: "#2b7de9",
  xls: "#2ba24c", xlsx: "#2ba24c", ods: "#2ba24c",
  ppt: "#e08a2b", pptx: "#e08a2b", odp: "#e08a2b",
  zip: "#a86bd6", rar: "#a86bd6", "7z": "#a86bd6",
};

/** Card for a file this board cannot read: extension badge, file name, size. */
export async function renderFileThumb(name: string, size: number): Promise<{ blob: Blob; w: number; h: number }> {
  const w = DOC_THUMB_W;
  const h = FILE_THUMB_H;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  const ext = docExt(name);
  ctx.fillStyle = "#f3f4f7";
  ctx.fillRect(0, 0, w, h);
  const bw = 240;
  const bh = 280;
  const bx = (w - bw) / 2;
  const by = 70;
  ctx.fillStyle = BADGE[ext] ?? "#6b7280";
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 24);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath();
  ctx.moveTo(bx + bw - 64, by);
  ctx.lineTo(bx + bw, by + 64);
  ctx.lineTo(bx + bw - 64, by + 64);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = (ext || "file").slice(0, 5).toUpperCase();
  ctx.font = `700 ${label.length > 3 ? 64 : 84}px system-ui, "Segoe UI", sans-serif`;
  ctx.fillText(label, w / 2, by + bh / 2 + 20);
  // Name: two lines at most, ellipsis on the last one.
  ctx.fillStyle = "#1b1b1f";
  ctx.font = '600 34px system-ui, "Segoe UI", sans-serif';
  const maxW = w - 120;
  const lines: string[] = [];
  let line = "";
  for (const word of name.split(/(?<=[\s._-])/)) {
    if (line && ctx.measureText(line + word).width > maxW) { lines.push(line); line = word; } else line += word;
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, 2).map((l, i, a) => {
    let out = l.trimEnd();
    if (i === a.length - 1 && lines.length > 2) out += "…";
    while (out.length > 1 && ctx.measureText(out).width > maxW) out = `${out.slice(0, -2)}…`;
    return out;
  });
  shown.forEach((l, i) => ctx.fillText(l, w / 2, 420 + i * 44));
  ctx.fillStyle = "#6b7280";
  ctx.font = '500 28px system-ui, "Segoe UI", sans-serif';
  const sizeText = formatBytes(size);
  if (sizeText) ctx.fillText(sizeText, w / 2, 420 + shown.length * 44 + 18);
  const blob = await toBlob(canvas);
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error("thumbnail encode failed");
  return { blob, w, h };
}

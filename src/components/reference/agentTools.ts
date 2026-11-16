// AI agent tools (MCP): what an agent asks through core/mcp.js is carried out HERE, through the
// same store actions and board handle as the mouse. That is the whole point of running them in the
// renderer: every edit lands in the undo history, the autosave and the collaboration sync exactly
// like a hand edit, and nothing a tool does can reach a state the interface could not.
//
// The tool names and argument schemas are declared in core/mcp.js; the two lists stay in step.

import type { AgentAnswer } from "@/lib/bridge";
import { nr } from "@/lib/bridge";
import type { BoardHandle } from "./ReferenceBoard";
import { useBoard, type ResetKind } from "./useReferenceBoard";
import type { useScenePersistence } from "./useScenePersistence";
import type { useProjectActions } from "./useProjectActions";
import { boundsOf, rotatedBBox, type ArrangeMode, type NormalizeMode } from "./boardArrange";
import {
  displaySrc, makeBlockItem, makeFrameItem, makeNoteItem, makePaletteItem, makeTextItem, uid,
  PALETTE_HEIGHT, PALETTE_SWATCH, type BoardItem, type DrawShape,
} from "./referenceShared";
import { noteMode, type NoteMode } from "./blockModel";
import { switchNoteMode } from "./blockActions";
import { exportLayout, renderBoardCanvas, renderBoardSvg } from "./boardRender";
import { extractPaletteToBoard } from "./boardPaletteActions";
import {
  convertToEmbed, downloadMediaFromEmbed, downloadYoutube, recoverMedia, reloadMedia, reloadableMedia, revertSequence,
} from "./boardMediaActions";
import { quickUpscale } from "./boardUpscale";
import { FRAME_PAD, FRAME_TOP, frameContentIds } from "./boardFrames";
import {
  deleteLinks, linkItemsTo, linkSelection, organiseLinks, patchLinks, reverseLinks, unlinkItems,
} from "./links/linkActions";
import type { OrganiseMode } from "./links/graph";

export interface AgentContext {
  board: React.RefObject<BoardHandle | null>;
  persistence: ReturnType<typeof useScenePersistence>;
  project: ReturnType<typeof useProjectActions>;
  goBoard: () => void;
}

type Args = Record<string, unknown>;
// A drawing shape as an agent writes it: raw points, or a box, items to circle, two ends.
type PointRef = string | { x: number; y: number };
type ShapeInput = Partial<DrawShape> & {
  box?: { x: number; y: number; w: number; h: number };
  around?: string[];
  pad?: number;
  from?: PointRef;
  to?: PointRef;
  x?: number;
  y?: number;
  size?: number;
  color?: string;
  width?: number;
};
type Tool = (args: Args, ctx: AgentContext) => Promise<unknown> | unknown;

class ToolError extends Error {}
const fail = (message: string): never => { throw new ToolError(message); };

const st = () => useBoard.getState();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const text = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
/** Frame title size that reads at the zoom its content is read at: a notch above the largest
 *  wrapped text, else proportional to the frame width. */
function frameTitleSize(content: BoardItem[], width: number): number {
  const texts = content.map((it) => it.fontSize ?? 0).filter((v) => v > 0);
  const size = texts.length ? Math.max(...texts) * 1.2 : width / 20;
  return Math.round(Math.min(400, Math.max(14, size)));
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], name: string): T {
  if (typeof v === "string" && (allowed as readonly string[]).includes(v)) return v as T;
  return fail(`${name} must be one of: ${allowed.join(", ")}.`);
}
const ARRANGE = ["left", "hcenter", "right", "top", "vcenter", "bottom", "hdist", "vdist", "grid", "block", "pack", "row", "col"] as const;
const LAYOUTS = ["grid", "block", "pack", "row", "col"] as const;
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const topZ = () => st().items.reduce((m, it) => Math.max(m, it.z), 0) + 1;
const itemIds = () => new Set(st().items.map((it) => it.id));
const byId = (id: string) => st().items.find((it) => it.id === id) ?? fail(`No item ${id} on the level on screen.`);
const note = () => import("./note/noteExport");

// Ids given, or the selection. Unknown ids are refused rather than silently skipped: an agent that
// guessed an id should learn it at once, not three tools later.
function targets(args: Args, min = 1): string[] {
  if (args.ids !== undefined && !Array.isArray(args.ids)) fail("ids must be a list of item ids.");
  const given = list(args.ids);
  const ids = given.length ? given : st().selectedIds;
  const known = itemIds();
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length) fail(`Unknown item ids: ${missing.join(", ")}`);
  if (ids.length < min) fail(min > 1 ? `Give at least ${min} items (ids or a selection).` : "Give item ids or select items first.");
  return ids;
}

// Board point at the centre of the window (the board fills it).
function viewCenter(): { x: number; y: number } {
  const v = st().view;
  return { x: (window.innerWidth / 2 - v.tx) / v.scale, y: (window.innerHeight / 2 - v.ty) / v.scale };
}

// Where a new item goes when the agent gives no place: the free spot nearest the view centre.
// Dropping everything on the centre stacked an agent's whole session into one pile.
function at(args: Args, w: number, h: number): { x: number; y: number } {
  const x = num(args.x);
  const y = num(args.y);
  if (x !== undefined && y !== undefined) return { x, y };
  const c = viewCenter();
  if (x !== undefined || y !== undefined) return { x: x ?? c.x - w / 2, y: y ?? c.y - h / 2 };
  return freeSpot(w, h, { x: c.x - w / 2, y: c.y - h / 2 });
}

type Rect = { x: number; y: number; w: number; h: number };
const SPACING = 40;

function boxOf(it: BoardItem): Rect {
  if (!it.rotation) return { x: it.x, y: it.y, w: it.w, h: it.h };
  const b = rotatedBBox(it);
  return { x: b.x, y: b.y, w: b.w, h: b.h };
}

function meets(a: Rect, b: Rect, gap = 0): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

function inside(inner: Rect, outer: Rect): boolean {
  return inner.x >= outer.x - 1 && inner.y >= outer.y - 1 && inner.x + inner.w <= outer.x + outer.w + 1 && inner.y + inner.h <= outer.y + outer.h + 1;
}

// Nearest spot to `pref` where a w×h box touches nothing on the level (with SPACING around it).
// Searched on square rings around `pref`; the closest free candidate of the first ring that has one.
function freeSpot(w: number, h: number, pref: { x: number; y: number }, skip: ReadonlySet<string> = new Set()): { x: number; y: number } {
  const obstacles = st().items.filter((it) => it.kind !== "draw" && !skip.has(it.id)).map(boxOf);
  const free = (x: number, y: number) => !obstacles.some((o) => meets({ x, y, w, h }, o, SPACING));
  if (free(pref.x, pref.y)) return pref;
  const step = Math.max(40, Math.min(w, h) / 2);
  for (let ring = 1; ring <= 160; ring++) {
    let best: { x: number; y: number; d: number } | null = null;
    for (let i = -ring; i <= ring; i++) {
      for (const [dx, dy] of [[i, -ring], [i, ring], [-ring, i], [ring, i]]) {
        const x = pref.x + dx * step;
        const y = pref.y + dy * step;
        const d = dx * dx + dy * dy;
        if ((!best || d < best.d) && free(x, y)) best = { x, y, d };
      }
    }
    if (best) return { x: best.x, y: best.y };
  }
  const all = boundsOf(st().items.filter((it) => it.kind !== "draw"));
  return { x: all.x + all.w + SPACING * 2, y: pref.y };
}

// Items that overlap `it`. An item inside a frame is the frame's content, not an overlap.
function overlapsOf(it: BoardItem, pool = st().items): string[] {
  const a = boxOf(it);
  return pool
    .filter((o) => o.id !== it.id && o.kind !== "draw" && meets(a, boxOf(o)))
    .filter((o) => !(o.kind === "frame" && inside(a, boxOf(o))) && !(it.kind === "frame" && inside(boxOf(o), a)))
    .map((o) => o.id);
}

// What an agent reads of an item: no display URL (recomputed, often an objectURL), no binary-sized
// fields unless asked. Drawing shapes are counted, not listed (the `draw` tool lists them).
function lean(it: BoardItem, full = false): Record<string, unknown> {
  const { src: _src, shapes, doc, prevMedia, localMedia, ...rest } = it;
  const out: Record<string, unknown> = full ? { ...rest, prevMedia, localMedia, hasDoc: !!doc, mode: it.kind === "text" ? noteMode(it) : undefined } : {
    id: it.id, kind: it.kind, x: Math.round(it.x), y: Math.round(it.y), w: Math.round(it.w), h: Math.round(it.h),
    rotation: it.rotation || undefined, z: it.z, ref: it.ref || undefined, title: it.title,
    fontSize: it.kind === "text" || it.kind === "frame" ? it.fontSize : undefined,
    text: it.text ? (it.text.length > 400 ? `${it.text.slice(0, 400)}…` : it.text) : undefined,
    mode: it.kind === "text" ? noteMode(it) : undefined,
    url: it.linkCard ? it.ref : it.sourceUrl, colors: it.colors, folder: it.folder || undefined,
    parent: it.parent, opacity: it.opacity, playMode: it.playMode, missing: it.missing ? true : undefined,
    loading: it.loading || undefined,
  };
  if (shapes) out.shapes = shapes.length;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

// The board must be on screen for the handle (ingest, framing) to exist.
async function ensureBoard(ctx: AgentContext): Promise<BoardHandle> {
  ctx.goBoard();
  for (let i = 0; i < 40 && !ctx.board.current; i++) await sleep(50);
  return ctx.board.current ?? fail("The board is not open.");
}

// Ingest is asynchronous (probes, downloads): wait for the new items to land and finish loading.
async function newItems(before: Set<string>, expect: number, timeoutMs = 90000, quietMs = 2500): Promise<string[]> {
  if (expect <= 0) return [];
  const t0 = Date.now();
  let seen: string[] = [];
  let shape = "";
  let stableSince = Date.now();
  let stillSince = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const fresh = st().items.filter((it) => !before.has(it.id));
    const ids = fresh.map((it) => it.id);
    if (ids.join() !== seen.join()) { seen = ids; stableSince = Date.now(); }
    // The ingest measures each medium once it loads, then resizes and lays the batch out again —
    // about a second later. Placing before that was undone by it.
    const geom = fresh.map((it) => `${Math.round(it.x)},${Math.round(it.y)},${Math.round(it.w)},${Math.round(it.h)}`).join(";");
    if (geom !== shape) { shape = geom; stillSince = Date.now(); }
    const measured = (it: BoardItem) => !["image", "video", "sequence"].includes(it.kind) || !!(it.natW && it.natH) || !!it.missing;
    const settled = fresh.length > 0 && fresh.every((it) => !it.loading && measured(it));
    if (settled && fresh.length >= expect && Date.now() - stillSince > 2500) return ids;
    if (settled && Date.now() - stableSince > quietMs) return ids;
    if (!fresh.length && Date.now() - t0 > 15000) return [];
    await sleep(150);
  }
  return seen;
}

// A web image the ingest could only hotlink (the site refused the first download, often a rate
// limit when an agent drops many at once): tried again, spaced out, and swapped for the local file.
// A hotlink goes offline with the site and cannot be exported; a local file stays.
async function storeLocally(it: BoardItem, tries = 3): Promise<boolean> {
  const fetchAsset = nr.reference?.fetchAsset;
  if (!fetchAsset) return false;
  for (let i = 0; i < tries; i++) {
    if (i > 0) await sleep(1500 * i);
    const res = await fetchAsset(it.ref, { projectPath: st().filePath || undefined, title: it.title }).catch(() => null);
    if (res?.ok && res.path && res.kind) {
      if (!st().items.some((x) => x.id === it.id)) return true;
      st().patchItem(it.id, { kind: res.kind, ref: res.path, src: displaySrc(res.kind, res.path), sourceUrl: it.sourceUrl || it.ref });
      return true;
    }
    if (res?.error && /HTTP 4(0[0-9]|1[0-9])/.test(res.error)) return false;
  }
  return false;
}

function clock(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${m}:${(sec - m * 60).toFixed(1).padStart(4, "0")}`;
}

function decodePng(b64: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `data:image/png;base64,${b64}`;
  });
}

// Whether the board can show this address at all (no CORS needed to display).
function imageLoads(src: string, timeoutMs = 15000): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(false), timeoutMs);
    img.onload = () => { clearTimeout(timer); resolve(img.naturalWidth > 0); };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src = src;
  });
}

// Box a text needs at a font size: an average glyph is ~0.6 em wide, a line 1.2 em tall, plus the
// note's own padding. Long lines wrap at `maxW` (default 900 px).
function textBox(value: string, size: number, lineHeight = 1.2, maxW = 900): { w: number; h: number } {
  const PAD = 24;
  const perLine = Math.max(1, Math.floor((maxW - PAD) / (size * 0.6)));
  let lines = 0;
  let longest = 0;
  for (const line of (value || " ").split("\n")) {
    lines += Math.max(1, Math.ceil(line.length / perLine));
    longest = Math.max(longest, Math.min(line.length, perLine));
  }
  return { w: Math.ceil(Math.max(60, longest * size * 0.6 + PAD)), h: Math.ceil(lines * size * lineHeight + PAD) };
}

// Where the segment from an item's centre towards `toward` leaves the item's box: arrows start and
// end on the edges, not in the middle of a picture.
function edgePoint(it: BoardItem, toward: [number, number], gap = 8): [number, number] {
  const cx = it.x + it.w / 2;
  const cy = it.y + it.h / 2;
  const dx = toward[0] - cx;
  const dy = toward[1] - cy;
  if (!dx && !dy) return [cx, cy];
  const t = Math.min(dx ? (it.w / 2 + gap) / Math.abs(dx) : Infinity, dy ? (it.h / 2 + gap) / Math.abs(dy) : Infinity);
  return t >= 1 ? [cx, cy] : [cx + dx * t, cy + dy * t];
}

// Moves a group to x/y when the agent gave one; otherwise to the nearest free spot from `near` (or
// from where the board dropped it), so new things never land on top of others.
const ALIGN_X = new Set(["left", "hcenter", "right"]);
const ALIGN_Y = new Set(["top", "vcenter", "bottom"]);

// The frame that holds every one of `ids`, if any: arranging its content must keep it inside.
function holderOf(ids: string[]): BoardItem | undefined {
  const boxes = ids.map((id) => boxOf(byId(id)));
  return st().items.find((fr) => fr.kind === "frame" && !ids.includes(fr.id) && boxes.every((b) => inside(b, boxOf(fr))));
}

function settle(ids: string[], mode?: string, frame?: BoardItem) {
  let group = ids.map(byId);
  if (mode && (ALIGN_X.has(mode) || ALIGN_Y.has(mode)) && group.some((it) => overlapsOf(it, group).length)) {
    const vertical = ALIGN_X.has(mode);
    const sorted = [...group].sort((p, q) => (vertical ? p.y - q.y : p.x - q.x));
    let at = vertical ? sorted[0].y : sorted[0].x;
    for (const it of sorted) {
      const b = boxOf(it);
      st().patchItem(it.id, vertical ? { y: it.y + (at - b.y) } : { x: it.x + (at - b.x) });
      at += (vertical ? b.h : b.w) + SPACING;
    }
    group = ids.map(byId);
  }
  // Content of a frame: the frame hugs it again and moves with it, never left behind empty.
  let moving = ids;
  if (frame && st().items.some((it) => it.id === frame.id)) {
    const b = boundsOf(group);
    st().patchItem(frame.id, { x: b.x - FRAME_PAD, y: b.y - FRAME_TOP, w: b.w + FRAME_PAD * 2, h: b.h + FRAME_TOP + FRAME_PAD });
    const box = boxOf(byId(frame.id));
    moving = [frame.id, ...st().items.filter((it) => it.id !== frame.id && it.kind !== "draw" && inside(boxOf(it), box)).map((it) => it.id)];
  }
  const outside = st().items.filter((it) => !moving.includes(it.id));
  if (moving.map(byId).some((it) => overlapsOf(it, outside).length)) placeAt(moving, {});
}

// Ingested media can still be reshaped by the board a moment after they look settled: placed, then
// checked once more and moved again if that reshaping put them on something.
async function placeSettled(ids: string[], args: Args) {
  placeAt(ids, args);
  if (num(args.x) !== undefined || num(args.y) !== undefined) return;
  await sleep(1500);
  if (overlapReport(ids.filter((id) => st().items.some((it) => it.id === id))).overlaps) placeAt(ids.filter((id) => st().items.some((it) => it.id === id)), {});
}

// Start point for an ingest batch of `count` media in `groups` framed groups (square grid per group,
// cell = the board's media size + gap), on the free space nearest the view centre.
function batchSpot(count: number, groups = 1): { x: number; y: number } {
  const p = st().prefs;
  const cell = (p.mediaMaxSize || 420) + (p.arrangeGap ?? 24);
  const perGroup = Math.max(1, Math.ceil(count / Math.max(1, groups)));
  const cols = Math.ceil(Math.sqrt(perGroup));
  const w = cols * cell + (groups > 1 ? 2 * FRAME_PAD : 0);
  const h = groups * (Math.ceil(perGroup / cols) * cell + (groups > 1 ? FRAME_TOP + FRAME_PAD + 32 : 0));
  // The ingest poses the batch with `at` as its top-left, then, once measured, CENTRES it on `at`:
  // the free box covers both, and `at` is its point at (w/2, h/2).
  const c = viewCenter();
  const spot = freeSpot(w * 1.5, h * 1.5, { x: c.x - w * 0.75, y: c.y - h * 0.75 });
  return { x: spot.x + w / 2, y: spot.y + h / 2 };
}

function placeAt(ids: string[], args: Args, near?: { x: number; y: number }) {
  if (!ids.length) return;
  const x = num(args.x);
  const y = num(args.y);
  let items = st().items.filter((it) => ids.includes(it.id));
  if (!items.length) return;
  // Landed on top of each other (several files dropped at one point): side by side first.
  if (items.some((it) => overlapsOf(it, items).length)) {
    const top = boundsOf(items);
    let cx = top.x;
    for (const it of items) { st().patchItem(it.id, { x: cx, y: top.y }); cx += it.w + SPACING; }
    items = st().items.filter((it) => ids.includes(it.id));
  }
  const b = boundsOf(items);
  if (x !== undefined || y !== undefined) {
    st().moveBy(ids, x === undefined ? 0 : x - b.x, y === undefined ? 0 : y - b.y);
    return;
  }
  const spot = freeSpot(b.w, b.h, near ?? { x: b.x, y: b.y }, new Set(ids));
  if (spot.x !== b.x || spot.y !== b.y) st().moveBy(ids, spot.x - b.x, spot.y - b.y);
}

function added(ids: string[]) {
  return { ids, added: ids.map((id) => lean(byId(id))), ...overlapReport(ids) };
}

// Every tool that creates or changes items answers with their ids and the overlaps it left.
function changed(ids: string[], key: string, extra: Record<string, unknown> = {}) {
  return { ids, [key]: ids.map((id) => lean(byId(id))), ...extra, ...overlapReport(ids) };
}

// Told back to the agent after anything that places items: it cannot see a pile otherwise.
function overlapReport(ids: string[]): { overlaps?: Record<string, string[]> } {
  const out: Record<string, string[]> = {};
  for (const id of ids) {
    const it = st().items.find((x) => x.id === id);
    const hit = it ? overlapsOf(it).filter((o) => !ids.includes(o)) : [];
    if (hit.length) out[id] = hit;
  }
  return Object.keys(out).length ? { overlaps: out } : {};
}

function overlapPairs(limit = 40): string[][] {
  const pairs: string[][] = [];
  const items = st().items.filter((it) => it.kind !== "draw");
  for (const it of items) {
    for (const o of overlapsOf(it, items)) if (it.id < o && pairs.length < limit) pairs.push([it.id, o]);
  }
  return pairs;
}

function drawShapes(): DrawShape[] {
  return st().items.find((it) => it.kind === "draw")?.shapes ?? [];
}

const textPatch = (args: Args): Partial<BoardItem> => {
  const p: Partial<BoardItem> = {};
  for (const k of ["fontSize", "lineHeight"] as const) if (num(args[k]) !== undefined) p[k] = num(args[k]);
  for (const k of ["fontFamily", "color", "bg", "highlight"] as const) if (text(args[k]) !== undefined) p[k] = text(args[k]);
  for (const k of ["bold", "italic", "underline", "strike"] as const) if (typeof args[k] === "boolean") p[k] = args[k] as boolean;
  if (text(args.align)) p.align = args.align as BoardItem["align"];
  return p;
};

// ── Text measuring ───────────────────────────────────────────────────────────
// Glyph widths come from a canvas with the item's own font, as the board's canvas render does; with
// no DOM (tests) an average glyph of 0.55 em stands in.
const NOTE_PAD = 12; // the p-3 of a text note
const INDENT_STEP = 24;
let measureCtx: CanvasRenderingContext2D | null | undefined;

function measurer(it: BoardItem, size: number): (s: string) => number {
  if (measureCtx === undefined) {
    try { measureCtx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d"); } catch { measureCtx = null; }
  }
  const ctx = measureCtx;
  if (!ctx) return (s) => s.length * size * 0.55;
  ctx.font = `${it.italic ? "italic " : ""}${it.bold ? 700 : 400} ${size}px ${it.fontFamily ?? "Inter, system-ui, sans-serif"}`;
  return (s) => ctx.measureText(s).width;
}

const notePad = (it: BoardItem) => it.padding ?? NOTE_PAD;
const noteLeft = (it: BoardItem) => notePad(it) + (it.indent ? it.indent * INDENT_STEP : 0);

/** Box a text note needs so its text sits on its own lines, without wrapping. */
function fitBox(it: BoardItem): { w: number; h: number } {
  const size = it.fontSize ?? 18;
  const lines = (it.text ?? "").split("\n");
  const width = measurer(it, size);
  const widest = Math.max(0, ...lines.map(width));
  return {
    w: Math.ceil(Math.max(40, widest + noteLeft(it) + notePad(it) + 2)),
    h: Math.ceil(Math.max(size, lines.length * size * (it.lineHeight ?? 1.2)) + notePad(it) * 2),
  };
}

/** Lines the text takes in a box `maxW` wide (word wrap), and whether a single word overflows it. */
function wrapped(it: BoardItem, size: number, maxW: number): { lines: number; overflow: boolean } {
  const width = measurer(it, size);
  let lines = 0;
  let overflow = false;
  for (const para of (it.text ?? "").split("\n")) {
    let line = "";
    let count = 1;
    for (const word of para.split(/(\s+)/)) {
      if (width(word.trim()) > maxW) overflow = true;
      if (line && width(line + word) > maxW) { count++; line = word.trimStart(); } else line += word;
    }
    lines += count;
  }
  return { lines, overflow };
}

/** Largest font size at which the text, wrapped, fills the item's box without overflowing it. */
function sizeToFillBox(it: BoardItem): number {
  const maxW = it.w - noteLeft(it) - notePad(it);
  const maxH = it.h - notePad(it) * 2;
  if (maxW <= 0 || maxH <= 0 || !it.text) return it.fontSize ?? 18;
  const lh = it.lineHeight ?? 1.2;
  const fits = (size: number) => {
    const r = wrapped(it, size, maxW);
    return !r.overflow && r.lines * size * lh <= maxH;
  };
  let lo = 4;
  let hi = 600;
  if (!fits(lo)) return lo;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid; else hi = mid;
  }
  return Math.floor(lo);
}

/** Black or white, whichever reads on `bg`. */
function readableOn(bg: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(bg.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#111827" : "#ffffff";
}

const THEMES: Record<string, { bg: string[]; color: string[] }> = {
  dark: { bg: ["#1f2937", "#111827", "#0f172a", "#1e1b4b", "#1c1917"], color: ["#f9fafb"] },
  pastel: { bg: ["#fde2e4", "#fff1e6", "#e2ece9", "#dfe7fd", "#e8dff5", "#fcf6bd"], color: ["#1f2937"] },
  neon: { bg: ["#0a0a0f"], color: ["#39ff14", "#ff00ff", "#00e5ff", "#fff200", "#ff3131"] },
};
const STYLE_KEYS = [
  "fontSize", "fontFamily", "color", "bg", "highlight", "align", "bold", "italic", "underline", "strike", "lineHeight",
  "opacity", "padding", "valign", "fillMode", "fillColor", "titleBg",
] as const;
const VALIGN = ["top", "middle", "bottom"] as const;
const STEP_COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"];

/** Fields an agent may set through update_items / style_items: `null` removes one, `fit` is handled apart. */
function cleanPatch(raw: Record<string, unknown>): Partial<BoardItem> {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (k === "id" || k === "src" || k === "fit") continue;
    patch[k] = v === null ? undefined : v;
  }
  if (patch.valign !== undefined) oneOf(patch.valign, VALIGN, "valign");
  return patch as Partial<BoardItem>;
}

/** Grows or shrinks plain-text notes to their text. Returns the ids that are not plain text notes. */
function fitTexts(ids: string[]): string[] {
  const skipped: string[] = [];
  for (const id of ids) {
    const it = byId(id);
    if (it.kind !== "text" || noteMode(it) !== "text") { skipped.push(id); continue; }
    st().patchItem(id, fitBox(it));
  }
  return skipped;
}

// ── One undo step for several tool calls ─────────────────────────────────────
// Store mutations of one tick share an undo entry, but tools await between mutations. The entries a
// run pushes are folded into the first one (the snapshot taken before it), so a single undo gives
// the whole run back. On failure that snapshot is restored and dropped from the redo stack.
async function oneUndoStep<T>(run: () => Promise<T>): Promise<T> {
  await sleep(0);
  const base = st().items;
  const fold = async () => {
    await sleep(0);
    const i = st().past.lastIndexOf(base);
    if (i >= 0 && i < st().past.length - 1) useBoard.setState({ past: st().past.slice(0, i + 1) });
    return i >= 0;
  };
  try {
    const out = await run();
    await fold();
    return out;
  } catch (e) {
    if (await fold()) st().undo();
    else if (st().items !== base) useBoard.setState({ items: base, dirty: true });
    useBoard.setState({ future: [] });
    throw e;
  }
}

// In-memory board snapshots (items + parked folder levels + drawing, which is an item), per open board.
interface Checkpoint { items: BoardItem[]; stash: BoardItem[]; at: number; sceneId: string | null; file: string | null; folder: string }
const checkpoints = new Map<string, Checkpoint>();
const levelKey = () => st().folderPath.map((f) => f.id).join("/");

async function canvasImage(items: BoardItem[], args: Args, only?: Set<string>) {
  const width = Math.min(4096, Math.max(64, num(args.width) ?? 1280));
  const canvas = await renderBoardCanvas(items, { width, only, background: text(args.background) === "transparent" ? null : text(args.background) });
  return canvas;
}

function visibleIds(): Set<string> {
  const v = st().view;
  const x0 = -v.tx / v.scale;
  const y0 = -v.ty / v.scale;
  const x1 = x0 + window.innerWidth / v.scale;
  const y1 = y0 + window.innerHeight / v.scale;
  return new Set(st().items.filter((it) => it.kind !== "draw" && it.x < x1 && it.x + it.w > x0 && it.y < y1 && it.y + it.h > y0).map((it) => it.id));
}

// Tools a batch cannot run: they open another board, or move the undo history the batch folds.
const BATCH_REFUSED = new Set(["batch", "scenes", "checkpoint"]);

const TOOLS: Record<string, Tool> = {
  // ── Reading ──────────────────────────────────────────────────────────────
  board_state: () => {
    const s = st();
    const counts: Record<string, number> = {};
    for (const it of s.items) if (it.kind !== "draw") counts[it.kind] = (counts[it.kind] ?? 0) + 1;
    return {
      name: s.sceneName, sceneId: s.sceneId, file: s.filePath, readonly: s.fileReadonly,
      shared: s.collabProjectId ? { role: s.collabRole, members: s.collabMembers.length } : null,
      view: s.view, viewCenter: viewCenter(), window: { w: window.innerWidth, h: window.innerHeight },
      selection: s.selectedIds, counts, parked: s.stash.length, drawShapes: drawShapes().length,
      folderPath: s.folderPath.map((f) => f.id), background: s.background,
      frozen: s.frozen, drawMode: s.drawMode, undo: s.past.length, redo: s.future.length, dirty: s.dirty,
      bounds: s.items.length ? boundsOf(s.items.filter((it) => it.kind !== "draw")) : null,
      overlaps: overlapPairs(),
    };
  },
  list_items: (a) => {
    const kinds = list(a.kinds);
    const only = list(a.ids);
    const pool = a.allLevels ? [...st().items, ...st().stash] : st().items;
    return pool
      .filter((it) => it.kind !== "draw" && (!kinds.length || kinds.includes(it.kind)) && (!only.length || only.includes(it.id)))
      .map((it) => lean(it, !!a.full));
  },
  get_item: async (a) => {
    const it = byId(text(a.id) ?? "");
    const out = lean(it, true);
    if (it.doc?.length) out.markdown = await (await note()).blocksToMarkdown(it.doc);
    return out;
  },
  // The board as text an agent can read and edit: one line per item, and a character map.
  board_map: (a) => {
    const items = st().items.filter((it) => it.kind !== "draw");
    if (!items.length) return { lines: "", map: "(empty board)" };
    const frames = items.filter((it) => it.kind === "frame");
    const holder = (it: BoardItem) => (it.kind === "frame" ? undefined : frames.find((fr) => inside(boxOf(it), boxOf(fr))));
    const label = (it: BoardItem) => (it.title || it.text || it.docFile?.name || it.ref.split(/[\\/]/).pop() || "").replace(/\s+/g, " ").slice(0, 32);
    const sorted = [...items].sort((p, q) => Math.round(p.y / 40) - Math.round(q.y / 40) || p.x - q.x);
    const SYMBOLS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const sym = new Map(sorted.filter((it) => it.kind !== "frame").map((it, i) => [it.id, SYMBOLS[i] ?? "*"]));
    const r0 = (v: number) => Math.round(v);
    const lines = sorted.map((it) => {
      const fr = holder(it);
      const tag = sym.get(it.id) ? `[${sym.get(it.id)}] ` : "[frame] ";
      return `${tag}${it.id} ${it.kind} "${label(it)}" @ ${r0(it.x)},${r0(it.y)} ${r0(it.w)}x${r0(it.h)}${it.rotation ? ` rot:${r0(it.rotation)}` : ""}${fr ? ` in:${fr.id}` : ""}`;
    }).join("\n");

    // Character map: frames drawn as borders, items filled with their symbol, '#' where two meet.
    const b = boundsOf(items);
    const cols = Math.max(20, Math.min(160, Math.round(num(a.columns) ?? 96)));
    const cell = b.w / cols;
    const rows = Math.max(4, Math.min(80, Math.ceil(b.h / (cell * 2))));
    const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => " "));
    const span = (it: BoardItem) => ({
      c0: Math.max(0, Math.floor((it.x - b.x) / cell)), c1: Math.min(cols - 1, Math.ceil((it.x + it.w - b.x) / cell) - 1),
      r0: Math.max(0, Math.floor((it.y - b.y) / (cell * 2))), r1: Math.min(rows - 1, Math.ceil((it.y + it.h - b.y) / (cell * 2)) - 1),
    });
    for (const fr of frames) {
      const z = span(fr);
      for (let c = z.c0; c <= z.c1; c++) { grid[z.r0][c] = "-"; grid[z.r1][c] = "-"; }
      for (let r = z.r0; r <= z.r1; r++) { grid[r][z.c0] = "|"; grid[r][z.c1] = "|"; }
    }
    const owner = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ""));
    for (const it of sorted) {
      const ch = sym.get(it.id);
      if (!ch) continue;
      const z = span(it);
      for (let r = z.r0; r <= z.r1; r++) for (let c = z.c0; c <= z.c1; c++) {
        grid[r][c] = owner[r][c] && owner[r][c] !== it.id ? "#" : ch;
        owner[r][c] = it.id;
      }
    }
    return {
      lines,
      map: grid.map((row) => row.join("").replace(/\s+$/, "")).join("\n"),
      scale: `1 character = ${r0(cell)} px wide, 1 line = ${r0(cell * 2)} px tall; top-left = ${r0(b.x)},${r0(b.y)}`,
      overlaps: overlapPairs(),
      hint: "Edit positions by sending lines back to apply_layout: \"<id> @ x,y [WxH]\".",
    };
  },
  apply_layout: async (a, ctx) => {
    await ensureBoard(ctx);
    const src = text(a.lines) ?? fail("Give lines: \"<id> @ x,y [WxH]\", one per item.");
    // "[A] <id> anything @ x,y WxH …" — the symbol is optional, the id is the first word after it.
    const re = /^\s*(?:\[[^\]]*\]\s*)?(\S+)[^@\n]*@\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s+(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?))?/;
    const known = itemIds();
    const moves: { id: string; geom: Partial<BoardItem> }[] = [];
    const skipped: string[] = [];
    for (const line of src.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const m = line.match(re);
      if (!m) { skipped.push(line.trim().slice(0, 60)); continue; }
      const [, id, x, y, w, h] = m;
      if (!known.has(id)) { skipped.push(`unknown id ${id}`); continue; }
      const geom: Partial<BoardItem> = { x: +x, y: +y };
      if (w && h) Object.assign(geom, { w: Math.max(4, +w), h: Math.max(4, +h) });
      moves.push({ id, geom });
    }
    if (!moves.length) fail(`Nothing to apply.${skipped.length ? ` Unread lines: ${skipped.join(" | ")}` : ""}`);
    for (const mv of moves) st().patchItem(mv.id, mv.geom);
    const ids = moves.map((mv) => mv.id);
    return { applied: ids.length, skipped, ...overlapReport(ids) };
  },
  find_items: (a) => {
    const q = (text(a.query) ?? "").toLowerCase();
    if (!q) fail("Empty query.");
    return [...st().items, ...st().stash]
      .filter((it) => [it.text, it.title, it.ref, it.sourceUrl, it.docFile?.name].some((v) => v?.toLowerCase().includes(q)))
      .map((it) => lean(it));
  },
  screenshot: async (a) => {
    const ids = list(a.ids);
    const only = ids.length ? new Set(ids) : a.view ? visibleIds() : undefined;
    const canvas = await canvasImage(st().items, a, only);
    const mime = a.format === "jpeg" ? "image/jpeg" : "image/png";
    const data = canvas.toDataURL(mime, 0.88).split(",")[1] ?? "";
    const layout = exportLayout(st().items, { width: canvas.width, only });
    const bx = -layout.dx;
    const by = -layout.dy;
    return {
      __image: { data, mimeType: mime },
      width: canvas.width, height: canvas.height,
      // pixel = (board - origin) * scale ; board = pixel / scale + origin
      mapping: { originX: Math.round(bx), originY: Math.round(by), scale: +layout.scale.toFixed(5) },
      shown: { x: Math.round(bx), y: Math.round(by), w: Math.round(canvas.width / layout.scale), h: Math.round(canvas.height / layout.scale) },
      items: st().items.filter((it) => it.kind !== "draw" && (!only || only.has(it.id))).map((it) => ({
        id: it.id, kind: it.kind, label: it.title || it.text?.slice(0, 40) || undefined,
        px: Math.round((it.x - bx) * layout.scale), py: Math.round((it.y - by) * layout.scale),
        pw: Math.round(it.w * layout.scale), ph: Math.round(it.h * layout.scale),
      })),
    };
  },

  // ── Adding ───────────────────────────────────────────────────────────────
  add_media: async (a, ctx) => {
    const board = await ensureBoard(ctx);
    const paths = list(a.paths);
    const urls = list(a.urls);
    if (!paths.length && !urls.length) fail("Give paths or urls.");
    const before = itemIds();
    // The batch is laid out by the ingest from its start point once every medium is measured —
    // seconds later — so the free space is chosen BEFORE, big enough for the grid it will make.
    if (paths.length) board.addPaths(paths, num(a.x) !== undefined || num(a.y) !== undefined ? undefined : batchSpot(paths.length));
    const refused: string[] = [];
    for (const url of urls) if (!(await board.addUrl(url, { allowGenericEmbed: !!a.asEmbed }))) refused.push(url);
    let ids = await newItems(before, paths.length + urls.length - refused.length);
    const failed: { url: string; error: string }[] = [];
    const remoteOnly: string[] = [];
    for (const id of [...ids]) {
      const it = byId(id);
      if (it.kind !== "image" || !/^https?:/i.test(it.ref)) continue;
      if (await storeLocally(it)) continue;
      if (await imageLoads(it.ref)) { remoteOnly.push(id); continue; }
      st().removeItem(id);
      ids = ids.filter((x) => x !== id);
      failed.push({ url: it.sourceUrl || it.ref, error: "The image could not be downloaded or displayed (dead link, blocked or rate-limited)." });
    }
    await placeSettled(ids, a);
    return { ...added(ids), refused, failed, remoteOnly };
  },
  add_folder: async (a, ctx) => {
    const board = await ensureBoard(ctx);
    const dir = text(a.path) ?? fail("Missing path.");
    const scan = await nr.reference?.scanFolder(dir, {}).catch(() => null);
    const before = itemIds();
    board.addFolder(dir, num(a.x) !== undefined || num(a.y) !== undefined ? undefined : batchSpot(scan?.files?.length ?? 1, new Set(scan?.files?.map((x) => x.rel || "")).size));
    const ids = await newItems(before, Infinity, 180000, 5000);
    await placeSettled(ids, a);
    return added(ids);
  },
  add_sequence: async (a, ctx) => {
    const board = await ensureBoard(ctx);
    const before = itemIds();
    board.addSequence(list(a.paths));
    const ids = await newItems(before, 1);
    if (num(a.fps)) for (const id of ids) st().patchItem(id, { fps: num(a.fps) });
    placeAt(ids, a);
    return added(ids);
  },
  add_video_cut: async (a, ctx) => {
    const board = await ensureBoard(ctx);
    const before = itemIds();
    board.addCut(text(a.path) ?? fail("Missing path."), num(a.in) ?? 0, num(a.out) ?? fail("Missing out."), text(a.title));
    const ids = await newItems(before, 1);
    placeAt(ids, a);
    return added(ids);
  },
  add_text: async (a, ctx) => {
    await ensureBoard(ctx);
    const p = st().prefs;
    const value = text(a.text) ?? "";
    const style = textPatch(a);
    // Sized to its text, not to the hand-made default: a 64 px title in a 260 px box wraps onto
    // whatever lies below it.
    const size = style.fontSize ?? p.defaultFontSize ?? 28;
    const extra: Partial<BoardItem> = {};
    if (num(a.padding) !== undefined) extra.padding = num(a.padding);
    if (a.valign !== undefined) extra.valign = oneOf(a.valign, VALIGN, "valign");
    const it = makeTextItem(0, 0, topZ());
    Object.assign(it, { fontFamily: p.defaultFont, fontSize: p.defaultFontSize, color: p.defaultTextColor, bg: p.defaultNoteBg });
    Object.assign(it, { text: value }, style, extra);
    // `fit`: the box hugs the text on its own lines; otherwise it is sized to the text, wrapped at w.
    const fit = a.fit ? fitBox(it) : textBox(value, size, style.lineHeight);
    const w = a.fit ? fit.w : num(a.w) ?? fit.w;
    const h = a.fit ? fit.h : num(a.h) ?? (num(a.w) ? textBox(value, size, style.lineHeight, num(a.w)).h : fit.h);
    const { x, y } = at(a, w, h);
    Object.assign(it, { x, y, w, h });
    return added([st().addItem(it)]);
  },
  add_markdown_block: async (a, ctx) => {
    await ensureBoard(ctx);
    const w = num(a.w) ?? 300;
    const h = num(a.h) ?? 200;
    const { x, y } = at(a, w, h);
    const it = makeBlockItem(x, y, topZ());
    Object.assign(it, { w, h, text: text(a.markdown) ?? "" });
    if (text(a.bg)) it.bg = text(a.bg);
    if (num(a.fontSize)) it.fontSize = num(a.fontSize);
    return added([st().addItem(it)]);
  },
  add_note_sheet: async (a, ctx) => {
    await ensureBoard(ctx);
    const w = num(a.w) ?? 300;
    const h = num(a.h) ?? 240;
    const { x, y } = at(a, w, h);
    const n = await note();
    const doc = await n.markdownToBlocks(text(a.markdown) ?? "");
    const it = makeNoteItem(x, y, topZ());
    Object.assign(it, { w, h, doc, text: n.blocksToPlain(doc) });
    if (text(a.title)) it.title = text(a.title);
    return added([st().addItem(it)]);
  },
  add_frame: async (a, ctx) => {
    await ensureBoard(ctx);
    const p = st().prefs;
    const style: Partial<BoardItem> = {};
    if (text(a.title) !== undefined) style.text = text(a.title);
    if (text(a.color)) style.color = text(a.color);
    if (a.fillMode !== undefined) style.fillMode = oneOf(a.fillMode, ["none", "tint", "solid"] as const, "fillMode");
    if (text(a.fillColor)) style.fillColor = text(a.fillColor);
    if (num(a.titleSize)) style.fontSize = num(a.titleSize);
    // Around items: the frame hugs them and sits UNDER them, like the toolbar's frame on a
    // selection — over them it would catch their clicks.
    if (list(a.ids).length) {
      let picked = targets(a).map(byId).filter((it) => it.kind !== "frame");
      if (!picked.length) fail("A frame wraps items, not other frames.");
      const pickedIds = picked.map((it) => it.id);
      const area = boundsOf(picked);
      const intruders = st().items.filter((it) => it.kind !== "draw" && !pickedIds.includes(it.id) && meets(boxOf(it), area));
      if (intruders.length) {
        // Gathered in a row where the first one was, then moved to free space with their frame room.
        let cx = picked[0].x;
        const y0 = picked[0].y;
        for (const it of picked) { st().patchItem(it.id, { x: cx, y: y0 }); cx += it.w + SPACING; }
        picked = pickedIds.map(byId);
        const g = boundsOf(picked);
        const spot = freeSpot(g.w + FRAME_PAD * 2, g.h + FRAME_TOP + FRAME_PAD, { x: g.x - FRAME_PAD, y: g.y - FRAME_TOP }, new Set(pickedIds));
        st().moveBy(pickedIds, spot.x + FRAME_PAD - g.x, spot.y + FRAME_TOP - g.y);
        picked = pickedIds.map(byId);
      }
      const b = boundsOf(picked);
      const frame = makeFrameItem(b.x - FRAME_PAD, b.y - FRAME_TOP, { color: p.defaultFrameColor, fillMode: p.defaultFrameFill });
      Object.assign(frame, { w: b.w + FRAME_PAD * 2, h: b.h + FRAME_TOP + FRAME_PAD, z: Math.min(...picked.map((it) => it.z)) - 1 }, style);
      // The default title size is unreadable around large content: scale it to what it wraps.
      if (style.fontSize === undefined) frame.fontSize = frameTitleSize(picked, frame.w);
      return added([st().addItem(frame)]);
    }
    const w = num(a.w) ?? 640;
    const h = num(a.h) ?? 420;
    const { x, y } = at(a, w, h);
    const it = makeFrameItem(x, y, { color: p.defaultFrameColor, fillMode: p.defaultFrameFill });
    Object.assign(it, { w, h }, style);
    if (style.fontSize === undefined) it.fontSize = frameTitleSize([], w);
    return added([st().addItem(it)]);
  },
  add_link: async (a, ctx) => {
    const board = await ensureBoard(ctx);
    const before = itemIds();
    if (!board.addLinkCard(text(a.url) ?? "")) fail("Not an http(s) address.");
    const ids = st().items.filter((it) => !before.has(it.id)).map((it) => it.id);
    placeAt(ids, a);
    return added(ids);
  },
  add_palette: async (a, ctx) => {
    await ensureBoard(ctx);
    const from = list(a.fromIds);
    if (from.length) {
      targets({ ids: from });
      st().selectMany(from);
      const before = itemIds();
      await extractPaletteToBoard();
      const ids = st().items.filter((it) => !before.has(it.id)).map((it) => it.id);
      if (!ids.length) fail(st().notice?.text ?? "No colours extracted.");
      placeAt(ids, a);
      return added(ids);
    }
    const colors = list(a.colors);
    if (!colors.length) fail("Give colors or fromIds.");
    const w = colors.length * PALETTE_SWATCH;
    const { x, y } = at(a, w, PALETTE_HEIGHT);
    const it = makePaletteItem(x, y, colors, []);
    Object.assign(it, { w, h: PALETTE_HEIGHT, z: topZ() });
    if (typeof a.showHex === "boolean") it.showHex = a.showHex;
    return added([st().addItem(it)]);
  },
  add_item: async (a, ctx) => {
    await ensureBoard(ctx);
    const raw = (a.item && typeof a.item === "object" ? a.item : fail("Missing item.")) as Partial<BoardItem>;
    if (!raw.kind) fail("item.kind is required.");
    const w = raw.w ?? 300;
    const h = raw.h ?? 200;
    const c = at({ x: raw.x, y: raw.y }, w, h);
    const id = st().addItem({ ref: "", src: "", rotation: 0, ...raw, kind: raw.kind!, x: c.x, y: c.y, w, h, z: raw.z ?? topZ() });
    return added([id]);
  },

  // ── Editing ──────────────────────────────────────────────────────────────
  // `updates`: one patch per item; or `ids` + `patch`: the same patch for many (ids omitted = selection).
  // `fit` (here or inside a patch) then resizes plain-text notes to their text.
  update_items: async (a, ctx) => {
    await ensureBoard(ctx);
    type Upd = { id: string; patch: Record<string, unknown> };
    let updates: Upd[];
    if (Array.isArray(a.updates)) updates = a.updates as Upd[];
    else if (a.patch && typeof a.patch === "object") updates = targets(a).map((id) => ({ id, patch: a.patch as Record<string, unknown> }));
    else return fail("Give updates, or ids + patch.");
    targets({ ids: updates.map((u) => u.id) });
    const toFit: string[] = [];
    for (const u of updates) {
      st().patchItem(u.id, cleanPatch(u.patch));
      if (a.fit || u.patch?.fit) toFit.push(u.id);
    }
    const notText = toFit.length ? fitTexts(toFit) : [];
    const ids = updates.map((u) => u.id);
    return changed(ids, "updated", notText.length ? { fitSkipped: notText } : {});
  },
  set_text: async (a, ctx) => {
    await ensureBoard(ctx);
    const it = byId(text(a.id) ?? "");
    const value = text(a.text) ?? "";
    if (it.kind === "text" && noteMode(it) === "sheet") {
      const n = await note();
      const doc = await n.markdownToBlocks(value);
      st().patchItem(it.id, { doc, text: n.blocksToPlain(doc) });
    } else if (it.kind === "text" || it.kind === "frame") {
      st().patchItem(it.id, { text: value });
    } else {
      st().patchItem(it.id, { title: value });
    }
    return { ...lean(byId(it.id)), ids: [it.id] };
  },
  move_items: async (a, ctx) => {
    await ensureBoard(ctx);
    const ids = targets(a);
    if (num(a.x) !== undefined || num(a.y) !== undefined) placeAt(ids, a);
    else st().moveBy(ids, num(a.dx) ?? 0, num(a.dy) ?? 0);
    return changed(ids, "moved");
  },
  resize_item: async (a, ctx) => {
    await ensureBoard(ctx);
    const it = byId(text(a.id) ?? "");
    const ratio = it.natW && it.natH ? it.natW / it.natH : it.w / it.h;
    const keep = a.keepRatio ?? !!(it.natW && it.natH);
    let w = it.w;
    let h = it.h;
    if (num(a.scale)) { w *= num(a.scale)!; h *= num(a.scale)!; }
    else {
      const gw = num(a.w);
      const gh = num(a.h);
      if (gw === undefined && gh === undefined) fail("Give w, h or scale.");
      if (keep) {
        if (gw !== undefined) { w = gw; h = gw / ratio; } else { h = gh!; w = gh! * ratio; }
      } else { w = gw ?? w; h = gh ?? h; }
    }
    st().updateItem(it.id, { w: Math.max(4, w), h: Math.max(4, h) });
    return { ...lean(byId(it.id)), ids: [it.id], ...overlapReport([it.id]) };
  },
  rotate_items: async (a, ctx) => {
    await ensureBoard(ctx);
    const ids = targets(a);
    for (const id of ids) {
      const it = byId(id);
      const r = num(a.rotation) ?? (it.rotation || 0) + (num(a.by) ?? 0);
      st().patchItem(id, { rotation: ((r % 360) + 360) % 360 });
    }
    return { rotated: ids.length, ids, ...overlapReport(ids) };
  },
  delete_items: async (a, ctx) => {
    await ensureBoard(ctx);
    const ids = targets(a);
    for (const id of ids) st().removeItem(id);
    return { deleted: ids };
  },
  duplicate_items: async (a, ctx) => {
    await ensureBoard(ctx);
    const ids = targets(a);
    const before = itemIds();
    st().duplicateItems(ids);
    const fresh = st().items.filter((it) => !before.has(it.id)).map((it) => it.id);
    const src = boundsOf(ids.map(byId));
    placeAt(fresh, a, { x: src.x + src.w + SPACING, y: src.y });
    return added(fresh);
  },
  order_items: async (a, ctx) => {
    await ensureBoard(ctx);
    st().selectMany(targets(a));
    if (a.to === "back") st().sendSelectedToBack();
    else st().bringSelectedToFront();
    return { ok: true };
  },
  arrange_items: async (a, ctx) => {
    await ensureBoard(ctx);
    const ids = targets(a, 2);
    const mode = oneOf(a.mode, ARRANGE, "mode") as ArrangeMode;
    const frame = holderOf(ids);
    st().selectMany(ids);
    st().arrange(mode);
    if (a.settle !== false) settle(ids, mode, frame);
    return changed(ids, "arranged");
  },
  tidy_items: async (a, ctx) => {
    await ensureBoard(ctx);
    const ids = targets(a, 2);
    const opts = {
      layout: oneOf(a.layout, LAYOUTS, "layout") as ArrangeMode,
      uniform: oneOf(a.uniform ?? "none", ["none", "height", "width", "area"] as const, "uniform"),
      gap: num(a.gap),
      sort: a.sort === undefined ? undefined : oneOf(a.sort, ["none", "name"] as const, "sort"),
    };
    const frame = holderOf(ids);
    st().selectMany(ids);
    st().tidy(opts);
    if (a.settle !== false) settle(ids, undefined, frame);
    return changed(ids, "arranged");
  },
  // The agent's own order: rows left to right, wrapped after `columns`. This is how an agent sorts
  // (by subject, colour, date…): it decides the order, the board only places.
  layout_items: async (a, ctx) => {
    await ensureBoard(ctx);
    const ids = list(a.ids).length ? targets(a) : fail("Give the ids in the order to lay them out.");
    const items = ids.map(byId);
    const gap = num(a.gap) ?? st().prefs.arrangeGap ?? 24;
    const columns = Math.max(1, Math.round(num(a.columns) ?? Math.ceil(Math.sqrt(items.length))));
    const rowH = num(a.rowHeight);
    const start = boundsOf(items);
    const x0 = num(a.x) ?? start.x;
    let x = x0;
    let y = num(a.y) ?? start.y;
    let lineH = 0;
    items.forEach((it, i) => {
      if (i > 0 && i % columns === 0) { x = x0; y += lineH + gap; lineH = 0; }
      const w = rowH ? rowH * (it.w / it.h) : it.w;
      const h = rowH ?? it.h;
      st().patchItem(it.id, { x, y, w, h });
      x += w + gap;
      lineH = Math.max(lineH, h);
    });
    return changed(ids, "laidOut", { bounds: boundsOf(ids.map(byId)) });
  },
  normalize_items: async (a, ctx) => {
    await ensureBoard(ctx);
    const ids = targets(a, 2);
    const mode = oneOf(a.mode, ["height", "width", "area"] as const, "mode") as NormalizeMode;
    const frame = holderOf(ids);
    st().selectMany(ids);
    st().normalize(mode);
    if (a.settle !== false) settle(ids, undefined, frame);
    return { ok: true, ids, ...overlapReport(ids) };
  },
  reset_transform: async (a, ctx) => {
    await ensureBoard(ctx);
    const ids = targets(a);
    const kind = oneOf(a.kind, ["scale", "rotation", "flip", "crop", "all"] as const, "kind") as ResetKind;
    st().selectMany(ids);
    st().reset(kind);
    return { ok: true };
  },
  group_sequence: async (a, ctx) => {
    await ensureBoard(ctx);
    const before = itemIds();
    st().groupSequence(targets(a, 2));
    return added(st().items.filter((it) => !before.has(it.id)).map((it) => it.id));
  },
  convert_note: async (a, ctx) => {
    await ensureBoard(ctx);
    const id = text(a.id) ?? "";
    byId(id);
    await switchNoteMode(id, a.to as NoteMode);
    return lean(byId(id));
  },

  // ── Compound tools ───────────────────────────────────────────────────────
  // Several tools as one undo step. Any failure puts the board back as it was before the batch.
  // A string argument "$<n>" stands for the ids op n created or changed (a list under ids / fromIds /
  // around, else the first id), so a later op can use what an earlier one made.
  batch: async (a, ctx) => {
    const ops = Array.isArray(a.ops) ? (a.ops as { tool?: unknown; args?: Args }[]) : fail("Give ops: [{ tool, args }].");
    if (!ops.length || ops.length > 100) fail("Give 1 to 100 ops.");
    await ensureBoard(ctx);
    const made: string[][] = [];
    const ref = (key: string, v: unknown): unknown => {
      if (Array.isArray(v)) return v.flatMap((x) => { const r = ref(key, x); return Array.isArray(r) && typeof x === "string" ? r : [r]; });
      if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ref(k, x)]));
      const m = typeof v === "string" ? /^\$(\d+)$/.exec(v) : null;
      if (!m) return v;
      const ids = made[+m[1]] ?? fail(`"${String(v)}" refers to an op that has not run yet.`);
      return ["ids", "fromIds", "around"].includes(key) ? ids : ids[0];
    };
    return oneUndoStep(async () => {
      const results: { tool: string; result: unknown }[] = [];
      for (const [i, op] of ops.entries()) {
        const name = typeof op?.tool === "string" ? op.tool : "";
        try {
          const fn = TOOLS[name] ?? fail(`Unknown tool ${name || "(missing)"}.`);
          const args = (op.args && typeof op.args === "object" ? op.args : {}) as Args;
          if (BATCH_REFUSED.has(name) || (name === "board" && (args.action === "undo" || args.action === "redo"))) fail(`${name} cannot run inside a batch.`);
          const res = (await fn(ref("", args) as Args, ctx)) as Record<string, unknown> | undefined;
          if (res && typeof res === "object") delete res.__image;
          results.push({ tool: name, result: res });
          made.push(Array.isArray(res?.ids) ? (res!.ids as unknown[]).filter((x): x is string => typeof x === "string") : []);
        } catch (e) {
          throw new ToolError(`Op ${i} (${name || "?"}) failed: ${e instanceof Error ? e.message : String(e)} Nothing from the batch was kept: the board is as it was before it.`);
        }
      }
      const ids = [...new Set(made.flat())].filter((id) => itemIds().has(id));
      return { ops: results.length, ids, results, ...overlapReport(ids) };
    });
  },
  // Named in-memory snapshots of the board (items, drawing, parked folders). Lost when the app closes.
  checkpoint: async (a, ctx) => {
    const action = oneOf(a.action, ["save", "restore", "list", "drop"] as const, "action");
    const name = text(a.name)?.trim();
    const summary = (n: string, c: Checkpoint) => ({ name: n, items: c.items.filter((it) => it.kind !== "draw").length, shapes: c.items.find((it) => it.kind === "draw")?.shapes?.length ?? 0, at: new Date(c.at).toISOString() });
    if (action === "list") return { checkpoints: [...checkpoints].map(([n, c]) => summary(n, c)) };
    if (!name) fail("Give a checkpoint name.");
    if (action === "drop") return { dropped: checkpoints.delete(name!), checkpoints: [...checkpoints.keys()] };
    await ensureBoard(ctx);
    if (action === "save") {
      const c: Checkpoint = { items: st().items, stash: st().stash, at: Date.now(), sceneId: st().sceneId, file: st().filePath, folder: levelKey() };
      checkpoints.set(name!, c);
      return { saved: summary(name!, c), checkpoints: [...checkpoints.keys()] };
    }
    const cp = checkpoints.get(name!) ?? fail(`No checkpoint "${name}". Saved: ${[...checkpoints.keys()].join(", ") || "none"}.`);
    if (cp.sceneId !== st().sceneId || cp.file !== st().filePath) fail("That checkpoint belongs to another board.");
    if (cp.folder !== levelKey()) fail("That checkpoint was taken at another folder level: go back to it first (folder › leave / enter).");
    if (st().collabProjectId !== null && st().collabRole === "viewer") fail("This shared board is read-only for you.");
    // One undo step: a recorded no-op makes the store snapshot the current level (items and parked
    // folders) once, then the saved level replaces it.
    const first = st().items[0];
    if (first) st().updateItem(first.id, {});
    else useBoard.setState((s) => ({ past: [...s.past, s.items], future: [] }));
    const known = new Set(cp.items.map((it) => it.id));
    useBoard.setState((s) => {
      const selectedIds = s.selectedIds.filter((id) => known.has(id));
      return { items: cp.items, stash: cp.stash, selectedIds, selectedId: selectedIds[selectedIds.length - 1] ?? null, editingId: null, croppingId: null, drawSel: [], dirty: true };
    });
    return { restored: summary(name!, cp), items: st().items.length };
  },
  // The same style for many items (ids omitted = selection), or a theme spread over them by index.
  style_items: async (a, ctx) => {
    await ensureBoard(ctx);
    const ids = targets(a);
    const patch: Record<string, unknown> = {};
    for (const k of STYLE_KEYS) if (a[k] !== undefined) patch[k] = a[k];
    if (a.patch && typeof a.patch === "object") Object.assign(patch, a.patch);
    const own = cleanPatch(patch);
    const theme = a.theme === undefined ? undefined : oneOf(a.theme, ["dark", "pastel", "neon"] as const, "theme");
    if (!theme && !Object.keys(own).length) fail("Give a theme or style fields.");
    ids.forEach((id, i) => {
      const it = byId(id);
      const t = theme ? THEMES[theme] : undefined;
      const fromTheme: Partial<BoardItem> = {};
      if (t && it.kind === "text") Object.assign(fromTheme, { bg: t.bg[i % t.bg.length], color: t.color[i % t.color.length] });
      if (t && it.kind === "frame") Object.assign(fromTheme, { color: t.color[i % t.color.length] === "#f9fafb" ? t.bg[i % t.bg.length] : t.color[i % t.color.length] });
      st().patchItem(id, { ...fromTheme, ...own });
    });
    return changed(ids, "styled", theme ? { theme } : {});
  },
  // N numbered steps: coloured cards of one size, a big coloured number over each, an arrow under
  // them on the drawing layer, optionally in a titled frame. One undo step.
  timeline: async (a, ctx) => {
    await ensureBoard(ctx);
    const steps = Array.isArray(a.steps) ? (a.steps as { text?: unknown; color?: unknown }[]) : fail("Give steps: [{ text, color? }].");
    if (!steps.length || steps.length > 30) fail("Give 1 to 30 steps.");
    const labels = steps.map((s) => text(s?.text) ?? fail("Every step needs a text."));
    const p = st().prefs;
    const fontSize = num(a.fontSize) ?? 28;
    const cardW = Math.max(80, num(a.cardW) ?? 280);
    const PAD = 16;
    const probe = (t: string) => ({ text: t, fontSize, w: cardW, h: cardW } as BoardItem);
    const needH = Math.max(...labels.map((t) => Math.ceil(wrapped(probe(t), fontSize, cardW - PAD * 2).lines * fontSize * 1.2 + PAD * 2)));
    const cardH = Math.max(80, num(a.cardH) ?? Math.max(160, needH));
    const GAP = 48;
    const numSize = Math.round(fontSize * 2.4);
    const numH = Math.round(numSize * 1.3);
    const title = text(a.title);
    const innerW = steps.length * cardW + (steps.length - 1) * GAP;
    const innerH = numH + 12 + cardH + 40;
    const ex = title !== undefined ? { x: FRAME_PAD, top: FRAME_TOP, bottom: FRAME_PAD } : { x: 0, top: 0, bottom: 0 };
    const boxW = innerW + ex.x * 2;
    const boxH = innerH + ex.top + ex.bottom;
    const spot = at(a, boxW, boxH);
    const ox = spot.x + ex.x;
    const oy = spot.y + ex.top;
    const z0 = topZ();
    const cards: BoardItem[] = [];
    const numbers: BoardItem[] = [];
    labels.forEach((label, i) => {
      const color = text(steps[i]?.color) ?? STEP_COLORS[i % STEP_COLORS.length];
      const x = ox + i * (cardW + GAP);
      const n = makeTextItem(x, oy, z0 + i * 2);
      Object.assign(n, { w: cardW, h: numH, text: String(i + 1), fontSize: numSize, bold: true, color, bg: "transparent", align: "center", valign: "middle", padding: 0 });
      const c = makeTextItem(x, oy + numH + 12, z0 + i * 2 + 1);
      Object.assign(c, { w: cardW, h: cardH, text: label, fontSize, color: readableOn(color), bg: color, align: "center", valign: "middle", padding: PAD });
      numbers.push(n);
      cards.push(c);
    });
    const all = [...numbers, ...cards];
    let frame: BoardItem | undefined;
    if (title !== undefined) {
      frame = makeFrameItem(spot.x, spot.y, { color: p.defaultFrameColor, fillMode: p.defaultFrameFill });
      Object.assign(frame, { w: boxW, h: boxH, text: title, z: z0 - 1, fontSize: num(a.titleSize) ?? frameTitleSize(all, boxW) });
    }
    const made = st().addItems([...(frame ? [frame] : []), ...all], false);
    if (!made.length) fail("The board is read-only.");
    const ay = oy + numH + 12 + cardH + 20;
    const arrow = { c: text(a.arrowColor) ?? "#9ca3af", w: 6, id: uid(), t: "arrow", p: [ox, ay, ox + innerW, ay], h2: "arrow" } as DrawShape;
    st().drawSetShapes([...drawShapes(), arrow]);
    return {
      ids: made, frame: frame?.id, numbers: numbers.map((n) => n.id), cards: cards.map((c) => c.id), arrow: arrow.id,
      bounds: { x: spot.x, y: spot.y, w: boxW, h: boxH }, ...overlapReport(made),
    };
  },
  // Lays a frame's content out again (grid, row or column) from its top-left and refits the frame.
  relayout_frame: async (a, ctx) => {
    await ensureBoard(ctx);
    const frame = byId(text(a.id) ?? "");
    if (frame.kind !== "frame") fail(`${frame.id} is a ${frame.kind}, not a frame.`);
    const inFrame = frameContentIds(frame, st().items);
    const ordered = list(a.ids).length > 0;
    const ids = ordered ? targets(a) : inFrame;
    if (!ids.length) fail("This frame holds nothing to lay out.");
    const mode = oneOf(a.mode ?? "grid", ["grid", "row", "col"] as const, "mode");
    const items = (ordered ? ids : [...ids].sort((p, q) => {
      const A = byId(p);
      const B = byId(q);
      return Math.abs(A.y - B.y) > Math.min(A.h, B.h) / 2 ? A.y - B.y : A.x - B.x;
    })).map(byId);
    const gap = num(a.gap) ?? st().prefs.arrangeGap ?? 24;
    const columns = mode === "row" ? items.length : mode === "col" ? 1 : Math.max(1, Math.round(num(a.columns) ?? Math.ceil(Math.sqrt(items.length))));
    const x0 = frame.x + FRAME_PAD;
    let x = x0;
    let y = frame.y + FRAME_TOP;
    let lineH = 0;
    items.forEach((it, i) => {
      if (i > 0 && i % columns === 0) { x = x0; y += lineH + gap; lineH = 0; }
      st().patchItem(it.id, { x, y });
      x += it.w + gap;
      lineH = Math.max(lineH, it.h);
    });
    settle(ids, undefined, frame);
    return changed([frame.id, ...ids], "laidOut", { frame: lean(byId(frame.id)) });
  },
  // same_size: one font size for all the texts (`fontSize`, else the smallest). fit_box: the largest
  // size at which each text fills its own box without overflowing.
  text_fit: async (a, ctx) => {
    await ensureBoard(ctx);
    const action = oneOf(a.action, ["same_size", "fit_box"] as const, "action");
    const ids = targets(a);
    const texts = ids.filter((id) => byId(id).kind === "text" && (action === "same_size" || noteMode(byId(id)) === "text"));
    if (!texts.length) fail(action === "fit_box" ? "No plain text notes among these items." : "No text among these items.");
    if (action === "same_size") {
      const size = num(a.fontSize) ?? Math.min(...texts.map((id) => byId(id).fontSize ?? 18));
      for (const id of texts) st().patchItem(id, { fontSize: size });
    } else {
      const max = num(a.max) ?? 600;
      for (const id of texts) st().patchItem(id, { fontSize: Math.min(max, sizeToFillBox(byId(id))) });
    }
    return changed(texts, "fitted", { skipped: ids.filter((id) => !texts.includes(id)) });
  },

  // ── Selection and camera ────────────────────────────────────────────────
  select: async (a, ctx) => {
    await ensureBoard(ctx);
    if (a.all) st().selectAll();
    else {
      const ids = list(a.ids);
      if (ids.length) st().selectMany(targets(a));
      else st().select(null);
    }
    return { selection: st().selectedIds };
  },
  view: async (a, ctx) => {
    const board = await ensureBoard(ctx);
    if (a.fit) board.fit();
    else if (text(a.focus)) { byId(text(a.focus)!); st().requestFocus(text(a.focus)!); }
    else if (list(a.ids).length) { st().selectMany(targets(a)); board.fitSelection(); }
    else if (num(a.zoom)) board.zoomBy(num(a.zoom)!);
    else {
      const v = st().view;
      st().setView({ tx: num(a.tx) ?? v.tx, ty: num(a.ty) ?? v.ty, scale: num(a.scale) ?? v.scale });
    }
    await sleep(60);
    return { view: st().view, viewCenter: viewCenter() };
  },

  // ── Folders ──────────────────────────────────────────────────────────────
  folder: async (a, ctx) => {
    await ensureBoard(ctx);
    const id = text(a.id) ?? "";
    switch (a.action) {
      case "toggle": byId(id); st().toggleFolder(id); break;
      case "enter": byId(id); st().enterFolder(id); break;
      case "leave": st().leaveFolder(num(a.depth) ?? Math.max(0, st().folderPath.length - 1)); break;
      case "move_into": {
        // Set beside what the folder already holds: an item keeps its coordinates inside the folder,
        // and one parked from far away stretched the frame across the board once unfolded.
        const folder = byId(id);
        const moving = targets(a);
        const kids = st().stash.filter((it) => it.parent === id);
        const g = boundsOf(moving.map(byId));
        const k = kids.length ? boundsOf(kids) : { x: folder.x + FRAME_PAD, y: folder.y + FRAME_TOP, w: 0, h: 0 };
        st().moveBy(moving, k.x + (kids.length ? k.w + SPACING : 0) - g.x, k.y - g.y);
        if (!st().moveIntoFolder(id, moving)) fail("These items cannot go into that folder.");
        break;
      }
      case "set_cover": st().setFolderCover(id); break;
      case "flatten": st().flattenFolders(); break;
      case "reveal": st().revealItem(id); break;
      default: fail(`Unknown folder action ${String(a.action)}.`);
    }
    return { folderPath: st().folderPath.map((f) => f.id), items: st().items.length };
  },

  // ── Drawing ──────────────────────────────────────────────────────────────
  draw: async (a, ctx) => {
    await ensureBoard(ctx);
    const shapes = drawShapes();
    const given = Array.isArray(a.shapes) ? (a.shapes as ShapeInput[]) : [];
    const pen = st().pen;
    const complete = (raw: ShapeInput): DrawShape => {
      const { box, around, pad, from, to, x, y, size, color, width, ...s } = raw;
      const t = s.t ?? "pen";
      let p = s.p;
      if (!p && around) {
        const b = boundsOf(list(around).map(byId));
        const m = pad ?? 24;
        p = [b.x - m, b.y - m, b.x + b.w + m, b.y + b.h + m];
      }
      if (!p && box) p = [box.x, box.y, box.x + box.w, box.y + box.h];
      if (!p && from && to) {
        const centre = (e: PointRef): [number, number] => {
          if (typeof e === "string") { const it = byId(e); return [it.x + it.w / 2, it.y + it.h / 2]; }
          return [e.x, e.y];
        };
        const c1 = centre(from);
        const c2 = centre(to);
        const p1 = typeof from === "string" ? edgePoint(byId(from), c2) : c1;
        const p2 = typeof to === "string" ? edgePoint(byId(to), c1) : c2;
        p = [...p1, ...p2];
      }
      if (!p && t === "text" && x !== undefined && y !== undefined) p = [x, y];
      if (!p || p.length < 2 || p.some((v) => !Number.isFinite(v))) fail(`Shape ${t}: give p, box, around, from/to, or x/y for text.`);
      const w = t === "text" ? size ?? width ?? 32 : width ?? s.w ?? pen.width;
      if (t === "arrow" && !s.h2) s.h2 = pen.head2 && pen.head2 !== "none" ? pen.head2 : ("arrow" as DrawShape["h2"]);
      return { c: color ?? s.c ?? pen.color, ...s, w, id: s.id || uid(), t, p } as DrawShape;
    };
    switch (a.action) {
      case "list": return shapes.map((s) => ({ id: s.id, t: s.t, c: s.c, w: s.w, p: s.p.length > 8 ? `${s.p.length / 2} points` : s.p, text: s.text, link: s.a1 && s.a2 ? [s.a1.id, s.a2.id] : undefined }));
      case "add": { const next = given.map(complete); st().drawSetShapes([...shapes, ...next]); return { added: next.map((s) => s.id) }; }
      case "replace": st().drawSetShapes(given.map(complete)); break;
      case "delete": { const drop = new Set(list(a.ids)); st().drawSetShapes(shapes.filter((s) => !drop.has(s.id))); break; }
      case "clear": st().drawSetShapes([]); break;
      case "pen": st().setPen((a.pen ?? {}) as Partial<typeof pen>); return st().pen;
      case "mode": st().setDrawMode(!!a.on); break;
      case "back": st().setDrawBack(!!a.on); break;
      default: fail(`Unknown draw action ${String(a.action)}.`);
    }
    return { shapes: drawShapes().length, drawMode: st().drawMode, drawBack: st().drawBack };
  },

  // ── Links ────────────────────────────────────────────────────────────────
  links: async (a, ctx) => {
    await ensureBoard(ctx);
    const isLink = (s: DrawShape) => !!(s.a1 && s.a2);
    const linkIds = () => list(a.ids).length ? list(a.ids) : fail("Give link ids.");
    let count = 0;
    switch (a.action) {
      case "list": return drawShapes().filter(isLink).map((s) => ({ id: s.id, from: s.a1!.id, to: s.a2!.id, color: s.c, width: s.w, label: s.text }));
      case "chain": case "star": st().selectMany(targets(a, 2)); count = linkSelection(a.action); break;
      case "to": { const to = text(a.target) ?? fail("Missing target."); byId(to); count = linkItemsTo(targets(a), to); break; }
      case "unlink": count = unlinkItems(targets(a)); break;
      case "organise": {
        const root = targets(a)[0];
        count = organiseLinks(root, (text(a.mode) ?? st().prefs.linkOrganise) as OrganiseMode);
        const group = st().items.filter((it) => it.kind !== "draw").map((it) => it.id);
        return { count, links: drawShapes().filter(isLink).length, ...overlapReport(group.filter((x) => x === root || overlapsOf(byId(x)).length)) };
      }
      case "style": patchLinks(linkIds(), (a.patch ?? {}) as Partial<DrawShape>); break;
      case "reverse": reverseLinks(linkIds()); break;
      case "delete": deleteLinks(linkIds()); break;
      default: fail(`Unknown links action ${String(a.action)}.`);
    }
    return { count, links: drawShapes().filter(isLink).length };
  },

  // ── Video ────────────────────────────────────────────────────────────────
  // Local videos and YouTube: what plays (in/out), how it loops, extracts as new items, stills and
  // frame sequences. A local trimmed clip plays as a proxy cut by the board, never as the raw file.
  video: async (a, ctx) => {
    const board = await ensureBoard(ctx);
    const it = byId(text(a.id) ?? "");
    if (it.kind !== "video" && it.kind !== "youtube") fail(`${it.id} is a ${it.kind}, not a video or YouTube item.`);
    const dur = it.dur && it.dur > 0 ? it.dur : undefined;
    const range = (inV: unknown, outV: unknown) => {
      const tin = inV === null ? 0 : num(inV) ?? it.trimIn ?? 0;
      const tout = outV === null ? undefined : num(outV) ?? it.trimOut;
      if (tin < 0) fail("in must be ≥ 0 seconds.");
      if (tout !== undefined && tout <= tin) fail("out must be after in.");
      if (dur !== undefined && tin >= dur) fail(`in is past the end of the video (${dur.toFixed(2)} s).`);
      if (dur !== undefined && tout !== undefined && tout > dur + 0.05) fail(`out is past the end of the video (${dur.toFixed(2)} s).`);
      return { trimIn: tin > 0 ? tin : undefined, trimOut: tout };
    };
    const info = () => {
      const now = byId(it.id);
      return {
        id: now.id, kind: now.kind, ref: now.ref, sourceUrl: now.sourceUrl, title: now.title, duration: now.dur ?? null,
        in: now.trimIn ?? 0, out: now.trimOut ?? null, playMode: now.playMode ?? "loop", boardFrozen: st().frozen,
        size: { w: now.natW, h: now.natH },
      };
    };
    switch (a.action) {
      case "info": return info();
      case "trim": st().patchItem(it.id, range(a.in, a.out)); return info();
      case "play_mode": {
        const mode = oneOf(a.mode, ["loop", "pingpong", "off"] as const, "mode");
        if (mode === "pingpong" && it.kind === "youtube") fail("YouTube cannot play backwards: use loop or off.");
        st().patchItem(it.id, { playMode: mode });
        return info();
      }
      case "cuts": {
        const cuts = Array.isArray(a.cuts) ? (a.cuts as { in: number; out: number; title?: string }[]) : fail("Give cuts: [{ in, out, title? }].");
        const gap = 24;
        let x = it.x + it.w + gap;
        const made = cuts.map((c) => {
          const r = range(c.in, c.out);
          const { id: _id, ...rest } = it;
          const copy = { ...rest, ...r, x, y: it.y, z: topZ(), title: c.title ?? it.title };
          x += it.w + gap;
          return copy as BoardItem;
        });
        const newIds = st().addItems(made.map((m) => ({ ...m, id: uid() })), false);
        placeAt(newIds, {}, { x: it.x + it.w + SPACING, y: it.y });
        return added(newIds);
      }
      case "contact_sheet": {
        const api = nr.reference ?? fail("Not available outside the app.");
        const source = it.kind === "youtube" ? nr.ytStreamUrl(it.ref) : /^https?:/i.test(it.ref) ? it.ref : it.ref;
        const total = dur ?? fail("The duration is not known yet: try again in a moment.");
        const from = Math.max(0, num(a.in) ?? 0);
        const to = Math.min(total, num(a.out) ?? total);
        if (to <= from) fail("out must be after in.");
        const count = Math.max(2, Math.min(36, Math.round(num(a.count) ?? 12)));
        const cols = Math.max(1, Math.min(count, Math.round(num(a.columns) ?? Math.ceil(Math.sqrt(count * 1.6)))));
        const width = Math.max(320, Math.min(1600, num(a.width) ?? 1024));
        const step = (to - from) / count;
        const times = Array.from({ length: count }, (_, i) => +(from + step * (i + 0.5)).toFixed(2));
        const tileW = Math.floor(width / cols);
        const shots = await Promise.all(times.map((t) => api.sampleFrame(source, { at: t, side: Math.min(512, tileW * 2) }).catch(() => null)));
        const imgs = await Promise.all(shots.map((r) => (r?.ok && r.png ? decodePng(r.png) : Promise.resolve(null))));
        const first = imgs.find(Boolean) ?? fail("No frame could be read from this video.");
        const tileH = Math.round(tileW * (first!.naturalHeight / first!.naturalWidth));
        const rows = Math.ceil(count / cols);
        const canvas = document.createElement("canvas");
        canvas.width = tileW * cols;
        canvas.height = tileH * rows;
        const c2d = canvas.getContext("2d") ?? fail("No canvas.");
        c2d!.fillStyle = "#000";
        c2d!.fillRect(0, 0, canvas.width, canvas.height);
        c2d!.font = `bold ${Math.max(11, Math.round(tileW / 14))}px Inter, sans-serif`;
        imgs.forEach((img, i) => {
          const x = (i % cols) * tileW;
          const y = Math.floor(i / cols) * tileH;
          if (img) c2d!.drawImage(img, x, y, tileW, tileH);
          const label = `#${i + 1}  ${clock(times[i])}`;
          const pad = 4;
          const tw = c2d!.measureText(label).width + pad * 2;
          c2d!.fillStyle = "rgba(0,0,0,0.7)";
          c2d!.fillRect(x + 2, y + 2, tw, Math.round(tileW / 14) + pad * 2);
          c2d!.fillStyle = "#fff";
          c2d!.textBaseline = "top";
          c2d!.fillText(label, x + 2 + pad, y + 2 + pad);
        });
        return {
          __image: { data: canvas.toDataURL("image/jpeg", 0.72).split(",")[1] ?? "", mimeType: "image/jpeg" },
          times, range: { in: from, out: to }, duration: total,
          hint: "Pick in/out from these timestamps, then video › trim (or cuts). Ask a narrower range for more detail.",
        };
      }
      case "still": case "to_sequence": {
        if (it.kind !== "video" || /^https?:/i.test(it.ref)) fail("Stills and sequences need a local video (download a YouTube item first with media › download).");
        const api = nr.reference ?? fail("Not available outside the app.");
        const r = range(a.in ?? it.trimIn ?? 0, a.out ?? it.trimOut ?? null);
        const at = num(a.at) ?? r.trimIn ?? 0;
        const one = a.action === "still";
        const res = await api.extractFrames({
          path: it.ref, in: one ? at : r.trimIn ?? 0, out: one ? at + 0.25 : r.trimOut,
          fps: one ? undefined : num(a.fps) ?? 12, max: one ? 1 : Math.min(240, num(a.max) ?? 120),
          height: it.natH, projectPath: st().filePath || undefined, title: it.title,
        });
        if (!res.ok || !res.frames?.length) fail(res.error ?? "No frame extracted.");
        const dims = it.natW && it.natH ? { w: it.natW, h: it.natH } : undefined;
        // `replace`: the video BECOMES the sequence (the board keeps the video to go back to).
        if (!one && a.replace) {
          st().addSequenceFrom(it.id, res.frames!, dims, res.fps);
          return { ...added([it.id]), frames: res.frames!.length, replaced: true };
        }
        const before = itemIds();
        if (one) board.addPaths([res.frames![0]]);
        else st().addSequenceFrom(null, res.frames!, dims, res.fps);
        const ids = await newItems(before, 1);
        placeAt(ids, {}, { x: it.x + it.w + SPACING, y: it.y });
        return { ...added(ids), frames: res.frames!.length };
      }
      default: return fail(`Unknown video action ${String(a.action)}.`);
    }
  },

  // ── Media ────────────────────────────────────────────────────────────────
  media: async (a, ctx) => {
    await ensureBoard(ctx);
    const it = byId(text(a.id) ?? "");
    let ok: boolean | undefined = true;
    if (a.action === "reload" && !reloadableMedia(it)) fail("Only media that came from the web can be reloaded; this one is a local file.");
    if (a.action === "revert_sequence" && !it.prevMedia) fail("This item was not made from a video: there is nothing to go back to.");
    st().setNotice(null);
    switch (a.action) {
      case "upscale": ok = await quickUpscale(it.id); break;
      case "to_embed": convertToEmbed(it.id); break;
      case "download": ok = it.kind === "youtube" ? await downloadYoutube(it.id) : await downloadMediaFromEmbed(it.id); break;
      case "reload": ok = await reloadMedia(it.id); break;
      case "revert_sequence": revertSequence(it.id); break;
      case "recover": ok = await recoverMedia(it.id); break;
      default: fail(`Unknown media action ${String(a.action)}.`);
    }
    if (ok === false) fail(st().notice?.text ?? `${String(a.action)} failed.`);
    const now = st().items.find((x) => x.id === it.id);
    return now ? lean(now) : { ok: true };
  },

  // ── Board-wide ───────────────────────────────────────────────────────────
  board: async (a, ctx) => {
    const board = await ensureBoard(ctx);
    const times = Math.max(1, Math.min(100, num(a.times) ?? 1));
    switch (a.action) {
      case "undo": for (let i = 0; i < times; i++) { st().undo(); await sleep(0); } break;
      case "redo": for (let i = 0; i < times; i++) { st().redo(); await sleep(0); } break;
      case "freeze": if (st().frozen !== (a.on ?? !st().frozen)) st().toggleFrozen(); break;
      case "background": st().setBackground((a.background ?? {}) as Parameters<ReturnType<typeof st>["setBackground"]>[0]); break;
      case "copy": await board.copySelection(false); break;
      case "cut": await board.copySelection(true); break;
      case "paste": {
        const before = itemIds();
        const pasted = board.pasteItems();
        const fresh = st().items.filter((it) => !before.has(it.id)).map((it) => it.id);
        placeAt(fresh, {});
        return { pasted, ...added(fresh) };
      }
      case "rename": useBoard.setState({ sceneName: text(a.name) ?? fail("Missing name."), dirty: true }); break;
      default: fail(`Unknown board action ${String(a.action)}.`);
    }
    return { undo: st().past.length, redo: st().future.length, frozen: st().frozen, background: st().background, name: st().sceneName };
  },
  board_prefs: (a) => {
    if (a.patch && typeof a.patch === "object") st().setPrefs(a.patch as Parameters<ReturnType<typeof st>["setPrefs"]>[0]);
    return st().prefs;
  },

  // ── Scenes and files ─────────────────────────────────────────────────────
  scenes: async (a, ctx) => {
    const p = ctx.persistence;
    switch (a.action) {
      case "list": {
        const sort = a.sort === undefined ? "date" : oneOf(a.sort, ["date", "name"] as const, "sort");
        const scenes = (await p.list()).map((x) => ({ id: x.id, name: x.name, updatedAt: Number.isFinite(x.updatedAt) ? new Date(x.updatedAt).toISOString() : "", shared: !!x.collaboration }));
        scenes.sort((x, y) => (sort === "name" ? x.name.localeCompare(y.name) : y.updatedAt.localeCompare(x.updatedAt)));
        if (a.order === "asc" && sort === "date") scenes.reverse();
        if (a.order === "desc" && sort === "name") scenes.reverse();
        return { scenes, recentProjects: await p.recentProjects(), current: { name: st().sceneName, id: st().sceneId, file: st().filePath } };
      }
      case "rename": {
        const id = text(a.id) ?? fail("Missing id.");
        const name = text(a.name)?.trim() || fail("Missing name.");
        if (id === st().sceneId) { useBoard.setState({ sceneName: name, dirty: true }); await p.save(name); break; }
        const api = nr.reference ?? fail("Not available outside the app.");
        const sc = (await api.loadScene(id)) ?? fail(`No saved board ${id}.`);
        const res = await api.saveScene({ ...(sc as unknown as Record<string, unknown>), id, name } as Parameters<typeof api.saveScene>[0]);
        if (!res.ok) fail(res.error ?? "Could not rename.");
        return { id, name };
      }
      case "backup": {
        // A board in a .netsu file: the file and its journals are copied by the core. A saved board:
        // a dated copy next to it on the home screen. Saved first, so the copy is the current state.
        const api = nr.reference ?? fail("Not available outside the app.");
        if (st().collabProjectId) fail("A shared board keeps its own history: back up a local copy instead.");
        if (st().filePath) {
          await ctx.project.save();
          await sleep(150);
          const res = await api.backupProject(st().filePath!);
          if (!res.ok) fail(res.error ?? "Could not back the project up.");
          return { backup: res.dir, files: res.files };
        }
        const name = st().sceneName;
        await p.save(name);
        const id = st().sceneId ?? fail("The board could not be saved first.");
        const sc = (await api.loadScene(id)) ?? fail("The saved board could not be read.");
        const d = new Date();
        const two = (n: number) => String(n).padStart(2, "0");
        const label = `${name} backup ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
        const { id: _id, ...rest } = sc as unknown as Record<string, unknown>;
        const res = await api.saveScene({ ...rest, name: label } as Parameters<typeof api.saveScene>[0]);
        if (!res.ok) fail(res.error ?? "Could not back the board up.");
        return { backup: label, id: res.id };
      }
      case "forget_recent": { await p.forgetProject(text(a.path) ?? fail("Missing path.")); return { recentProjects: await p.recentProjects() }; }
      case "open": await p.open(text(a.id) ?? fail("Missing id.")); ctx.goBoard(); break;
      case "open_project": if (!(await p.openProject(text(a.path) ?? fail("Missing path.")))) fail(st().notice?.text ?? "Could not open the project."); ctx.goBoard(); break;
      case "new": st().newScene(text(a.name)); ctx.goBoard(); break;
      case "save": if (text(a.name) || (!st().filePath && !st().sceneId)) await p.save(text(a.name) ?? st().sceneName); else ctx.project.save(); break;
      case "delete": {
        const id = text(a.id) ?? fail("Missing id.");
        if (id === st().sceneId) fail("This board is open: open or create another one before deleting it.");
        const r = await p.remove(id);
        if (!r?.ok) fail("Could not delete that board.");
        return { deleted: id, scenes: (await p.list()).length };
      }
      default: fail(`Unknown scenes action ${String(a.action)}.`);
    }
    await sleep(100);
    return { name: st().sceneName, id: st().sceneId, file: st().filePath, dirty: st().dirty, items: st().items.length };
  },
  export_image: async (a) => {
    const dest = text(a.path) ?? fail("Missing path.");
    const ids = list(a.ids);
    const only = ids.length ? new Set(ids) : undefined;
    const api = nr.reference ?? fail("Files are not available outside the app.");
    const bg = text(a.background) === "transparent" ? null : text(a.background);
    let res;
    if (/\.svg$/i.test(dest)) {
      res = await api.writeFile(dest, await renderBoardSvg(st().items, { width: num(a.width), only, background: bg }), "utf8");
    } else {
      const canvas = await renderBoardCanvas(st().items, { width: num(a.width), only, background: bg });
      const mime = /\.jpe?g$/i.test(dest) ? "image/jpeg" : "image/png";
      res = await api.writeFile(dest, canvas.toDataURL(mime, 0.92).split(",")[1] ?? "", "base64");
    }
    if (!res.ok) fail(res.error ?? "Could not write the file.");
    return { path: res.path ?? dest, bytes: res.bytes };
  },
};

export const AGENT_TOOL_NAMES = Object.keys(TOOLS);

export async function runAgentTool(tool: string, args: Args, ctx: AgentContext): Promise<AgentAnswer> {
  const fn = TOOLS[tool];
  if (!fn) return { ok: false, error: `Unknown tool ${tool}.` };
  try {
    const result = (await fn(args ?? {}, ctx)) as Record<string, unknown> | undefined;
    const image = result && typeof result === "object" ? (result.__image as AgentAnswer["image"]) : undefined;
    if (image) delete result!.__image;
    return { ok: true, result, image };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

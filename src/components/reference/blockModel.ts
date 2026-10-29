// Text element modes. One board item (kind "text") is shown in one of three modes:
//   text  — plain text note, edited in place (TextNote);
//   block — a small Markdown block, written in place and read rendered (TextBlock);
//   sheet — a BlockNote document (`doc`), written in the full-size editor (NoteOverlay).
//
// Where each mode lives in the synced item (the Rust document validates these fields, so no new
// one is invented here):
//   text  : no `doc`, no `noteStyle`;
//   block : `noteStyle: "postit"` and the Markdown source in `text`. "postit" is only the on-wire
//           value the document already accepts — the product never calls a block a post-it;
//   sheet : `doc` present (and not a legacy post-it, see below).
// `text` carries the Markdown character by character through the text CRDT, so a build that
// predates blocks still shows readable text.
//
// Legacy: a block used to be a "post-it" holding a BlockNote `doc` of plain lines. Such an item is
// shown as a block from its lines (legacyMarkdown) and migrated on its first edit (`text` written,
// `doc` dropped). A legacy post-it whose doc holds more than plain lines stays a sheet.

import type { BoardItem } from "./referenceShared";

export type NoteMode = "text" | "block" | "sheet";

type Block = { type?: string; props?: Record<string, unknown>; content?: unknown; children?: unknown[] };

// Block types a Markdown block can hold without loss.
const SIMPLE = new Set(["paragraph", "bulletListItem", "checkListItem"]);
// Sheet block types that round-trip through Markdown (anything else would be dropped).
const MARKDOWN_SAFE = new Set([
  "paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "quote", "codeBlock", "table",
]);

/** Plain lines only: text, bullets and checkboxes, no nesting, no link or mention inside. */
export function postitEditableInline(doc: unknown[] | undefined): boolean {
  return (doc ?? []).every((raw) => {
    const b = raw as Block;
    if (!SIMPLE.has(b.type ?? "")) return false;
    if (b.children && b.children.length) return false;
    const parts = Array.isArray(b.content) ? b.content : [];
    return parts.every((p) => (p as { type?: string }).type === "text");
  });
}

export function noteMode(item: Pick<BoardItem, "kind" | "doc" | "noteStyle">): NoteMode {
  if (item.kind !== "text") return "text";
  if (item.noteStyle === "postit") return item.doc && !postitEditableInline(item.doc) ? "sheet" : "block";
  return item.doc ? "sheet" : "text";
}

/** True when the sheet holds something a Markdown block (or a plain note) cannot show. */
export function sheetIsRich(doc: unknown[] | undefined): boolean {
  const walk = (blocks: unknown[]): boolean => blocks.some((raw) => {
    const b = raw as Block;
    if (!MARKDOWN_SAFE.has(b.type ?? "")) return true;
    return Array.isArray(b.children) && walk(b.children);
  });
  return walk(doc ?? []);
}

function runText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    const p = part as { type?: string; text?: string; content?: unknown };
    return p?.type === "text" ? (p.text ?? "") : "";
  }).join("");
}

/** Markdown of a legacy post-it document: bullets "- ", checkboxes "- [ ] ", other lines as is. */
export function legacyMarkdown(doc: unknown[] | undefined): string {
  const lines = (doc ?? []).map((raw) => {
    const b = raw as Block;
    const text = runText(b.content);
    if (b.type === "bulletListItem") return `- ${text}`;
    if (b.type === "checkListItem") return `- [${b.props?.checked === true ? "x" : " "}] ${text}`;
    return text;
  });
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join("\n");
}

/** Markdown a block displays: its `text`, or the lines of a legacy post-it not migrated yet. */
export function blockSource(item: Pick<BoardItem, "text" | "doc">): string {
  return item.doc ? legacyMarkdown(item.doc) : (item.text ?? "");
}

/** Flips the task on source line `line` (0-based, as numbered by renderMarkdown). */
export function toggleTaskLine(md: string, line: number): string {
  const lines = md.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)( |x|X)(\]\s)/.exec(lines[line] ?? "");
  if (!m) return md;
  lines[line] = `${m[1]}${m[2] === " " ? "x" : " "}${m[3]}${lines[line].slice(m[0].length)}`;
  return lines.join("\n");
}

// Accent of a block: a thin bar on its left edge. Curated, desaturated tones that sit on a light or
// a dark surface alike; `undefined` (no `bg`) = no accent.
export const BLOCK_ACCENTS = ["#64748b", "#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444"];

export const BLOCK_SIZES = [13, 15, 18] as const;
export const DEFAULT_BLOCK_SIZE = 15;

// Look of a block. Synced fields reused: `fontFamily`, `fontSize`, `color` (text), `bg` (accent bar),
// `highlight` (surface fill — a block has no text highlight, so the field is free). Border, corner
// radius and padding have no field in the shared document: they live in the local `blockLook`.
export type BlockStep = "s" | "m" | "l";
export interface BlockLook { border?: boolean; radius?: BlockStep; pad?: BlockStep }

export const BLOCK_RADIUS: Record<BlockStep, number> = { s: 4, m: 10, l: 18 };
export const BLOCK_PAD: Record<BlockStep, number> = { s: 0.6, m: 1, l: 1.5 };
export const BLOCK_STEPS: BlockStep[] = ["s", "m", "l"];
// Surface presets: soft tints that keep a dark or a light text readable.
export const BLOCK_SURFACES = ["#fef3c7", "#fee2e2", "#d1fae5", "#dbeafe", "#ede9fe", "#1f2937"];

export function blockSurface(item: Pick<BoardItem, "highlight">): string | undefined {
  const h = item.highlight;
  return h && h !== "transparent" ? h : undefined;
}

export function blockRadius(item: Pick<BoardItem, "blockLook">): number {
  return BLOCK_RADIUS[item.blockLook?.radius ?? "m"];
}

export function blockAccent(item: Pick<BoardItem, "bg">): string | undefined {
  const bg = item.bg;
  return bg && bg !== "transparent" ? bg : undefined;
}

/** Plain-text lines of a note `text`, written as Markdown paragraphs (a lone newline would merge). */
export function plainToMarkdown(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\n/g, "\n\n");
}

/**
 * Item fields that change when `item` is displayed as `to`. The conversion of content that needs
 * the BlockNote serialisers is passed in (`conv`), so this stays pure: `blocks` = the Markdown
 * turned into sheet blocks, `markdown` / `plain` = the sheet turned into text.
 */
export function modePatch(
  item: BoardItem,
  to: NoteMode,
  conv: { blocks?: unknown[]; markdown?: string; plain?: string } = {},
): Partial<BoardItem> {
  const from = noteMode(item);
  if (from === to) return {};
  if (to === "sheet") {
    return {
      doc: conv.blocks ?? [], noteStyle: undefined, text: conv.plain ?? item.text ?? "",
      bg: undefined, fontSize: undefined, highlight: undefined, blockLook: undefined,
    };
  }
  const text = from === "block" ? blockSource(item) : (to === "block" ? conv.markdown : conv.plain) ?? item.text ?? "";
  if (to === "block") {
    return {
      doc: undefined, noteStyle: "postit", text,
      bg: BLOCK_ACCENTS.includes(item.bg ?? "") ? item.bg : undefined, fontSize: DEFAULT_BLOCK_SIZE,
      // A note's own colours and font are not a block's: it starts from the theme surface.
      color: undefined, fontFamily: undefined, highlight: undefined, blockLook: undefined,
    };
  }
  return { doc: undefined, noteStyle: undefined, text, bg: undefined, fontSize: undefined, highlight: undefined, blockLook: undefined };
}

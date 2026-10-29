// Note sheet seen on the board: its title and the first lines of the document, read straight from
// the BlockNote JSON. The editor itself is loaded only when the sheet is opened (NoteOverlay), so a
// board full of sheets never pays for it.

import { useTranslation } from "react-i18next";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import type { BoardItem } from "./referenceShared";

type Block = { type?: string; props?: Record<string, unknown>; content?: unknown; children?: Block[] };

// Plain text of a block's inline content: text runs, links, and mention labels.
export function inlineText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (!part || typeof part !== "object") return "";
    const p = part as { type?: string; text?: string; content?: unknown; props?: { label?: string; date?: string } };
    if (p.type === "text") return p.text ?? "";
    if (p.type === "link") return inlineText(p.content);
    return p.props?.label ?? p.props?.date ?? "";
  }).join("");
}

// Title of a sheet: its first non-empty line.
export function noteTitle(doc: unknown[] | undefined): string {
  for (const b of (doc ?? []) as Block[]) {
    const text = inlineText(b.content).trim();
    if (text) return text;
  }
  return "";
}

const MAX_LINES = 9;

export function NoteCardContent({ item }: { item: BoardItem; editing?: boolean }) {
  const { t } = useTranslation("reference");
  const blocks = (item.doc ?? []) as Block[];
  const title = noteTitle(blocks);
  const image = blocks.find((b) => b.type === "image" && typeof b.props?.url === "string")?.props?.url as string | undefined;
  // Lines after the title, with just enough shape to recognise a list or a checklist at a glance.
  const lines: { key: number; kind: string; text: string; checked?: boolean }[] = [];
  let skippedTitle = false;
  blocks.forEach((b, i) => {
    if (lines.length >= MAX_LINES) return;
    const text = inlineText(b.content).trim();
    if (!text) return;
    if (!skippedTitle) { skippedTitle = true; return; }
    lines.push({ key: i, kind: b.type ?? "paragraph", text, checked: b.props?.checked === true });
  });

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-[var(--color-surface)] text-left shadow-lg">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <NetsuIcon name="note-pen" className="size-4 shrink-0 text-primary" />
        <span className="truncate text-sm font-semibold">{title || t("noteCard.untitled")}</span>
      </div>
      {image && <img src={image} alt="" draggable={false} className="pointer-events-none h-24 w-full shrink-0 object-cover" />}
      <div className="min-h-0 flex-1 space-y-1 overflow-hidden px-3 py-2 text-xs leading-snug text-muted-foreground">
        {lines.length ? lines.map((l) => (
          <p
            key={l.key}
            className={
              l.kind === "heading" ? "truncate font-semibold text-foreground"
              : l.kind === "quote" ? "truncate border-l-2 border-border pl-2 italic"
              : "truncate"
            }
          >
            {l.kind === "bulletListItem" ? "• " : l.kind === "numberedListItem" ? "– " : l.kind === "checkListItem" ? (l.checked ? "☑ " : "☐ ") : ""}
            {l.text}
          </p>
        )) : (
          <p className="italic opacity-70">{t("noteCard.empty")}</p>
        )}
      </div>
    </div>
  );
}

// Chrome of a Markdown block while it is written: a slim formatting bar above it and the "/" command
// menu below it. Both sit outside the block's clipped box, keep a constant size on screen (chromePx)
// and apply the same text transforms as the keyboard shortcuts (blockEditing).

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { chromePx, chromeVisible } from "./boardChrome";
import { applySlash, filterSlash, FORMAT_SHORTCUTS, slashContext, type BlockFormat } from "./blockEditing";
import { blockEditor, formatBlock, runEdit } from "./blockEditorDom";
import { useBoard } from "./useReferenceBoard";
import type { BoardItem } from "./referenceShared";

const ICONS: Record<BlockFormat, string> = {
  h1: "heading-1", h2: "heading-2", h3: "heading-3", paragraph: "paragraph", bold: "bold", italic: "italic",
  strike: "strike", code: "code", link: "link-text", bullet: "bullet-list", numbered: "numbered-list",
  task: "task-list", quote: "quote", divider: "divider", codeBlock: "code-block", table: "table",
};

const GROUPS: BlockFormat[][] = [
  ["h1", "h2", "h3"],
  ["bold", "italic", "strike", "code", "link"],
  ["bullet", "numbered", "task", "quote", "divider"],
];

interface Slash { from: number; query: string }

export function BlockEditBar({ item }: { item: BoardItem }) {
  const { t } = useTranslation("reference");
  const scale = useBoard((s) => s.view.scale);
  const px = chromePx(scale);
  const [slash, setSlash] = useState<Slash | null>(null);
  const [index, setIndex] = useState(0);
  const label = (id: BlockFormat) => t(`textMode.fmt.${id}`);
  const matches = slash ? filterSlash(slash.query, label) : [];

  // Read by the textarea listeners below, which outlive a render.
  const live = useRef({ slash, matches, index });
  live.current = { slash, matches, index };
  useEffect(() => setIndex(0), [slash?.query]);

  useEffect(() => {
    const ta = blockEditor(item.id);
    if (!ta) return;
    const sync = () => {
      const c = ta.selectionStart === ta.selectionEnd ? slashContext(ta.value, ta.selectionStart) : null;
      setSlash((prev) => (prev && c && prev.from === c.from && prev.query === c.query ? prev : c));
    };
    const choose = (id: BlockFormat) => {
      const s = live.current.slash;
      if (!s) return;
      runEdit(ta, item.id, (e) => applySlash(e.value, s, e.start, id));
      setSlash(null);
    };
    // Before React's own handler (which sits on the root): while the menu is open the arrows, Enter,
    // Tab and Escape belong to it.
    const onKey = (e: KeyboardEvent) => {
      const { slash: s, matches: m, index: i } = live.current;
      if (!s || e.isComposing) return;
      const take = () => { e.preventDefault(); e.stopPropagation(); };
      if (e.key === "Escape") { take(); setSlash(null); return; }
      if (!m.length) return;
      if (e.key === "ArrowDown") { take(); setIndex((i + 1) % m.length); }
      else if (e.key === "ArrowUp") { take(); setIndex((i - 1 + m.length) % m.length); }
      else if ((e.key === "Enter" && !e.ctrlKey && !e.metaKey) || e.key === "Tab") { take(); choose(m[Math.min(i, m.length - 1)].id); }
    };
    const close = () => setSlash(null);
    ta.addEventListener("keydown", onKey);
    ta.addEventListener("input", sync);
    ta.addEventListener("keyup", sync);
    ta.addEventListener("click", sync);
    ta.addEventListener("blur", close);
    return () => {
      ta.removeEventListener("keydown", onKey);
      ta.removeEventListener("input", sync);
      ta.removeEventListener("keyup", sync);
      ta.removeEventListener("click", sync);
      ta.removeEventListener("blur", close);
    };
  }, [item.id]);

  if (!chromeVisible(scale)) return null;
  // The textarea keeps the focus: a press on the bar must not take it.
  const keepFocus = { onMouseDown: (e: React.MouseEvent) => e.preventDefault(), onPointerDown: (e: React.PointerEvent) => e.stopPropagation() };

  return (
    <>
      <div
        data-note-toolbar
        {...keepFocus}
        className="nr-chrome absolute left-0 z-20 flex w-max cursor-default items-center gap-px rounded-lg border border-border bg-card/95 p-0.5 shadow-md backdrop-blur"
        style={{ bottom: "100%", marginBottom: 6 * px, transform: `scale(${px})`, transformOrigin: "left bottom" }}
        role="toolbar"
        aria-label={t("textMode.formatBar")}
      >
        {GROUPS.map((group, gi) => (
          <div key={gi} className={cn("flex items-center gap-px", gi > 0 && "ml-0.5 border-l border-border pl-0.5")}>
            {group.map((f) => {
              const keys = FORMAT_SHORTCUTS[f];
              return (
                <Tooltip key={f}>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={label(f)}
                        onClick={() => formatBlock(item.id, f)}
                        className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
                      />
                    }
                  >
                    <NetsuIcon name={ICONS[f]} />
                  </TooltipTrigger>
                  <TooltipContent side="top">{keys ? `${label(f)}  ${keys}` : label(f)}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        ))}
      </div>

      {slash && (
        <div
          data-note-toolbar
          {...keepFocus}
          role="listbox"
          aria-label={t("textMode.commands")}
          className="nr-chrome absolute left-0 z-20 w-52 cursor-default rounded-lg border border-border bg-card/95 p-1 shadow-md backdrop-blur"
          style={{ top: "100%", marginTop: 6 * px, transform: `scale(${px})`, transformOrigin: "left top" }}
        >
          {matches.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">{t("textMode.noCommand")}</div>}
          {matches.map((c, i) => {
            return (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={i === index}
                onClick={() => {
                  const ta = blockEditor(item.id);
                  if (ta) runEdit(ta, item.id, (e) => applySlash(e.value, slash, e.start, c.id));
                  setSlash(null);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-foreground",
                  i === index ? "bg-accent" : "hover:bg-accent/60",
                )}
              >
                <NetsuIcon name={ICONS[c.id]} className="size-3.5 text-muted-foreground" />
                {label(c.id)}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

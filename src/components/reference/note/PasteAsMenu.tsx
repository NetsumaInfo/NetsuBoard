// Floating "Paste as" menu — shown under the caret when a lone link is pasted.
// Four choices: Mention / Link / Bookmark / Embed. Keyboard: arrows move, Enter picks, Escape
// cancels (the caller falls back to nothing). Closes on an outside click. Positioned `fixed` near
// the caret.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AsEmbedGlyph, BookmarkGlyph, LinkGlyph, MentionGlyph, type Glyph } from "@/components/reference/netsuIcons";
import i18n from "@/i18n";
import { LINK_AS_OPTIONS, type LinkAs } from "./notePaste";
import { useViewportAnchor } from "./useViewportAnchor";

const ICONS: Record<LinkAs, Glyph> = { mention: MentionGlyph, url: LinkGlyph, bookmark: BookmarkGlyph, embed: AsEmbedGlyph };

export interface PasteAnchor { getRect: () => DOMRect | null; url: string; }

export function PasteAsMenu({ anchor, onPick, onClose }: { anchor: PasteAnchor; onPick: (k: LinkAs) => void; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const getRect = useCallback(() => anchor.getRect(), [anchor]);
  const position = useViewportAnchor(true, getRect, { width: 256, height: 196, gap: 4 });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const stop = () => { e.preventDefault(); e.stopPropagation(); };
      if (e.key === "Escape") { stop(); onClose(); }
      else if (e.key === "ArrowDown") { stop(); setIdx((i) => (i + 1) % LINK_AS_OPTIONS.length); }
      else if (e.key === "ArrowUp") { stop(); setIdx((i) => (i - 1 + LINK_AS_OPTIONS.length) % LINK_AS_OPTIONS.length); }
      else if (e.key === "Enter") { stop(); onPick(LINK_AS_OPTIONS[idx].key); }
    };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("mousedown", onDown, true); };
  }, [idx, onPick, onClose]);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[200] w-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-xl"
      style={{ top: position.top, left: position.left, maxHeight: position.maxHeight }}
    >
      <div className="px-2 py-1 text-xs font-medium text-muted-foreground">{i18n.t("note:finalPass.pasteAs")}</div>
      {LINK_AS_OPTIONS.map((o, i) => {
        const Icon = ICONS[o.key];
        return (
          <button
            key={o.key}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setIdx(i)}
            onClick={() => onPick(o.key)}
            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${i === idx ? "bg-muted text-foreground" : "text-muted-foreground"}`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="flex-1">{o.label}</span>
            <span className="truncate text-xs text-muted-foreground/70">{o.desc}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

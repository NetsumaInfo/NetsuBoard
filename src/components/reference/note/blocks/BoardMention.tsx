// Inline chip pointing at an item of the board (image, video, note, frame…). Created from the "@"
// menu. The chip is a plain, non-editable span; a click calls the opener registered by the host
// (NoteEditor) through `setBoardMentionOpener`, because the spec lives in a static schema and cannot
// receive props. Only one note editor is mounted at a time, so a module-level slot is enough.
import { createElement, type ComponentType } from "react";
import { createReactInlineContentSpec } from "@blocknote/react";
import { Youtube } from "lucide-react";
import { FrameGlyph, ImageGlyph, LayersGlyph, NoteGlyph, PaletteGlyph, VideoGlyph, WebGlyph } from "../../netsuIcons";
import i18n from "@/i18n";

let opener: ((itemId: string) => void) | null = null;

/** Registers the click handler; returns a disposer that only clears its own registration. */
export function setBoardMentionOpener(fn: ((itemId: string) => void) | null): () => void {
  opener = fn;
  return () => { if (opener === fn) opener = null; };
}

const KIND_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  image: ImageGlyph,
  video: VideoGlyph,
  youtube: Youtube,
  embed: WebGlyph,
  text: NoteGlyph,
  frame: FrameGlyph,
  sequence: LayersGlyph,
  palette: PaletteGlyph,
};

export function boardKindIcon(kind: string): ComponentType<{ className?: string }> {
  return KIND_ICONS[kind] ?? NoteGlyph;
}

export const boardMentionSpec = createReactInlineContentSpec(
  {
    type: "boardMention",
    propSchema: { itemId: { default: "" }, label: { default: "" }, kind: { default: "" } },
    content: "none",
  },
  {
    render: ({ inlineContent }) => {
      const { itemId, label, kind } = inlineContent.props;
      const open = () => { if (itemId) opener?.(String(itemId)); };
      return (
        <span
          className="nb-board-mention"
          contentEditable={false}
          role="link"
          tabIndex={0}
          onClick={open}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}
        >
          {createElement(boardKindIcon(String(kind)), { className: "nb-board-mention-ico" })}
          <span className="truncate">{String(label) || i18n.t("note:boardMention.untitled")}</span>
        </span>
      );
    },
  },
);

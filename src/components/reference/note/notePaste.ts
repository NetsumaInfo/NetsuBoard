// "Paste as" / "Convert to" logic for a link — single source shared by the paste menu (PasteAsMenu)
// and the media-block convert menu (BlockConvertMenu). Four shapes: Mention (inline chip), URL
// (inline link), Bookmark (card), Embed (iframe / YouTube).
import type { BlockNoteEditor } from "@blocknote/core";
import i18n from "@/i18n";
import { youtubeId } from "../embeds";
import { insertOrUpdate } from "./noteSchema";

export type LinkAs = "mention" | "url" | "bookmark" | "embed";

// Display metadata of the four options (the icon is picked by key in the component).
export const LINK_AS_OPTIONS: { key: LinkAs; label: string; desc: string }[] = [
  { key: "mention", get label() { return i18n.t("note:paste.mention.label"); }, get desc() { return i18n.t("note:paste.mention.desc"); } },
  { key: "url", get label() { return i18n.t("note:paste.url.label"); }, get desc() { return i18n.t("note:paste.url.desc"); } },
  { key: "bookmark", get label() { return i18n.t("note:paste.bookmark.label"); }, get desc() { return i18n.t("note:paste.bookmark.desc"); } },
  { key: "embed", get label() { return i18n.t("note:paste.embed.label"); }, get desc() { return i18n.t("note:paste.embed.desc"); } },
];

type Ed = BlockNoteEditor<any, any, any>;

// Pastes a link in the chosen shape at the cursor.
export function applyPasteAs(editor: Ed, url: string, kind: LinkAs): void {
  const yt = youtubeId(url);
  switch (kind) {
    case "mention":
      editor.insertInlineContent([{ type: "linkMention", props: { url } } as never, " "]);
      break;
    case "url":
      editor.insertInlineContent([{ type: "link", href: url, content: url } as never, " "]);
      break;
    case "bookmark":
      insertOrUpdate(editor, { type: "bookmark", props: { url } });
      break;
    case "embed":
      insertOrUpdate(editor, yt ? { type: "youtube", props: { videoId: yt } } : { type: "embed", props: { url } });
      break;
  }
}

// Converts an EXISTING media block (youtube/embed/bookmark) to another shape, reusing its url.
export function convertBlockTo(editor: Ed, block: unknown, url: string, kind: LinkAs): void {
  const yt = youtubeId(url);
  const b = block as never;
  switch (kind) {
    case "bookmark":
      editor.updateBlock(b, { type: "bookmark", props: { url } });
      break;
    case "embed":
      editor.updateBlock(b, yt ? { type: "youtube", props: { videoId: yt } } : { type: "embed", props: { url } });
      break;
    case "url":
      editor.replaceBlocks([b], [{ type: "paragraph", content: [{ type: "link", href: url, content: url }] } as never]);
      break;
    case "mention":
      editor.replaceBlocks([b], [{ type: "paragraph", content: [{ type: "linkMention", props: { url } }] } as never]);
      break;
  }
}

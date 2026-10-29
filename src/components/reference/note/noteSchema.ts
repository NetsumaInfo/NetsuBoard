// BlockNote schema of the note sheet: default blocks + custom blocks (callout, toggle, media…) and
// custom inline content (web link, date, board item). Single source shared by the editor and the
// headless export. Also provides the custom slash-menu entries and an insert-or-replace helper.
import { createElement } from "react";
import i18n from "@/i18n";
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, type BlockNoteEditor } from "@blocknote/core";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import { Youtube } from "lucide-react";
import { AttachFileGlyph, CalendarGlyph, CalloutGlyph, DividerGlyph, EquationGlyph, GalleryGlyph, BookmarkGlyph, MusicGlyph, ToggleBlockGlyph, VideoGlyph, WebGlyph } from "@/components/reference/netsuIcons";
import { calloutSpec } from "./blocks/CalloutBlock";
import { toggleSpec } from "./blocks/ToggleBlock";
import { boardMentionSpec } from "./blocks/BoardMention";
import { linkMentionSpec } from "./blocks/LinkMention";
import { dateMentionSpec } from "./blocks/DateMention";
import { youtubeSpec } from "./blocks/YoutubeBlock";
import { embedSpec } from "./blocks/EmbedBlock";
import { bookmarkSpec } from "./blocks/BookmarkBlock";
import { gallerySpec } from "./blocks/GalleryBlock";
import { videoSpec } from "./blocks/VideoBlock";
import { fileSpec } from "./blocks/FileBlock";
import { audioSpec } from "./blocks/AudioBlock";
import { equationSpec } from "./blocks/EquationBlock";
import { dividerSpec } from "./blocks/DividerBlock";

export const noteSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    video: videoSpec, // replaces the default video block with the in-house player
    audio: audioSpec, // same: themed audio player instead of the native <audio controls>
    file: fileSpec,   // same: download card for PDF/Word/Excel/ZIP…
    callout: calloutSpec,
    toggle: toggleSpec,
    youtube: youtubeSpec,
    embed: embedSpec,
    bookmark: bookmarkSpec,
    gallery: gallerySpec,
    equation: equationSpec,
    divider: dividerSpec,
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    linkMention: linkMentionSpec,
    dateMention: dateMentionSpec,
    boardMention: boardMentionSpec,
  },
});

// Inserts a new block, or replaces the current one when it is an empty paragraph.
export function insertOrUpdate(editor: BlockNoteEditor<any, any, any>, block: any) {
  const cur = editor.getTextCursorPosition().block;
  const content = cur.content as unknown[] | undefined;
  const empty = cur.type === "paragraph" && (!content || content.length === 0);
  if (empty) editor.updateBlock(cur, block);
  else editor.insertBlocks([block], cur, "after");
}

// Today as an ISO date (YYYY-MM-DD) for the default @date chip.
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Custom slash-menu entries (merged with getDefaultReactSlashMenuItems by the editor).
export function noteSlashItems(editor: BlockNoteEditor<any, any, any>): DefaultReactSuggestionItem[] {
  const tr = (key: string) => i18n.t(`note:slash.${key}`);
  const aliases = (key: string) => tr(`${key}.aliases`).split("|");
  return [
    {
      title: tr("callout.title"), subtext: tr("callout.desc"), aliases: aliases("callout"), group: tr("groups.blocks"),
      icon: createElement(CalloutGlyph, { className: "size-[18px]" }),
      onItemClick: () => insertOrUpdate(editor, { type: "callout", props: { color: "blue", emoji: "💡" } }),
    },
    {
      title: tr("toggle.title"), subtext: tr("toggle.desc"), aliases: aliases("toggle"), group: tr("groups.blocks"),
      icon: createElement(ToggleBlockGlyph, { className: "size-[18px]" }),
      onItemClick: () => insertOrUpdate(editor, { type: "toggle", props: { open: true } }),
    },
    {
      title: tr("equation.title"), subtext: tr("equation.desc"), aliases: aliases("equation"), group: tr("groups.blocks"),
      icon: createElement(EquationGlyph, { className: "size-[18px]" }),
      onItemClick: () => insertOrUpdate(editor, { type: "equation", props: { tex: "" } }),
    },
    {
      title: tr("divider.title"), subtext: tr("divider.desc"), aliases: aliases("divider"), group: tr("groups.blocks"),
      icon: createElement(DividerGlyph, { className: "size-[18px]" }),
      onItemClick: () => insertOrUpdate(editor, { type: "divider", props: { style: "line" } }),
    },
    {
      title: "YouTube", subtext: tr("youtube.desc"), aliases: aliases("youtube"), group: tr("groups.media"),
      icon: createElement(Youtube, { size: 18 }),
      onItemClick: () => insertOrUpdate(editor, { type: "youtube", props: { videoId: "" } }),
    },
    {
      title: tr("embed.title"), subtext: "Vimeo, X, TikTok, Twitch…", aliases: aliases("embed"), group: tr("groups.media"),
      icon: createElement(WebGlyph, { className: "size-[18px]" }),
      onItemClick: () => insertOrUpdate(editor, { type: "embed", props: { url: "" } }),
    },
    {
      title: tr("bookmark.title"), subtext: tr("bookmark.desc"), aliases: aliases("bookmark"), group: tr("groups.media"),
      icon: createElement(BookmarkGlyph, { className: "size-[18px]" }),
      onItemClick: () => insertOrUpdate(editor, { type: "bookmark", props: { url: "" } }),
    },
    {
      title: tr("video.title"), subtext: tr("video.desc"), aliases: aliases("video"), group: tr("groups.media"),
      icon: createElement(VideoGlyph, { className: "size-[18px]" }),
      onItemClick: () => insertOrUpdate(editor, { type: "video", props: { url: "" } }),
    },
    {
      title: "Audio", subtext: tr("audio.desc"), aliases: aliases("audio"), group: tr("groups.media"),
      icon: createElement(MusicGlyph, { className: "size-[18px]" }),
      onItemClick: () => insertOrUpdate(editor, { type: "audio", props: { url: "" } }),
    },
    {
      title: tr("file.title"), subtext: tr("file.desc"), aliases: aliases("file"), group: tr("groups.media"),
      icon: createElement(AttachFileGlyph, { className: "size-[18px]" }),
      onItemClick: () => insertOrUpdate(editor, { type: "file", props: { url: "" } }),
    },
    {
      title: tr("gallery.title"), subtext: tr("gallery.desc"), aliases: aliases("gallery"), group: tr("groups.media"),
      icon: createElement(GalleryGlyph, { className: "size-[18px]" }),
      onItemClick: () => insertOrUpdate(editor, { type: "gallery", props: { urls: "[]" } }),
    },
    {
      title: tr("date.title"), subtext: tr("date.desc"), aliases: aliases("date"), group: tr("groups.insert"),
      icon: createElement(CalendarGlyph, { className: "size-[18px]" }),
      onItemClick: () => editor.insertInlineContent([{ type: "dateMention", props: { date: todayIso() } }, " "] as never),
    },
  ];
}

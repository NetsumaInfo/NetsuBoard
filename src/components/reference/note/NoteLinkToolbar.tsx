// Toolbar of a plain link in a note: BlockNote's edit / open / remove, plus "turn into" mention,
// bookmark or embed, and "put on the board". A link written as plain text could not change shape
// before: only the cards (mention, bookmark, embed) carried the convert menu.

import { AsEmbedGlyph, BookmarkGlyph, MentionGlyph, PlaceOnBoardGlyph, type Glyph } from "@/components/reference/netsuIcons";
import {
  DeleteLinkButton, EditLinkButton, LinkToolbar, OpenLinkButton,
  useBlockNoteEditor, useComponentsContext, type LinkToolbarProps,
} from "@blocknote/react";
import i18n from "@/i18n";
import { youtubeId } from "../referenceShared";
import { insertOrUpdate } from "./noteSchema";
import { canPlaceOnBoard, placeOnBoard } from "./boardPlacer";

type Shape = "mention" | "bookmark" | "embed";

export function NoteLinkToolbar(props: LinkToolbarProps) {
  const editor = useBlockNoteEditor<any, any, any>();
  const Components = useComponentsContext()!;

  const convert = (shape: Shape) => {
    const { url, range } = props;
    const view = editor.prosemirrorView;
    if (!view) return;
    // The link text goes; the cursor stays where it was, so the new shape lands in its place.
    view.dispatch(view.state.tr.delete(range.from, range.to));
    if (shape === "mention") {
      editor.insertInlineContent([{ type: "linkMention", props: { url } } as never, " "]);
    } else if (shape === "bookmark") {
      insertOrUpdate(editor, { type: "bookmark", props: { url } });
    } else {
      const yt = youtubeId(url);
      insertOrUpdate(editor, yt ? { type: "youtube", props: { videoId: yt } } : { type: "embed", props: { url } });
    }
    props.setToolbarOpen?.(false);
  };

  const button = (shape: Shape, Icon: Glyph) => (
    <Components.LinkToolbar.Button
      key={shape}
      mainTooltip={i18n.t(`note:paste.${shape}.label`)}
      icon={<Icon className="size-4" />}
      onClick={() => convert(shape)}
      label={i18n.t(`note:paste.${shape}.label`)}
    />
  );

  return (
    <LinkToolbar {...props}>
      <EditLinkButton
        url={props.url}
        text={props.text}
        range={props.range}
        setToolbarOpen={props.setToolbarOpen}
        setToolbarPositionFrozen={props.setToolbarPositionFrozen}
      />
      <OpenLinkButton url={props.url} />
      <DeleteLinkButton range={props.range} setToolbarOpen={props.setToolbarOpen} />
      {button("mention", MentionGlyph)}
      {button("bookmark", BookmarkGlyph)}
      {button("embed", AsEmbedGlyph)}
      {canPlaceOnBoard() && (
        <Components.LinkToolbar.Button
          mainTooltip={i18n.t("note:placeOnBoard")}
          icon={<PlaceOnBoardGlyph className="size-4" />}
          onClick={() => { placeOnBoard(props.url); props.setToolbarOpen?.(false); }}
          label={i18n.t("note:placeOnBoard")}
        />
      )}
    </LinkToolbar>
  );
}

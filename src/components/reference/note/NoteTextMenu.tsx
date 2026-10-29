// Note-specific entries of the app-wide text context menu (components/common/TextContextMenu):
// inline formatting, "Turn into" and block actions. The menu itself lives at the app root; the
// editor only registers its root element and a renderer (textMenuExtension).

import { useEffect, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { BlockNoteEditor } from "@blocknote/core";
import { TextSelection } from "prosemirror-state";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import {
  BoldGlyph, ItalicGlyph, UnderlineGlyph, StrikeGlyph, CodeGlyph, LinkTextGlyph, ChangeTypeGlyph, DuplicateBlockGlyph, MoveUpGlyph, MoveDownGlyph, DeleteGlyph,
  Heading1Glyph, Heading2Glyph, Heading3Glyph, BulletListGlyph, NumberedListGlyph, TaskListGlyph, ParagraphGlyph, QuoteGlyph, CodeBlockGlyph, CalloutGlyph, type Glyph,
} from "@/components/reference/netsuIcons";
import {
  DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { registerTextMenuExtension } from "@/components/common/textMenuExtension";
import { TextMenuSub, TextMenuSubTrigger, TextMenuSubContent } from "@/components/common/TextMenuSub";
import { clipboardUrl, isConvertible, stripBlockIds } from "./noteMenuModel";

type Editor = BlockNoteEditor<any, any, any>;

const STYLES: { style: "bold" | "italic" | "underline" | "strike" | "code"; icon: Glyph }[] = [
  { style: "bold", icon: BoldGlyph },
  { style: "italic", icon: ItalicGlyph },
  { style: "underline", icon: UnderlineGlyph },
  { style: "strike", icon: StrikeGlyph },
  { style: "code", icon: CodeGlyph },
];

const TURN_INTO: { key: string; type: string; props?: Record<string, boolean | number | string>; icon: Glyph }[] = [
  { key: "paragraph", type: "paragraph", icon: ParagraphGlyph },
  { key: "heading1", type: "heading", props: { level: 1, isToggleable: false }, icon: Heading1Glyph },
  { key: "heading2", type: "heading", props: { level: 2, isToggleable: false }, icon: Heading2Glyph },
  { key: "heading3", type: "heading", props: { level: 3, isToggleable: false }, icon: Heading3Glyph },
  { key: "bulletList", type: "bulletListItem", icon: BulletListGlyph },
  { key: "numberedList", type: "numberedListItem", icon: NumberedListGlyph },
  { key: "checkList", type: "checkListItem", icon: TaskListGlyph },
  { key: "quote", type: "quote", icon: QuoteGlyph },
  { key: "callout", type: "callout", props: { color: "blue", emoji: "💡" }, icon: CalloutGlyph },
  { key: "codeBlock", type: "codeBlock", icon: CodeBlockGlyph },
];

// A right-click outside the current selection moves the caret under the pointer first, like any
// text editor, so the menu acts on what was clicked.
function placeCaret(editor: Editor, e: MouseEvent) {
  try {
    const view = editor.prosemirrorView;
    if (!view) return;
    const hit = view.posAtCoords({ left: e.clientX, top: e.clientY });
    if (!hit) return;
    const sel = view.state.selection;
    if (!sel.empty && hit.pos >= sel.from && hit.pos <= sel.to) return;
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(hit.pos))));
  } catch { /* the view can be tearing down */ }
}

export function useNoteTextMenu(editor: Editor, rootRef: RefObject<HTMLElement | null>, readOnly: boolean) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    return registerTextMenuExtension({
      root,
      readOnly,
      prepare: (e) => placeCaret(editor, e),
      // Read-only sheet: there is no caret to select inside, so select the document's content.
      selectAll: readOnly
        ? () => {
          const doc = root.querySelector(".bn-editor");
          if (!doc) return;
          const sel = window.getSelection();
          sel?.removeAllRanges();
          const range = document.createRange();
          range.selectNodeContents(doc);
          sel?.addRange(range);
        }
        : undefined,
      render: () => <NoteMenuItems editor={editor} />,
    });
  }, [editor, rootRef, readOnly]);
}

interface Snapshot {
  styles: Record<string, unknown>;
  hasSelection: boolean;
  inLink: boolean;
  blocks: { id: string; type: string; props: Record<string, unknown> }[];
}

function snapshot(editor: Editor): Snapshot | null {
  try {
    const cursor = editor.getTextCursorPosition().block;
    const selected = editor.getSelection()?.blocks;
    return {
      styles: editor.getActiveStyles() as Record<string, unknown>,
      hasSelection: !!editor.getSelectedText(),
      inLink: !!editor.getSelectedLinkUrl(),
      blocks: (selected?.length ? selected : [cursor]) as Snapshot["blocks"],
    };
  } catch {
    return null;
  }
}

function NoteMenuItems({ editor }: { editor: Editor }) {
  const { t } = useTranslation("note");
  // Frozen when the menu opens: the entries describe the block that was right-clicked.
  const [snap] = useState(() => snapshot(editor));
  if (!snap) return null;
  const { blocks, styles } = snap;
  const convertible = blocks.every((b) => isConvertible(b.type));

  const toggle = (style: (typeof STYLES)[number]["style"]) => {
    editor.focus();
    editor.toggleStyles({ [style]: true } as never);
  };
  const link = async () => {
    let url: string | null = null;
    try { url = clipboardUrl(await navigator.clipboard.readText()); } catch { /* clipboard unreadable */ }
    if (!url) { toast.info(t("menu.linkNeedsUrl")); return; }
    editor.focus();
    editor.createLink(url);
  };
  const turnInto = (item: (typeof TURN_INTO)[number]) => {
    editor.focus();
    editor.transact(() => {
      for (const b of blocks) editor.updateBlock(b.id, { type: item.type, props: item.props } as never);
    });
  };
  const duplicate = () => {
    const last = blocks[blocks.length - 1];
    const copies = blocks.map((b) => stripBlockIds(editor.getBlock(b.id) as never));
    editor.insertBlocks(copies as never, last.id, "after");
  };
  const remove = () => editor.removeBlocks(blocks.map((b) => b.id));
  const move = (dir: "up" | "down") => {
    editor.focus();
    if (dir === "up") editor.moveBlocksUp(); else editor.moveBlocksDown();
  };

  return (
    <>
      <TextMenuSub>
        <TextMenuSubTrigger><BoldGlyph /> {t("menu.format")}</TextMenuSubTrigger>
        <TextMenuSubContent>
          {STYLES.map(({ style, icon: Icon }) => (
            <DropdownMenuCheckboxItem key={style} checked={!!styles[style]} onCheckedChange={() => toggle(style)}>
              <Icon /> {t(`menu.${style}`)}
            </DropdownMenuCheckboxItem>
          ))}
          {!snap.inLink && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!snap.hasSelection} onClick={() => void link()}>
                <LinkTextGlyph /> {t("menu.link")}
              </DropdownMenuItem>
            </>
          )}
        </TextMenuSubContent>
      </TextMenuSub>
      {convertible && (
        <TextMenuSub>
          <TextMenuSubTrigger><ChangeTypeGlyph /> {t("sideMenu.changeType")}</TextMenuSubTrigger>
          <TextMenuSubContent>
            {TURN_INTO.map((item) => {
              const Icon = item.icon;
              const on = blocks.length === 1 && blocks[0].type === item.type
                && (item.type !== "heading" || blocks[0].props.level === item.props?.level);
              return (
                <DropdownMenuCheckboxItem key={item.key} checked={on} onCheckedChange={() => turnInto(item)}>
                  <Icon /> {t(`blockTypes.${item.key}`)}
                </DropdownMenuCheckboxItem>
              );
            })}
          </TextMenuSubContent>
        </TextMenuSub>
      )}
      <TextMenuSub>
        <TextMenuSubTrigger><NetsuIcon name="blocks" /> {t("menu.block")}</TextMenuSubTrigger>
        <TextMenuSubContent>
          <DropdownMenuItem onClick={duplicate}><DuplicateBlockGlyph /> {t("menu.duplicate")}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => move("up")}><MoveUpGlyph /> {t("menu.moveUp")}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => move("down")}><MoveDownGlyph /> {t("menu.moveDown")}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={remove}><DeleteGlyph /> {t("delete")}</DropdownMenuItem>
        </TextMenuSubContent>
      </TextMenuSub>
    </>
  );
}

// Block handle menu (⋮⋮) — default items (delete, colours, table headers) plus "Change type", a
// submenu that turns the hovered block (or the block selection) into another text block type.
import { SideMenuExtension } from "@blocknote/core/extensions";
import {
  SideMenuController, SideMenu, DragHandleMenu, RemoveBlockItem, BlockColorsItem,
  TableRowHeaderItem, TableColumnHeaderItem,
  useComponentsContext, useBlockNoteEditor, useExtensionState,
} from "@blocknote/react";
import i18n from "@/i18n";
import { BulletListGlyph, ChangeTypeGlyph, Heading1Glyph, Heading2Glyph, Heading3Glyph, NumberedListGlyph, ParagraphGlyph, QuoteGlyph, TaskListGlyph, type Glyph } from "@/components/reference/netsuIcons";

export const BLOCK_TYPES: { key: string; type: string; props?: Record<string, boolean | number | string>; icon: Glyph }[] = [
  { key: "paragraph", type: "paragraph", icon: ParagraphGlyph },
  { key: "heading1", type: "heading", props: { level: 1, isToggleable: false }, icon: Heading1Glyph },
  { key: "heading2", type: "heading", props: { level: 2, isToggleable: false }, icon: Heading2Glyph },
  { key: "heading3", type: "heading", props: { level: 3, isToggleable: false }, icon: Heading3Glyph },
  { key: "bulletList", type: "bulletListItem", icon: BulletListGlyph },
  { key: "numberedList", type: "numberedListItem", icon: NumberedListGlyph },
  { key: "checkList", type: "checkListItem", icon: TaskListGlyph },
  { key: "quote", type: "quote", icon: QuoteGlyph },
];

function ChangeBlockTypeItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const block = useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block });
  if (block === undefined || !BLOCK_TYPES.some((item) => item.type === block.type)) return null;

  const changeType = (item: (typeof BLOCK_TYPES)[number]) => {
    const selection = editor.getSelection()?.blocks;
    const supportsChange = (selected: { type: string }) => BLOCK_TYPES.some((candidate) => candidate.type === selected.type);
    const blocks = selection?.some((selected) => selected.id === block.id) && selection.every(supportsChange) ? selection : [block];
    editor.transact(() => {
      for (const selected of blocks) editor.updateBlock(selected, { type: item.type as never, props: item.props as never });
    });
    editor.focus();
  };

  return (
    <Components.Generic.Menu.Root position="right" sub>
      <Components.Generic.Menu.Trigger sub>
        <Components.Generic.Menu.Item className="bn-menu-item" subTrigger icon={<ChangeTypeGlyph className="h-4 w-4" />}>
          {i18n.t("note:sideMenu.changeType")}
        </Components.Generic.Menu.Item>
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown className="bn-menu-dropdown" sub>
        {BLOCK_TYPES.map((item) => {
          const Icon = item.icon;
          const selected = item.type === block.type && (!item.props || Object.entries(item.props).every(([key, value]) => block.props[key] === value));
          return (
            <Components.Generic.Menu.Item key={item.key} className="bn-menu-item" checked={selected} icon={<Icon className="h-4 w-4" />} onClick={() => changeType(item)}>
              {i18n.t(`note:blockTypes.${item.key}`)}
            </Components.Generic.Menu.Item>
          );
        })}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  );
}

export function NoteSideMenu() {
  return (
    <SideMenuController
      sideMenu={(props) => (
        <SideMenu
          {...props}
          dragHandleMenu={() => (
            <DragHandleMenu>
              <ChangeBlockTypeItem />
              <RemoveBlockItem>{i18n.t("note:delete")}</RemoveBlockItem>
              <BlockColorsItem>{i18n.t("note:sideMenu.colors")}</BlockColorsItem>
              <TableRowHeaderItem>{i18n.t("note:sideMenu.rowHeader")}</TableRowHeaderItem>
              <TableColumnHeaderItem>{i18n.t("note:sideMenu.columnHeader")}</TableColumnHeaderItem>
            </DragHandleMenu>
          )}
        />
      )}
    />
  );
}

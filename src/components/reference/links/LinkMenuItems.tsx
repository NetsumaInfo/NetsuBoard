// Link entries of the board's right-click menu: on an item ("Link to…", select what is linked,
// downstream or upstream, collapse its subtree, move it with its subtree, organise its group, remove
// its links), on a link (organise from its source, select its group; on a branch, detach or delete
// it) and on a multi-selection (link as a chain or as a star). BoardMenu only places them.

import { useTranslation } from "react-i18next";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import { OrganiseRadialGlyph, OrganiseTreeDownGlyph, OrganiseTreeRightGlyph, type Glyph } from "../netsuIcons";
import {
  ContextMenuCheckboxItem, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { useBoard } from "../useReferenceBoard";
import { ORGANISE_MODES, type OrganiseMode } from "./graph";
import { connectedIds, isLink } from "./model";
import { downstreamOf, junctionEndOf, linkIndex, upstreamOf } from "./junction";
import { drawShapesOf } from "./useLinkScene";
import { useLinkUi } from "./linkUi";
import {
  deleteShapes, detachBranchEnd, linkSelection, organiseLinks, selectDownstream, selectLinkGroup, selectLinked,
  selectUpstream, startLinkPick, toggleCollapse, unlinkItems,
} from "./linkActions";

const ORGANISE_ICON: Record<OrganiseMode, Glyph> = {
  "tree-right": OrganiseTreeRightGlyph, "tree-down": OrganiseTreeDownGlyph, radial: OrganiseRadialGlyph,
};

function OrganiseSub({ rootId }: { rootId: string }) {
  const { t } = useTranslation("reference");
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger><NetsuIcon name="workflow" /> {t("links.organise")}</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {ORGANISE_MODES.map((m) => {
          const Icon = ORGANISE_ICON[m];
          return (
            <ContextMenuItem key={m} onClick={() => organiseLinks(rootId, m)}>
              <Icon /> {t(`links.organiseModes.${m}`)}
            </ContextMenuItem>
          );
        })}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

export function ItemLinkMenu({ itemId }: { itemId: string }) {
  const { t } = useTranslation("reference");
  const linked = useBoard((s) => connectedIds(drawShapesOf(s.items), itemId).shapeIds.size > 0);
  const leads = useBoard((s) => downstreamOf(drawShapesOf(s.items), [itemId]).size > 0);
  const fed = useBoard((s) => upstreamOf(drawShapesOf(s.items), [itemId]).size > 0);
  const collapsed = useLinkUi((s) => s.collapsed.includes(itemId));
  const moveSubtree = useBoard((s) => s.prefs.linkMoveSubtree);
  return (
    <>
      <ContextMenuItem onClick={() => startLinkPick()}>
        <NetsuIcon name="link" /> {t("links.linkTo")}
      </ContextMenuItem>
      {linked && (
        <ContextMenuSub>
          <ContextMenuSubTrigger><NetsuIcon name="git-fork" /> {t("links.menu")}</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onClick={() => selectLinked([itemId])}>{t("links.selectLinked")}</ContextMenuItem>
            {leads && <ContextMenuItem onClick={() => selectDownstream([itemId])}>{t("links.selectDownstream")}</ContextMenuItem>}
            {fed && <ContextMenuItem onClick={() => selectUpstream([itemId])}>{t("links.selectUpstream")}</ContextMenuItem>}
            <ContextMenuItem onClick={() => selectLinkGroup([itemId])}>{t("links.selectGroup")}</ContextMenuItem>
            {leads && (
              <ContextMenuItem onClick={() => toggleCollapse([itemId])}>
                {t(collapsed ? "links.expand" : "links.collapse")}
              </ContextMenuItem>
            )}
            {leads && (
              <ContextMenuCheckboxItem
                checked={moveSubtree}
                onCheckedChange={() => useBoard.getState().setPrefs({ linkMoveSubtree: !moveSubtree })}
              >
                {t("links.moveSubtree")}
              </ContextMenuCheckboxItem>
            )}
            <OrganiseSub rootId={itemId} />
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={() => unlinkItems([itemId])}>
              <NetsuIcon name="unlink" /> {t("links.removeAll")}
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
    </>
  );
}

export function EdgeLinkMenu({ linkId }: { linkId: string }) {
  const { t } = useTranslation("reference");
  const source = useBoard((s) => {
    const sh = drawShapesOf(s.items).find((x) => x.id === linkId);
    return sh && isLink(sh) ? sh.a1!.id : null;
  });
  // The junction end of a branch (1 or 2), null for a link between two items.
  const junctionEnd = useBoard((s) => {
    const shapes = drawShapesOf(s.items);
    const sh = shapes.find((x) => x.id === linkId);
    return sh && isLink(sh) ? junctionEndOf(sh, linkIndex(shapes)) : null;
  });
  if (!source) return null;
  return (
    <>
      <ContextMenuItem onClick={() => selectLinkGroup([source])}>{t("links.selectGroup")}</ContextMenuItem>
      <OrganiseSub rootId={source} />
      {junctionEnd && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => detachBranchEnd(linkId, junctionEnd)}>
            <NetsuIcon name="unlink" /> {t("links.detachBranch")}
          </ContextMenuItem>
          <ContextMenuItem variant="destructive" onClick={() => deleteShapes([linkId])}>
            <NetsuIcon name="delete" /> {t("links.deleteBranch")}
          </ContextMenuItem>
        </>
      )}
    </>
  );
}

export function MultiLinkMenu() {
  const { t } = useTranslation("reference");
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger><NetsuIcon name="link" /> {t("links.menu")}</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuItem onClick={() => linkSelection("chain")}>{t("links.linkChain")}</ContextMenuItem>
        <ContextMenuItem onClick={() => linkSelection("star")}>{t("links.linkStar")}</ContextMenuItem>
        <ContextMenuItem onClick={() => startLinkPick()}>{t("links.linkTo")}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => selectLinkGroup(useBoard.getState().selectedIds)}>{t("links.selectGroup")}</ContextMenuItem>
        <ContextMenuItem variant="destructive" onClick={() => unlinkItems(useBoard.getState().selectedIds)}>
          <NetsuIcon name="unlink" /> {t("links.removeAllSelected")}
        </ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

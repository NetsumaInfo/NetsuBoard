// Popover offered when a link is dropped on empty space: create a note sheet, a text note or a
// Markdown block there, linked in the same history entry.

import { useTranslation } from "react-i18next";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useBoard } from "../useReferenceBoard";
import { makeBlockItem, makeNoteItem, makeTextItem, topZ, type BoardItem } from "../referenceShared";
import { MODE_ICONS } from "../TextModeControls";
import { autoAnchor } from "./model";
import { applyLinkEnd, newLinkStyle, type LinkDrop } from "./useLinkGesture";
import { drawShapesOf } from "./useLinkScene";

export type DropKind = "note" | "text" | "block";

function makeItem(kind: DropKind, z: number): BoardItem {
  if (kind === "note") return makeNoteItem(0, 0, z);
  if (kind === "block") return makeBlockItem(0, 0, z);
  const p = useBoard.getState().prefs;
  return { ...makeTextItem(0, 0, z), fontFamily: p.defaultFont, fontSize: p.defaultFontSize, color: p.defaultTextColor, bg: p.defaultNoteBg };
}

// Creates the item centred on the drop point and links it. addItem records the history entry; the
// link joins it without a second one: one undo.
export function createAtDrop(drop: LinkDrop, kind: DropKind): void {
  const st = useBoard.getState();
  const base = makeItem(kind, topZ(st.items) + 1);
  const id = st.addItem({ ...base, x: drop.wx - base.w / 2, y: drop.wy - base.h / 2 });
  if (!id) return;
  const after = useBoard.getState();
  const next = applyLinkEnd(drawShapesOf(after.items), drop.spec, autoAnchor(id), [drop.wx, drop.wy, drop.wx, drop.wy], newLinkStyle());
  if (next) after.drawSetShapes(next, false);
  if (kind !== "note") after.setEditing(id);
}

const NoteIcon = MODE_ICONS.sheet, TextIcon = MODE_ICONS.text, BlockIcon = MODE_ICONS.block;

export function LinkDropMenu({ drop, onClose }: { drop: LinkDrop; onClose: () => void }) {
  const { t } = useTranslation("reference");
  const pick = (kind: DropKind) => { onClose(); createAtDrop(drop, kind); };
  return (
    <Popover open onOpenChange={(open) => { if (!open) onClose(); }}>
      <PopoverTrigger
        nativeButton={false}
        render={<span aria-hidden className="pointer-events-none absolute size-px" style={{ left: drop.sx, top: drop.sy }} />}
      />
      <PopoverContent side="bottom" align="start" className="w-44 p-1">
        <div className="flex flex-col gap-0.5">
          <Button variant="ghost" size="sm" className="justify-start" onClick={() => pick("note")}>
            <NoteIcon /> {t("links.noteSheet")}
          </Button>
          <Button variant="ghost" size="sm" className="justify-start" onClick={() => pick("text")}>
            <TextIcon /> {t("links.text")}
          </Button>
          <Button variant="ghost" size="sm" className="justify-start" onClick={() => pick("block")}>
            <BlockIcon /> {t("links.block")}
          </Button>
          <Button variant="ghost" size="sm" className="justify-start text-muted-foreground" onClick={onClose}>
            <NetsuIcon name="close" /> {t("links.cancel")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

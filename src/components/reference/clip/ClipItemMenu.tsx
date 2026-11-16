// Right-click on items inside an open Animatic: put the selection in the shot at the playhead, take
// it out, or move it to the Long lane and back.

import { useTranslation } from "react-i18next";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { useBoard } from "../useReferenceBoard";
import { addToShot, laneOf, longToShot, removeFromShot, shotIndexAt, toLong } from "./clipModel";
import { openClipId, openClipRaw, readClip } from "./clipSelectors";
import { useClipPlayer } from "./clipPlayer";

export function ClipItemMenu() {
  const { t } = useTranslation("reference");
  const clipId = useBoard((s) => openClipId(s));
  const readonly = useBoard((s) => s.collabRole === "viewer" && s.collabProjectId !== null);
  if (!clipId || readonly) return null;

  const run = (fn: (ids: string[], index: number) => void) => {
    const ids = useBoard.getState().selectedIds;
    const clip = readClip(openClipRaw(useBoard.getState()));
    if (!ids.length || !clip) return;
    fn(ids, shotIndexAt(clip, useClipPlayer.getState().time));
  };
  const patch = (make: (ids: string[], index: number) => ReturnType<typeof readClip>) =>
    run((ids, index) => { const next = make(ids, index); if (next) useBoard.getState().patchClip(clipId, next); });
  const current = () => readClip(openClipRaw(useBoard.getState()))!;

  return (
    <>
      <ContextMenuItem onClick={() => patch((ids, i) => addToShot(current(), i, ids))}>
        <NetsuIcon name="add" /> {t("clip.addToShot")}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => patch((ids, i) => removeFromShot(current(), i, ids))}>
        <NetsuIcon name="close" /> {t("clip.removeFromShot")}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => patch((ids) => {
        const c = current();
        // Already in the Long lane: back into a shot; otherwise to the Long lane.
        const allLong = ids.every((id) => laneOf(c, id) && "long" in laneOf(c, id)!);
        return allLong ? ids.reduce((acc, id) => longToShot(acc, id), c) : toLong(c, ids);
      })}
      >
        <NetsuIcon name="lane-long" /> {t("clip.toLongOrBack")}
      </ContextMenuItem>
      <ContextMenuSeparator />
    </>
  );
}

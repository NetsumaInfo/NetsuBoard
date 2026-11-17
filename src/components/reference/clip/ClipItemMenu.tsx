// Right-click on items inside an open Animatic. Every action applies to the whole selection: put it
// in the shot at the playhead or take it out, make it enter or leave at the playhead, make it enter
// one item after another, choose how it appears, or move it to the Long lane and back.

import { useTranslation } from "react-i18next";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import {
  ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { useBoard } from "../useReferenceBoard";
import {
  addToShot, cascade, formatTime, laneOf, longToShot, markIn, markOut, removeFromShot, resetTiming, setFx,
  shotIndexAt, toLong, type ClipData, type FxKind,
} from "./clipModel";
import { openClipId, openClipRaw, readClip } from "./clipSelectors";
import { useClipPlayer } from "./clipPlayer";
import { boardOrder } from "./timelineRows";

const FX: FxKind[] = ["fade", "zoom", "slide", "cut"];
const DURS = [0.15, 0.3, 0.6, 1];

export function ClipItemMenu() {
  const { t } = useTranslation("reference");
  const clipId = useBoard((s) => openClipId(s));
  const readonly = useBoard((s) => s.collabRole === "viewer" && s.collabProjectId !== null);
  const count = useBoard((s) => s.selectedIds.length);
  if (!clipId || readonly) return null;

  // Runs an edit on the selection, at the shot under the playhead; `say` reports it on screen.
  const apply = (make: (c: ClipData, ids: string[], shot: number, time: number) => ClipData, say?: (time: number) => string) => {
    const st = useBoard.getState();
    const c = readClip(openClipRaw(st));
    const ids = st.selectedIds;
    if (!c || !ids.length) return;
    const time = useClipPlayer.getState().time;
    st.patchClip(clipId, make(c, ids, shotIndexAt(c, time), time));
    if (say) st.setNotice({ text: say(time), kind: "ok" });
  };
  const byId = () => new Map(useBoard.getState().items.map((it) => [it.id, it]));

  return (
    <>
      <ContextMenuItem onClick={() => apply((c, ids, i) => addToShot(c, i, ids))}>
        <NetsuIcon name="add" /> {t("clip.addToShot")}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => apply((c, ids, i) => removeFromShot(c, i, ids))}>
        <NetsuIcon name="close" /> {t("clip.removeFromShot")}
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger><NetsuIcon name="mark-in" /> {t("clip.timing")}</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem onClick={() => apply((c, ids, _i, time) => markIn(c, ids, time), (time) => t("clip.markedIn", { count, time: formatTime(time) }))}>
            <NetsuIcon name="mark-in" /> {t("clip.markIn")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => apply((c, ids, _i, time) => markOut(c, ids, time), (time) => t("clip.markedOut", { count, time: formatTime(time) }))}>
            <NetsuIcon name="mark-out" /> {t("clip.markOut")}
          </ContextMenuItem>
          <ContextMenuItem disabled={count < 2} onClick={() => apply((c, ids, i) => cascade(addToShot(c, i, ids), i, boardOrder(ids, byId())))}>
            <NetsuIcon name="cascade" /> {t("clip.cascade")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => apply((c, ids, i) => resetTiming(c, i, ids))}>
            <NetsuIcon name="reset" /> {t("clip.resetTiming")}
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger><NetsuIcon name="sparkles" /> {t("clip.fx")}</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {FX.map((k) => (
            <ContextMenuItem key={k} onClick={() => apply((c, ids) => setFx(c, ids, { kind: k }))}>
              {t(`clip.fxKinds.${k}`)}
            </ContextMenuItem>
          ))}
          <ContextMenuSeparator />
          {DURS.map((d) => (
            <ContextMenuItem key={d} onClick={() => apply((c, ids) => setFx(c, ids, { dur: d }))}>
              {t("clip.fxDurationValue", { value: d })}
            </ContextMenuItem>
          ))}
          <ContextMenuSeparator />
          {[1, 0.75, 0.5, 0.25].map((o) => (
            <ContextMenuItem key={o} onClick={() => apply((c, ids) => setFx(c, ids, { opacity: o }))}>
              {t("clip.fxOpacityValue", { value: Math.round(o * 100) })}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem onClick={() => apply((c, ids) => {
        // Already in the Long lane: back into a shot; otherwise to the Long lane.
        const allLong = ids.every((id) => { const l = laneOf(c, id); return !!l && "long" in l; });
        return allLong ? ids.reduce((acc, id) => longToShot(acc, id), c) : toLong(c, ids);
      })}
      >
        <NetsuIcon name="lane-long" /> {t("clip.toLongOrBack")}
      </ContextMenuItem>
      <ContextMenuSeparator />
    </>
  );
}

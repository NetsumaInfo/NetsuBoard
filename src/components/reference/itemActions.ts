// What can be pulled out of a media item, and its sound switch: ONE list, read by the Inspector's
// "More" menu and the right-click "Media" group, so both always offer the same actions under the
// same words and conditions.

import i18n from "@/i18n";
import { nr } from "@/lib/bridge";
import { displaySrc, isCoreFileRef, probeImage, type BoardItem } from "./referenceShared";
import { useBoard } from "./useReferenceBoard";
import { audioExtractable, extractAudioToBoard } from "./boardAudioActions";
import { extractPaletteToBoard } from "./boardPaletteActions";
import { loopExportable } from "./boardLoopExport";

const tr = (key: string, opts?: Record<string, unknown>) => i18n.t(`reference:${key}`, opts);

// Cadence supposée d'une source en mode « même que la vidéo » (la vraie vient du core, après coup) :
// haute exprès, l'avertissement « vidéo longue » doit se déclencher plutôt trop tôt que trop tard.
const ASSUMED_SOURCE_FPS = 30;

export interface ItemAction {
  id: "sound" | "extractAudio" | "extractPalette" | "extractFrames" | "exportLoop";
  label: string;
  icon: string;
  /** Held state of a switch icon (sound). */
  on?: boolean;
  run: () => void;
}

/** A video whose file is on this disk can be cut into a picture sequence. */
export const framesExtractable = (item: BoardItem) => item.kind === "video" && isCoreFileRef(item.ref);

/**
 * Décompose la vidéo en frames d'aperçu sur la PLAGE DE BOUCLE [in, out] (sinon vidéo entière),
 * élargie de la MARGE des Paramètres. Cadence/qualité/plafond viennent aussi des Paramètres. Crée une
 * séquence en place, ratio ajusté. Prévient avant si trop long.
 */
export async function extractFramesToSequence(id: string): Promise<void> {
  const st = useBoard.getState();
  const item = st.items.find((it) => it.id === id);
  if (!item || !framesExtractable(item)) return;
  const { seqFps: fps, seqMaxFrames: max, seqHeight: height, seqMarginSec: margin } = st.prefs;
  const estFps = fps > 0 ? fps : ASSUMED_SOURCE_FPS;
  const tin = item.trimIn && item.trimIn > 0 ? item.trimIn : 0;
  const tout = item.trimOut != null && item.trimOut > tin ? item.trimOut : 0;
  const inSec = tout > 0 ? Math.max(0, tin - margin) : undefined;
  const outSec = tout > 0 ? tout + margin : undefined;
  const range = inSec != null && outSec != null ? outSec - inSec : item.dur ?? 0;
  const long = range === 0 || range * estFps > max;
  st.setNotice({ kind: "ok", sticky: true, text: long ? tr("inspector.longVideo", { max }) : tr("inspector.extractingFrames") });
  const r = await nr.reference?.extractFrames?.({ path: item.ref, fps, max, height, in: inSec, out: outSec });
  if (r?.ok && r.frames?.length) {
    const nat = await probeImage(displaySrc("image", r.frames[0]));
    useBoard.getState().addSequenceFrom(item.id, r.frames, nat.w && nat.h ? { w: nat.w, h: nat.h } : undefined, r.fps || estFps);
    useBoard.getState().setNotice({ kind: "ok", text: tr("inspector.sequenceCreated", { count: r.frames.length }) });
  } else {
    useBoard.getState().setNotice({ kind: "error", text: tr("notice.extractFailed") });
  }
}

export function mediaActions(item: BoardItem, opts: { openLoop: () => void; sound?: boolean }): ItemAction[] {
  const out: ItemAction[] = [];
  if (opts.sound !== false && item.kind === "video") {
    out.push({
      id: "sound",
      label: item.sound ? tr("audio.turnOff") : tr("audio.turnOn"),
      icon: "mute",
      on: !item.sound,
      run: () => useBoard.getState().patchItem(item.id, { sound: !item.sound || undefined }),
    });
  }
  if (audioExtractable(item)) {
    out.push({ id: "extractAudio", label: tr("audio.extract"), icon: "music", run: () => void extractAudioToBoard(item.id) });
  }
  if ((item.kind === "image" || item.kind === "video") && !item.missing) {
    out.push({ id: "extractPalette", label: tr("palette.extract"), icon: "extract-palette", run: () => void extractPaletteToBoard() });
  }
  if (framesExtractable(item)) {
    out.push({ id: "extractFrames", label: tr("inspector.extractFrames"), icon: "extract-frames", run: () => void extractFramesToSequence(item.id) });
  }
  if (loopExportable(item)) {
    out.push({ id: "exportLoop", label: tr("exportLoop.menu"), icon: "export-loop", run: opts.openLoop });
  }
  return out;
}

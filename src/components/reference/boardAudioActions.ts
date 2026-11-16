// Sound of a video on the board: turn it on or off, or pull it out as its own audio card.

import { nr } from "@/lib/bridge";
import i18n from "@/i18n";
import { AUDIO_CARD, displaySrc, isCoreFileRef, type BoardItem } from "./referenceShared";
import { useBoard } from "./useReferenceBoard";

const tr = (key: string, opts?: Record<string, unknown>) => i18n.t(`reference:${key}`, opts);

/** The sound track can be copied out: a video whose file is on this disk. */
export function audioExtractable(item: BoardItem): boolean {
  return item.kind === "video" && isCoreFileRef(item.ref) && !item.missing;
}

/**
 * Copies the video's sound (its loop range when one is set) into a file, without re-encoding, and
 * lays an audio card just under the video.
 */
export async function extractAudioToBoard(id: string): Promise<boolean> {
  const st = useBoard.getState();
  const item = st.items.find((it) => it.id === id);
  if (!item || !audioExtractable(item) || !nr.reference?.extractAudio) return false;
  st.setNotice({ kind: "ok", sticky: true, text: tr("audio.extracting") });
  const start = item.trimIn && item.trimIn > 0 ? item.trimIn : undefined;
  const end = item.trimOut != null && item.trimOut > (start ?? 0) ? item.trimOut : undefined;
  const res = await nr.reference.extractAudio({ path: item.ref, start, end }).catch((e) => ({ ok: false as const, error: String(e) }));
  if (!res.ok || !res.path) {
    useBoard.getState().setNotice({
      kind: "error",
      text: res.error === "no audio" ? tr("audio.noTrack") : tr("audio.extractFailed"),
    });
    return false;
  }
  const stem = (item.title || item.ref.split(/[\\/]/).pop() || "").replace(/\.[^.]+$/, "");
  const ext = res.path.split(".").pop() ?? "";
  const board = useBoard.getState();
  const gap = board.prefs.arrangeGap ?? 24;
  const newId = board.addItem({
    kind: "audio",
    ref: res.path,
    src: displaySrc("audio", res.path),
    x: item.x,
    y: item.y + item.h + gap,
    w: Math.max(AUDIO_CARD.w, Math.min(item.w, AUDIO_CARD.w * 1.6)),
    h: AUDIO_CARD.h,
    rotation: 0,
    title: `${stem || tr("audio.untitled")}.${ext}`,
    dur: end != null ? end - (start ?? 0) : item.dur,
  });
  board.select(newId);
  board.setNotice({ kind: "ok", text: tr("audio.extracted") });
  return true;
}

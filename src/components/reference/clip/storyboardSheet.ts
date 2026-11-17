// The storyboard as one picture to send around: every shot's camera view in reading order, with its
// number, name, time and note, under a title line. Drawn on a canvas from the same off-screen render
// as the storyboard cards.

import type { BoardItem } from "../referenceShared";
import { renderBoardCanvas } from "../boardRender";
import { cameraAt, clipDuration, formatTime, presentAt, shotEnd, type ClipData } from "./clipModel";
import { wrapText } from "./wrapText";

export interface SheetLabels { shot: (n: number) => string; title: string; subtitle: string }

const COLS = 4;
const THUMB_W = 480;
const THUMB_H = 270;
const GAP = 28;
const PAD = 48;
const CAPTION_H = 96;
const HEAD_H = 92;

export async function renderStoryboardSheet(clip: ClipData, items: BoardItem[], labels: SheetLabels): Promise<HTMLCanvasElement> {
  const n = clip.shots.length;
  const cols = Math.min(COLS, n);
  const rows = Math.ceil(n / cols);
  const canvas = document.createElement("canvas");
  canvas.width = PAD * 2 + cols * THUMB_W + (cols - 1) * GAP;
  canvas.height = PAD * 2 + HEAD_H + rows * (THUMB_H + CAPTION_H) + (rows - 1) * GAP;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("canvas");
  g.fillStyle = "#101014";
  g.fillRect(0, 0, canvas.width, canvas.height);
  const font = "system-ui, -apple-system, Segoe UI, sans-serif";
  g.fillStyle = "#f4f4f5";
  g.font = `600 34px ${font}`;
  g.fillText(labels.title, PAD, PAD + 34);
  g.fillStyle = "#a1a1aa";
  g.font = `400 20px ${font}`;
  g.fillText(labels.subtitle, PAD, PAD + 68);

  for (let i = 0; i < n; i++) {
    const s = clip.shots[i];
    const x = PAD + (i % cols) * (THUMB_W + GAP);
    const y = PAD + HEAD_H + Math.floor(i / cols) * (THUMB_H + CAPTION_H + GAP);
    const end = shotEnd(clip, i);
    const mid = (s.start + end) / 2;
    const present = presentAt(clip, mid);
    const shown = items.filter((it) => present.has(it.id));
    g.fillStyle = "#000";
    g.fillRect(x, y, THUMB_W, THUMB_H);
    if (shown.length) {
      try {
        const shot = await renderBoardCanvas(shown, { rect: cameraAt(clip, mid), width: THUMB_W, background: "#000", shapes: false });
        g.drawImage(shot, x, y, THUMB_W, THUMB_H);
      } catch { /* a media that cannot be read: the frame stays black */ }
    }
    g.fillStyle = "rgba(0,0,0,0.7)";
    g.fillRect(x + 10, y + 10, 44, 30);
    g.fillStyle = "#fff";
    g.font = `600 20px ${font}`;
    g.fillText(String(i + 1), x + 18 + (i + 1 < 10 ? 6 : 0), y + 32);

    g.fillStyle = "#f4f4f5";
    g.font = `600 20px ${font}`;
    const name = s.label || labels.shot(i + 1);
    g.fillText(wrapText(name, THUMB_W - 150, (t) => g.measureText(t).width, 1)[0] ?? "", x, y + THUMB_H + 28);
    g.fillStyle = "#a1a1aa";
    g.font = `400 16px ${font}`;
    const time = `${formatTime(s.start)} – ${formatTime(end)}`;
    g.fillText(time, x + THUMB_W - g.measureText(time).width, y + THUMB_H + 28);
    if (s.note) {
      g.fillStyle = "#d4d4d8";
      g.font = `400 17px ${font}`;
      wrapText(s.note, THUMB_W, (t) => g.measureText(t).width, 3).forEach((line, k) => g.fillText(line, x, y + THUMB_H + 54 + k * 21));
    }
  }
  // Duration of the track, bottom right, so the sheet says how long the piece runs.
  g.fillStyle = "#71717a";
  g.font = `400 14px ${font}`;
  const total = formatTime(clipDuration(clip));
  g.fillText(total, canvas.width - PAD - g.measureText(total).width, canvas.height - PAD / 2);
  return canvas;
}

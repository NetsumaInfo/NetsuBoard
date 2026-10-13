// Whole board as a looping animated image: the board is split into what moves and what does not.
//
// A playing video cannot be painted into a canvas frame by frame at any useful speed, so the board
// is not captured: it is described. Videos keep their place in the z order as clips the core plays
// with ffmpeg, and everything between two of them is painted once, as a still layer the size of
// the output. The core stacks the lot (core/loopExport.js, `boardLoopArgs`).

import type { BoardLoopEntry } from "@/lib/bridge";
import { isCoreFileRef, type BoardItem } from "./referenceShared";
import { exportLayout, renderBoardCanvas, visibleItems, type RenderOptions } from "./boardRender";
import { loopSpan } from "./boardLoopExport";

/** A video the core can play from disk. Anything else is painted still, as in the image export. */
export function animatedItem(item: BoardItem): boolean {
  return item.kind === "video" && isCoreFileRef(item.ref) && !item.missing;
}

/** Videos the export would animate, in the given scope. */
export function animatedItems(items: BoardItem[], only?: Set<string>): BoardItem[] {
  return visibleItems(items, only).filter(animatedItem);
}

/**
 * The scope in z order, cut at each video: `still` runs of item ids, each followed by the video
 * that sits above it (none after the last run).
 */
export function loopRuns(items: BoardItem[], only?: Set<string>): { still: string[]; clip?: BoardItem }[] {
  const runs: { still: string[]; clip?: BoardItem }[] = [];
  let still: string[] = [];
  for (const item of visibleItems(items, only)) {
    if (animatedItem(item)) {
      runs.push({ still, clip: item });
      still = [];
    } else still.push(item.id);
  }
  runs.push({ still });
  return runs;
}

function layerPng(canvas: HTMLCanvasElement): string {
  const url = canvas.toDataURL("image/png");
  return url.slice(url.indexOf(",") + 1);
}

/**
 * The stack sent to the core, bottom first. The first layer is always there: it carries the
 * background and gives the output its size. A later run with nothing to paint sends no layer.
 */
export async function buildBoardLoopStack(
  items: BoardItem[],
  opts: Pick<RenderOptions, "width" | "background" | "only">,
): Promise<{ stack: BoardLoopEntry[]; width: number; height: number }> {
  const layout = exportLayout(items, opts);
  const runs = loopRuns(items, opts.only);
  const hasShapes = !opts.only && items.some((it) => it.kind === "draw" && (it.shapes?.length ?? 0) > 0);
  const stack: BoardLoopEntry[] = [];

  for (let i = 0; i < runs.length; i += 1) {
    const { still, clip } = runs[i];
    const first = i === 0;
    const last = i === runs.length - 1;
    const shapes = last && hasShapes;
    if (first || still.length || shapes) {
      const canvas = await renderBoardCanvas(items, {
        width: opts.width,
        only: opts.only,
        background: first ? opts.background : null,
        paint: new Set(still),
        shapes,
      });
      stack.push({ png: layerPng(canvas) });
    }
    if (clip) {
      const span = loopSpan(clip);
      stack.push({
        path: clip.ref,
        in: span.in,
        end: span.end,
        x: (clip.x + clip.w / 2 + layout.dx) * layout.scale,
        y: (clip.y + clip.h / 2 + layout.dy) * layout.scale,
        w: clip.w * layout.scale,
        h: clip.h * layout.scale,
        crop: clip.crop,
        flipH: clip.flipH,
        flipV: clip.flipV,
        rotation: clip.rotation || undefined,
        opacity: clip.opacity,
      });
    }
  }
  return { stack, width: layout.outW, height: layout.outH };
}

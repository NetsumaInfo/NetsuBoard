// Where the label of a link sits: the middle of its path, slid along the path to a free spot when an
// item (other than the two it links) would hide it. Pure; LinkLayer feeds it the scene items.

import { rotatedBBox } from "../boardArrange";
import { pointAt } from "./junction";
import type { LinkGeo, Pt } from "./model";

// Arc-length fractions tried, nearest to the middle first.
const FRACTIONS = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82];

interface Obstacle { id: string; kind: string; x: number; y: number; w: number; h: number; rotation?: number }

// `size` = the label pill in screen px, `k` = world units per screen px. Frames are backdrops, not
// obstacles. Returns the path midpoint when it is free, or when no tried spot is.
export function labelPoint(geo: LinkGeo, size: { w: number; h: number }, k: number, items: Iterable<Obstacle>): Pt {
  const own = new Set([geo.shape.a1?.id, geo.shape.a2?.id]);
  const hw = (size.w / 2 + 4) * k, hh = (size.h / 2 + 3) * k;
  const [bx0, by0, bx1, by1] = geo.path.bbox;
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const it of items) {
    if (own.has(it.id) || it.kind === "frame" || it.kind === "draw") continue;
    const b = rotatedBBox(it);
    if (b.x > bx1 + hw || b.x + b.w < bx0 - hw || b.y > by1 + hh || b.y + b.h < by0 - hh) continue;
    boxes.push({ x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h });
  }
  if (!boxes.length) return geo.path.mid;
  const free = (p: Pt) => !boxes.some((b) => p.x + hw > b.x0 && p.x - hw < b.x1 && p.y + hh > b.y0 && p.y - hh < b.y1);
  if (free(geo.path.mid)) return geo.path.mid;
  for (let i = 1; i < FRACTIONS.length; i++) {
    const p = pointAt(geo.path.pts, FRACTIONS[i]);
    if (free(p)) return { x: p.x, y: p.y };
  }
  return geo.path.mid;
}

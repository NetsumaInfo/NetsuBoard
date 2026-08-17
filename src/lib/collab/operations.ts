import type { BoardItem, DrawShape } from "@/components/reference/referenceShared";
import type {
  Appearance,
  BoardPalette,
  CollabOp,
  EmbedMetadata,
  FrameStyle,
  Geometry,
  LinkMetadata,
  MediaAsset,
  MediaManifest,
  Playback,
  TextStyle,
  VectorShape,
} from "./types";

export type AssetResolver = (ref: string, item: BoardItem) => MediaAsset | null;

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function geometry(item: BoardItem): Geometry {
  return {
    x: item.x,
    y: item.y,
    width: item.w,
    height: item.h,
    rotation: item.rotation,
    naturalWidth: item.natW,
    naturalHeight: item.natH,
    detached: item.detached ?? false,
  };
}

function appearance(item: BoardItem): Appearance {
  return {
    title: item.title,
    opacity: item.opacity,
    flipHorizontal: item.flipH ?? false,
    flipVertical: item.flipV ?? false,
  };
}

function textStyle(item: BoardItem): TextStyle {
  return {
    fontSize: item.fontSize,
    fontFamily: item.fontFamily,
    color: item.color,
    background: item.bg,
    highlight: item.highlight,
    lineHeight: item.lineHeight,
    indent: item.indent,
    bullet: item.bullet ?? false,
    numbered: item.numbered ?? false,
    strike: item.strike ?? false,
    align: item.align,
    bold: item.bold ?? false,
    italic: item.italic ?? false,
    underline: item.underline ?? false,
  };
}

function frameStyle(item: BoardItem): FrameStyle {
  return {
    fillMode: item.fillMode ?? (item.filled ? "solid" : undefined),
    fillColor: item.fillColor,
    titleBackground: item.titleBg,
  };
}

function playback(item: BoardItem): Playback {
  return {
    playMode: item.playMode,
    frame: item.frame,
    fps: item.fps,
    speed: item.speed,
    sequencePlaying: item.seqPlay ?? false,
    sequenceIn: item.seqIn,
    sequenceOut: item.seqOut,
  };
}

function palette(item: BoardItem): BoardPalette {
  return {
    colors: [...(item.colors ?? [])],
    sourceItemIds: [...(item.sourceIds ?? [])],
    showValues: item.showHex ?? false,
    colorFormat: item.colorFormat ?? "hex",
    layout: item.paletteLayout ?? "row",
  };
}

function embed(item: BoardItem): EmbedMetadata | null {
  return item.embed ? {
    level: item.embed.level,
    quality: item.embed.quality,
    marginSeconds: item.embed.marginSec,
  } : null;
}

function link(item: BoardItem): LinkMetadata | null {
  if (!item.link) return null;
  if (item.link.kind === "file") {
    if (!item.link.target.startsWith("collab:")) return null;
    return { ...item.link, target: item.link.target.slice("collab:".length) };
  }
  return item.link;
}

function automaticAsset(ref: string, item: BoardItem): MediaAsset | null {
  if (!ref) return null;
  if (item.kind === "youtube" && !/^https?:/i.test(ref)) {
    return { youtubeId: ref, displayName: "YouTube", mime: "video/youtube", size: 0, sourceUrl: item.sourceUrl };
  }
  if (!/^https?:/i.test(ref)) return null;
  let displayName = "remote-media";
  try {
    displayName = new URL(ref).pathname.split("/").filter(Boolean).at(-1) ?? displayName;
  } catch { /* Rust performs the authoritative URL validation. */ }
  return {
    remoteUrl: ref,
    displayName,
    mime: item.kind === "video" ? "video/*" : "image/*",
    size: 0,
    sourceUrl: item.sourceUrl,
  };
}

function mediaManifest(item: BoardItem, resolveAsset: AssetResolver): MediaManifest | null {
  const primary = resolveAsset(item.ref, item) ?? automaticAsset(item.ref, item);
  if (!primary) return null;
  const previousAsset = item.prevMedia
    ? resolveAsset(item.prevMedia.ref, item) ?? automaticAsset(item.prevMedia.ref, { ...item, kind: item.prevMedia.kind ?? item.kind })
    : null;
  const localAsset = item.localMedia
    ? resolveAsset(item.localMedia.ref, item) ?? automaticAsset(item.localMedia.ref, { ...item, kind: item.localMedia.kind })
    : null;
  return {
    primary,
    previous: item.prevMedia && previousAsset ? {
      kind: item.prevMedia.kind,
      asset: { ...previousAsset, sourceUrl: item.prevMedia.sourceUrl ?? previousAsset.sourceUrl },
      trim: item.prevMedia.trimIn !== undefined && item.prevMedia.trimOut !== undefined
        ? { start: item.prevMedia.trimIn, end: item.prevMedia.trimOut }
        : undefined,
      crop: item.prevMedia.crop
        ? { x: item.prevMedia.crop.x, y: item.prevMedia.crop.y, width: item.prevMedia.crop.w, height: item.prevMedia.crop.h }
        : undefined,
    } : undefined,
    local: item.localMedia && localAsset ? {
      kind: item.localMedia.kind,
      asset: localAsset,
      naturalWidth: item.localMedia.natW,
      naturalHeight: item.localMedia.natH,
    } : undefined,
  };
}

function crop(item: BoardItem) {
  return item.crop ? { x: item.crop.x, y: item.crop.y, width: item.crop.w, height: item.crop.h } : null;
}

function trim(item: BoardItem) {
  return item.trimIn !== undefined && item.trimOut !== undefined
    ? { start: item.trimIn, end: item.trimOut, duration: item.dur }
    : null;
}

export function diffText(itemId: string, previous: string, next: string): CollabOp[] {
  const before = Array.from(previous);
  const after = Array.from(next);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1;
  const removed = before.length - prefix - suffix;
  const inserted = after.slice(prefix, after.length - suffix).join("");
  const ops: CollabOp[] = [];
  if (removed) ops.push({ type: "textDelete", itemId, index: prefix, len: removed });
  if (inserted) ops.push({ type: "textInsert", itemId, index: prefix, text: inserted });
  return ops;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function encodeStroke(shape: DrawShape): string {
  if (shape.t !== "pen" || shape.p.length < 2 || shape.p.length % 2 !== 0) {
    throw new Error("a finished pen stroke needs complete x/y points");
  }
  const count = shape.p.length / 2;
  const pressure = Boolean(shape.pw?.length === count);
  const stride = pressure ? 12 : 8;
  const bytes = new Uint8Array(6 + count * stride);
  const view = new DataView(bytes.buffer);
  bytes[0] = 1;
  bytes[1] = pressure ? 1 : 0;
  view.setUint32(2, count, true);
  for (let index = 0, offset = 6; index < count; index += 1, offset += stride) {
    view.setFloat32(offset, shape.p[index * 2], true);
    view.setFloat32(offset + 4, shape.p[index * 2 + 1], true);
    if (pressure) view.setFloat32(offset + 8, shape.pw![index], true);
  }
  return encodeBase64(bytes);
}

function anchor(value: DrawShape["a1"]) {
  return value ? { itemId: value.id, xFraction: value.fx, yFraction: value.fy } : undefined;
}

function vectorShape(shape: DrawShape): VectorShape {
  if (shape.t === "pen") throw new Error("pen strokes use their immutable binary operation");
  return {
    shapeId: shape.id,
    kind: shape.t,
    color: shape.c,
    width: shape.w,
    points: [...shape.p],
    fill: shape.fill,
    text: shape.text,
    controlPoint: shape.cp,
    startHead: shape.h1,
    endHead: shape.h2,
    dash: shape.dash,
    route: shape.route,
    opacity: shape.op,
    rounded: shape.r ?? false,
    ownerItemId: shape.own,
    ownerPoints: [...(shape.ownPts ?? [])],
    startAnchor: anchor(shape.a1),
    endAnchor: anchor(shape.a2),
    detached: shape.detached ?? false,
  };
}

function addItemOps(item: BoardItem, resolveAsset: AssetResolver): CollabOp[] {
  const ops: CollabOp[] = [
    { type: "addItem", itemId: item.id, kind: item.kind, geometry: geometry(item) },
    { type: "setAppearance", itemId: item.id, appearance: appearance(item) },
    { type: "setTextStyle", itemId: item.id, style: textStyle(item) },
    { type: "setFrameStyle", itemId: item.id, frame: frameStyle(item) },
    { type: "setPlayback", itemId: item.id, playback: playback(item) },
  ];
  if (item.crop) ops.push({ type: "setCrop", itemId: item.id, crop: crop(item) });
  if (trim(item)) ops.push({ type: "setTrim", itemId: item.id, trim: trim(item) });
  const manifest = mediaManifest(item, resolveAsset);
  if (manifest) ops.push({ type: "setMediaManifest", itemId: item.id, manifest });
  if (item.link) ops.push({ type: "setLink", itemId: item.id, link: link(item) });
  if (item.embed) ops.push({ type: "setEmbed", itemId: item.id, embed: embed(item) });
  if (item.frames?.length) {
    const frames = item.frames
      .map((ref) => resolveAsset(ref, item) ?? automaticAsset(ref, item))
      .filter((frame): frame is MediaAsset => frame !== null);
    if (frames.length === item.frames.length) {
      ops.push({ type: "setSequence", itemId: item.id, sequence: { frames } });
    }
  }
  if (item.kind === "palette") ops.push({ type: "setPalette", itemId: item.id, palette: palette(item) });
  if (item.text) ops.push({ type: "textInsert", itemId: item.id, index: 0, text: item.text });
  for (const shape of item.kind === "draw" ? item.shapes ?? [] : []) {
    if (shape.t === "pen") {
      ops.push({
        type: "addStroke",
        strokeId: shape.id,
        color: shape.c,
        width: shape.w,
        opacity: shape.op ?? 1,
        encodedPoints: encodeStroke(shape),
        ownerItemId: shape.own,
        detached: shape.detached ?? false,
      });
    } else {
      ops.push({ type: "upsertShape", ...vectorShape(shape) });
    }
  }
  return ops;
}

function diffDraw(previous: DrawShape[], next: DrawShape[]): CollabOp[] {
  const before = new Map(previous.map((shape) => [shape.id, shape]));
  const after = new Map(next.map((shape) => [shape.id, shape]));
  const ops: CollabOp[] = [];
  for (const shape of next) {
    const old = before.get(shape.id);
    if (old && same(old, shape)) continue;
    if (shape.t === "pen") {
      if (old) ops.push({ type: "deleteStroke", strokeId: shape.id });
      ops.push({
        type: "addStroke", strokeId: shape.id, color: shape.c, width: shape.w,
        opacity: shape.op ?? 1, encodedPoints: encodeStroke(shape), ownerItemId: shape.own,
        detached: shape.detached ?? false,
      });
    } else {
      ops.push({ type: "upsertShape", ...vectorShape(shape) });
    }
  }
  for (const shape of previous) {
    if (after.has(shape.id)) continue;
    ops.push(shape.t === "pen"
      ? { type: "deleteStroke", strokeId: shape.id }
      : { type: "deleteShape", shapeId: shape.id });
  }
  return ops;
}

function reorderOps(previous: BoardItem[], next: BoardItem[]): CollabOp[] {
  const current = previous.map((item) => item.id).filter((id) => next.some((item) => item.id === id));
  const desired = next.map((item) => item.id).filter((id) => previous.some((item) => item.id === id));
  const ops: CollabOp[] = [];
  for (let index = 0; index < desired.length; index += 1) {
    if (current[index] === desired[index]) continue;
    const from = current.indexOf(desired[index], index + 1);
    if (from < 0) continue;
    const [id] = current.splice(from, 1);
    const before = current[index] ?? null;
    current.splice(index, 0, id);
    ops.push({ type: "moveItem", itemId: id, before });
  }
  return ops;
}

export function diffBoard(
  previous: BoardItem[],
  next: BoardItem[],
  resolveAsset: AssetResolver = () => null,
): CollabOp[] {
  const before = new Map(previous.map((item) => [item.id, item]));
  const after = new Map(next.map((item) => [item.id, item]));
  const ops: CollabOp[] = [];
  for (const item of next) {
    const old = before.get(item.id);
    if (!old) {
      ops.push(...addItemOps(item, resolveAsset));
      continue;
    }
    if (!same(geometry(old), geometry(item))) ops.push({ type: "setGeometry", itemId: item.id, geometry: geometry(item) });
    if (!same(appearance(old), appearance(item))) ops.push({ type: "setAppearance", itemId: item.id, appearance: appearance(item) });
    if (!same(textStyle(old), textStyle(item))) ops.push({ type: "setTextStyle", itemId: item.id, style: textStyle(item) });
    if (!same(frameStyle(old), frameStyle(item))) ops.push({ type: "setFrameStyle", itemId: item.id, frame: frameStyle(item) });
    if (!same(playback(old), playback(item))) ops.push({ type: "setPlayback", itemId: item.id, playback: playback(item) });
    if (!same(crop(old), crop(item))) ops.push({ type: "setCrop", itemId: item.id, crop: crop(item) });
    if (!same(trim(old), trim(item))) ops.push({ type: "setTrim", itemId: item.id, trim: trim(item) });
    if (old.ref !== item.ref || old.sourceUrl !== item.sourceUrl) {
      ops.push({ type: "setMediaManifest", itemId: item.id, manifest: mediaManifest(item, resolveAsset) });
    }
    if (!same(link(old), link(item))) ops.push({ type: "setLink", itemId: item.id, link: link(item) });
    if (!same(embed(old), embed(item))) ops.push({ type: "setEmbed", itemId: item.id, embed: embed(item) });
    if (!same(old.frames ?? [], item.frames ?? [])) {
      const frames = (item.frames ?? [])
        .map((ref) => resolveAsset(ref, item) ?? automaticAsset(ref, item))
        .filter((frame): frame is MediaAsset => frame !== null);
      ops.push({
        type: "setSequence",
        itemId: item.id,
        sequence: frames.length === (item.frames?.length ?? 0) && frames.length ? { frames } : null,
      });
    }
    if (item.kind === "palette" && !same(palette(old), palette(item))) {
      ops.push({ type: "setPalette", itemId: item.id, palette: palette(item) });
    }
    ops.push(...diffText(item.id, old.text ?? "", item.text ?? ""));
    if (item.kind === "draw") ops.push(...diffDraw(old.shapes ?? [], item.shapes ?? []));
  }
  for (const item of previous) {
    if (!after.has(item.id)) ops.push({ type: "deleteItem", itemId: item.id });
  }
  ops.push(...reorderOps(previous, next));
  return ops;
}

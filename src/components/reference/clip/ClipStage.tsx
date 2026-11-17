// What a clip draws on and over the board: the camera framings of the shot under the playhead
// (editable, in board coordinates), the black bars and input shield of Present, and the Long items
// pinned to the screen.

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useBoard } from "../useReferenceBoard";
import type { BoardItem } from "../referenceShared";
import { CLIP_ASPECT, cameraAt, clipDuration, patchShot, shotIndexAt, type ClipData, type ClipRect, type PinCorner } from "./clipModel";
import { openClipId, openClipRaw, readClip } from "./clipSelectors";
import { seek, useClipPlayer } from "./clipPlayer";

function useOpenClip(): { id: string | null; clip: ClipData | null } {
  const id = useBoard((s) => openClipId(s));
  const raw = useBoard((s) => openClipRaw(s));
  return { id, clip: useMemo(() => readClip(raw), [raw]) };
}

const same = (a: ClipRect, b: ClipRect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

// ── Framings ────────────────────────────────────────────────────────────────

export function ClipFramings() {
  const { t } = useTranslation("reference");
  const { id, clip } = useOpenClip();
  const scale = useBoard((s) => s.view.scale);
  const time = useClipPlayer((s) => s.time);
  const playing = useClipPlayer((s) => s.playing);
  const follow = useClipPlayer((s) => s.follow);
  const presenting = useClipPlayer((s) => s.presenting);
  const drag = useRef<{ which: "from" | "to" | "both"; mode: "move" | "resize"; x: number; y: number; start: ClipRect; other: ClipRect } | null>(null);
  if (!id || !clip || presenting) return null;
  const index = shotIndexAt(clip, time);
  const shot = clip.shots[index];
  const linked = same(shot.from, shot.to);
  const px = 1 / scale;

  const begin = (which: "from" | "to", mode: "move" | "resize") => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const both = linked && mode === "move";
    drag.current = {
      which: both ? "both" : which, mode, x: e.clientX, y: e.clientY,
      start: { ...shot[which] }, other: { ...shot[which === "from" ? "to" : "from"] },
    };
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) * px, dy = (e.clientY - d.y) * px;
    let r: ClipRect;
    if (d.mode === "move") r = { ...d.start, x: d.start.x + dx, y: d.start.y + dy };
    else {
      const w = Math.max(80, d.start.w + dx);
      r = { ...d.start, w, h: w / CLIP_ASPECT };
    }
    const cur = readClip(openClipRaw(useBoard.getState()));
    if (!cur) return;
    const idx = shotIndexAt(cur, useClipPlayer.getState().time);
    const patch = d.which === "both" ? { from: r, to: r } : { [d.which]: r };
    useBoard.getState().patchClip(id, patchShot(cur, idx, patch), { tag: "clip-framing" });
  };
  const end = (e: ReactPointerEvent) => {
    drag.current = null;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
  };

  const frame = (which: "from" | "to", r: ClipRect, label: string, dashed: boolean) => (
    <div
      key={which}
      className="pointer-events-none absolute"
      style={{
        left: r.x, top: r.y, width: r.w, height: r.h,
        border: `${2 * px}px ${dashed ? "dashed" : "solid"} #a78bfa`,
        boxShadow: dashed ? undefined : `0 0 0 ${9999}px rgba(0,0,0,0.12)`,
        borderRadius: 4 * px,
      }}
    >
      <div
        className="pointer-events-auto absolute left-0 flex cursor-move select-none items-center rounded bg-[#a78bfa] font-medium text-white shadow"
        style={{ top: -22 * px, fontSize: 11 * px, padding: `${2 * px}px ${6 * px}px`, gap: 4 * px }}
        onPointerDown={begin(which, "move")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {label}
      </div>
      <div
        className="pointer-events-auto absolute cursor-nwse-resize rounded-sm bg-[#a78bfa]"
        style={{ right: -6 * px, bottom: -6 * px, width: 12 * px, height: 12 * px }}
        onPointerDown={begin(which, "resize")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
    </div>
  );

  const cam = playing && !follow ? cameraAt(clip, time) : null;
  const name = shot.label || t("clip.shotN", { n: index + 1 });
  return (
    <div className="pointer-events-none absolute left-0 top-0" style={{ zIndex: 2 }}>
      {linked
        ? frame("to", shot.to, name, false)
        : [frame("from", shot.from, `${name} · ${t("clip.framingStart")}`, true), frame("to", shot.to, `${name} · ${t("clip.framingEnd")}`, false)]}
      {cam && (
        <div
          className="absolute"
          style={{ left: cam.x, top: cam.y, width: cam.w, height: cam.h, border: `${2 * px}px solid white`, boxShadow: `0 0 0 ${px}px rgba(0,0,0,0.6)` }}
        />
      )}
    </div>
  );
}

// ── Screen frame ────────────────────────────────────────────────────────────

// The 16:9 frame the camera fills, letterboxed in the board viewport.
function useScreenFrame() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const w = Math.min(size.w, size.h * CLIP_ASPECT);
  const h = w / CLIP_ASPECT;
  return { ref, size, frame: { x: (size.w - w) / 2, y: (size.h - h) / 2, w, h } };
}

export function ClipLetterbox() {
  const presenting = useClipPlayer((s) => s.presenting);
  if (!presenting) return null;
  return <Letterbox />;
}

function Letterbox() {
  const { t } = useTranslation("reference");
  const { ref, size, frame } = useScreenFrame();
  const bar = "absolute bg-black";
  // The pointer wakes a thin progress bar and the cursor; both go away after a moment of rest.
  const [awake, setAwake] = useState(false);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wake = () => {
    setAwake(true);
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => setAwake(false), 2200);
  };
  useEffect(() => () => { if (idle.current) clearTimeout(idle.current); }, []);
  return (
    // Shields the board: in Present nothing is selectable, dragged or zoomed.
    <div
      ref={ref}
      className={cn("absolute inset-0 z-50", !awake && "cursor-none")}
      onPointerMove={wake}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <PresentProgress frame={frame} visible={awake} />
      <div className={bar} style={{ left: 0, top: 0, width: size.w, height: frame.y }} />
      <div className={bar} style={{ left: 0, top: frame.y + frame.h, width: size.w, height: Math.max(0, size.h - frame.y - frame.h) }} />
      <div className={bar} style={{ left: 0, top: frame.y, width: frame.x, height: frame.h }} />
      <div className={bar} style={{ left: frame.x + frame.w, top: frame.y, width: Math.max(0, size.w - frame.x - frame.w), height: frame.h }} />
      <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white/80 animate-out fade-out fill-mode-forwards delay-[2500ms] duration-700">
        {t("clip.presentHint")}
      </div>
    </div>
  );
}

// Progress along the Animatic, at the bottom of the frame: shot boundaries as ticks, a click goes
// there. It sits over the picture only while the pointer moves.
function PresentProgress({ frame, visible }: { frame: { x: number; y: number; w: number; h: number }; visible: boolean }) {
  const { clip } = useOpenClip();
  const time = useClipPlayer((s) => s.time);
  if (!clip || !frame.w) return null;
  const dur = clipDuration(clip);
  return (
    <div
      className={cn("absolute h-6 cursor-pointer transition-opacity duration-300", visible ? "opacity-100" : "pointer-events-none opacity-0")}
      style={{ left: frame.x + 16, width: frame.w - 32, top: frame.y + frame.h - 28 }}
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        seek(((e.clientX - r.left) / r.width) * dur);
      }}
    >
      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/25">
        <div className="h-full bg-white" style={{ width: `${(time / dur) * 100}%` }} />
      </div>
      {clip.shots.slice(1).map((s) => (
        <span key={s.id} className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-white/60" style={{ left: `${(s.start / dur) * 100}%` }} />
      ))}
    </div>
  );
}

// ── Pinned Long items ───────────────────────────────────────────────────────

const CORNER_POS: Record<PinCorner, (f: { x: number; y: number; w: number; h: number }, w: number, h: number, m: number) => { left: number; top: number }> = {
  tl: (f, _w, _h, m) => ({ left: f.x + m, top: f.y + m }),
  tr: (f, w, _h, m) => ({ left: f.x + f.w - w - m, top: f.y + m }),
  bl: (f, _w, h, m) => ({ left: f.x + m, top: f.y + f.h - h - m }),
  br: (f, w, h, m) => ({ left: f.x + f.w - w - m, top: f.y + f.h - h - m }),
};

export function PinnedLongItems() {
  const drives = useClipPlayer((s) => s.presenting || s.follow);
  const pinned = useClipPlayer((s) => s.pinned);
  if (!drives || !pinned.size) return null;
  return <Pinned />;
}

function Pinned() {
  const { clip } = useOpenClip();
  const present = useClipPlayer((s) => s.present);
  const items = useBoard((s) => s.items);
  const { ref, frame } = useScreenFrame();
  const byId = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);
  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-[45]">
      {clip?.long.filter((l) => l.pin && present.has(l.id)).map((l) => {
        const it = byId.get(l.id);
        if (!it || !frame.w) return null;
        const w = frame.w * Math.min(0.9, Math.max(0.05, l.pin!.size));
        const h = it.w > 0 ? (w * it.h) / it.w : w;
        const pos = CORNER_POS[l.pin!.corner](frame, w, h, frame.w * 0.025);
        return (
          <div key={l.id} className="absolute overflow-hidden rounded-md shadow-lg animate-in fade-in duration-300" style={{ ...pos, width: w, height: h, opacity: it.opacity ?? 1 }}>
            <PinnedContent item={it} />
          </div>
        );
      })}
    </div>
  );
}

function PinnedContent({ item }: { item: BoardItem }) {
  if (item.kind === "image" && item.src) return <img src={item.src} alt="" className="h-full w-full object-cover" draggable={false} />;
  if (item.kind === "video" && item.src) return <video src={item.src} muted loop autoPlay playsInline className="h-full w-full object-cover" />;
  if (item.kind === "palette" && item.colors?.length) {
    return (
      <div className="flex h-full w-full">
        {item.colors.map((c, i) => <span key={i} className="h-full flex-1" style={{ background: c }} />)}
      </div>
    );
  }
  if (item.kind === "text") {
    return (
      <div className="h-full w-full overflow-hidden p-2" style={{ background: item.bg && item.bg !== "transparent" ? item.bg : "rgba(0,0,0,0.55)", color: item.color ?? "#fff", fontFamily: item.fontFamily }}>
        {item.text}
      </div>
    );
  }
  return <div className="h-full w-full bg-black/40" />;
}

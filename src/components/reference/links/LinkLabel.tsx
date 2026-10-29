// Text on a link: a pill centred on the path midpoint, always horizontal, constant on screen at
// any zoom (scaled by `k`), wrapped to two lines then cut with an ellipsis. Its font, size, colours,
// bold and italic come from the link's label style (see parseLabelStyle). The path is masked under
// it by LinkLayer from the same layout, so the gap matches the pill. Double-click edits inline.

import { memo, useMemo, useRef } from "react";
import { Input } from "@/components/ui/input";
import { useBoard } from "../useReferenceBoard";
import {
  LABEL_MAX_CHARS, LABEL_PAD_X, LABEL_PAD_Y, labelFontPx, labelLayout, labelMaxWidth, parseLabelStyle,
  type LabelLayout, type LabelStyle, type Pt,
} from "./model";
import { useLinkUi } from "./linkUi";
import { drawShapesOf } from "./useLinkScene";

const WEIGHT_NORMAL = 500;
const WEIGHT_BOLD = 700;
const MEASURE_CACHE_MAX = 2000;
const LAYOUT_CACHE_MAX = 500;
const FALLBACK_CHAR_RATIO = 0.56;

let ctx: CanvasRenderingContext2D | null | undefined;
let bodyFont: string | null = null;
const widths = new Map<string, number>();

function fontSpec(style: LabelStyle): string {
  bodyFont ??= getComputedStyle(document.body).fontFamily || "sans-serif";
  const weight = style.bold ? WEIGHT_BOLD : WEIGHT_NORMAL;
  return `${style.italic ? "italic " : ""}${weight} ${labelFontPx(style)}px ${style.font || bodyFont}`;
}

// Width of a string in a font (canvas measure, memoised).
function measureIn(font: string, s: string, px: number): number {
  const key = `${font}\n${s}`;
  const hit = widths.get(key);
  if (hit !== undefined) return hit;
  if (ctx === undefined) ctx = document.createElement("canvas").getContext("2d");
  if (ctx) ctx.font = font;
  const w = ctx ? ctx.measureText(s).width : s.length * px * FALLBACK_CHAR_RATIO;
  if (widths.size > MEASURE_CACHE_MAX) widths.clear();
  widths.set(key, w);
  return w;
}

const layouts = new Map<string, LabelLayout>();
export function layoutOf(text: string, style: LabelStyle = {}): LabelLayout {
  const font = fontSpec(style);
  const key = `${font}\n${text}`;
  let l = layouts.get(key);
  if (!l) {
    const px = labelFontPx(style);
    l = labelLayout(text, (s) => measureIn(font, s, px), labelMaxWidth(px), px);
    if (layouts.size > LAYOUT_CACHE_MAX) layouts.clear();
    layouts.set(key, l);
  }
  return l;
}

// Size of the inline editor, in screen px (the mask uses it while editing).
export const EDITOR_BOX = { w: 180, h: 28 };

function commitLabel(shapeId: string, initial: string, value: string) {
  const text = value.trim().slice(0, LABEL_MAX_CHARS);
  if (text === initial) return;
  const st = useBoard.getState();
  const shapes = drawShapesOf(st.items);
  st.drawSetShapes(shapes.map((s) => (s.id === shapeId ? { ...s, text: text || undefined } : s)), true, `link-label:${shapeId}`);
}

function LabelEditor({ shapeId, initial, placeholder }: { shapeId: string; initial: string; placeholder: string }) {
  const cancelled = useRef(false);
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    useLinkUi.getState().stopEdit();
    // An emptied label removes it.
    if (value !== null) commitLabel(shapeId, initial, value);
  };
  return (
    <Input
      autoFocus
      defaultValue={initial}
      placeholder={placeholder}
      maxLength={LABEL_MAX_CHARS}
      onFocus={(e) => e.currentTarget.select()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); finish(e.currentTarget.value); }
        else if (e.key === "Escape") { e.preventDefault(); cancelled.current = true; finish(null); }
      }}
      onBlur={(e) => finish(cancelled.current ? null : e.currentTarget.value)}
      className="pointer-events-auto h-7 rounded-full bg-card px-3 text-xs md:text-xs"
      style={{ width: EDITOR_BOX.w }}
    />
  );
}

export const LinkLabel = memo(function LinkLabel({ shapeId, text, fill, at, k, editing, state, placeholder }: {
  shapeId: string;
  text: string;
  fill: string | undefined;    // the link's label style, as stored
  at: Pt;
  k: number;
  editing: boolean;
  state: "lit" | "dim" | "";
  placeholder: string;
}) {
  const style = useMemo(() => parseLabelStyle(fill), [fill]);
  const layout = text ? layoutOf(text, style) : null;
  const px = labelFontPx(style);
  const bare = style.bg === "transparent";
  return (
    <div
      className="absolute"
      style={{ left: at.x, top: at.y, transform: `translate(-50%, -50%) scale(${k})`, transformOrigin: "center" }}
    >
      {editing ? (
        <LabelEditor shapeId={shapeId} initial={text} placeholder={placeholder} />
      ) : layout ? (
        <button
          type="button"
          data-link-label={shapeId}
          data-draw-shape={shapeId}
          data-state={state || undefined}
          className="nb-link-label pointer-events-auto block cursor-pointer rounded-full border border-border bg-card p-0 text-center text-card-foreground"
          style={{
            width: layout.w,
            height: layout.h,
            maxWidth: labelMaxWidth(px),
            padding: `${LABEL_PAD_Y}px ${LABEL_PAD_X}px`,
            fontSize: px,
            lineHeight: `${layout.lineH}px`,
            fontFamily: style.font || undefined,
            fontWeight: style.bold ? WEIGHT_BOLD : WEIGHT_NORMAL,
            fontStyle: style.italic ? "italic" : undefined,
            color: style.color || undefined,
            background: style.bg || undefined,
            borderColor: bare ? "transparent" : undefined,
            borderRadius: layout.lines.length > 1 ? 10 : 999,
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            const st = useBoard.getState();
            if (e.shiftKey) {
              const held = st.drawSel;
              st.selectDrawShapes(held.includes(shapeId) ? held.filter((x) => x !== shapeId) : [...held, shapeId]);
            } else st.selectDrawShape(shapeId);
          }}
          onDoubleClick={(e) => { e.stopPropagation(); useLinkUi.getState().startEdit(shapeId); }}
        >
          {layout.lines.map((line, i) => (
            <span key={i} className="block overflow-hidden whitespace-nowrap">{line}</span>
          ))}
        </button>
      ) : null}
    </div>
  );
});

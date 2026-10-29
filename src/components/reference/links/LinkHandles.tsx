// Grab points of the links layer. Visual calm first: tiny low-contrast dots that only turn into
// a clear primary target under the pointer. Each button is a larger transparent hit area around a
// small dot, so grabbing stays easy while the board stays quiet. Sizes are screen pixels scaled by
// `k` (chromePx), and the layer fades them in with a CSS animation (see LINK_CSS in LinkLayer).

import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { BoardItem } from "../referenceShared";
import { SIDES, sideDirection, sidePoint, type LinkEnd, type Pt, type Side } from "./model";
import { HANDLE_GAP_PX, type LinkGestureSpec, type LinkTarget } from "./useLinkGesture";

const HIT_PX = 18;

function Dot({ x, y, k, label, onDown, variant, onHover, ref }: {
  x: number; y: number; k: number; label: string;
  onDown: (e: React.PointerEvent) => void;
  variant: "connect" | "end";
  onHover?: (inside: boolean) => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      data-link-handle
      aria-label={label}
      onPointerDown={onDown}
      onPointerEnter={onHover && (() => onHover(true))}
      onPointerLeave={onHover && (() => onHover(false))}
      className="nb-link-handle pointer-events-auto absolute flex touch-none cursor-crosshair items-center justify-center rounded-full border-0 bg-transparent p-0"
      style={{ left: x, top: y, width: HIT_PX, height: HIT_PX, transform: `translate(-50%, -50%) scale(${k})` }}
    >
      <span className={variant === "end" ? "nb-link-dot nb-link-dot-end" : "nb-link-dot"} />
    </button>
  );
}

// The four side handles of ONE item.
export function ConnectHandles({ item, k, onStart }: {
  item: BoardItem; k: number;
  onStart: (e: React.PointerEvent, spec: LinkGestureSpec) => void;
}) {
  const { t } = useTranslation("reference");
  return (
    <>
      {SIDES.map((side) => {
        const p = sidePoint(item, side);
        const d = sideDirection(item, side);
        const off = HANDLE_GAP_PX * k;
        return (
          <Dot
            key={side}
            x={p.x + d.dx * off}
            y={p.y + d.dy * off}
            k={k}
            label={t("links.connect")}
            variant="connect"
            onDown={(e) => onStart(e, { kind: "connect", fromId: item.id })}
          />
        );
      })}
    </>
  );
}

// The two end handles of the selected link: drag one onto another item (or side) or onto another
// link (a junction) to re-attach it, or Alt-drag it to leave the link in place and draw a copy.
export function EndHandles({ linkId, e0, e1, k, onStart }: {
  linkId: string; e0: LinkEnd; e1: LinkEnd; k: number;
  onStart: (e: React.PointerEvent, spec: LinkGestureSpec) => void;
}) {
  const { t } = useTranslation("reference");
  return (
    <>
      {([[e0, 1], [e1, 2]] as const).map(([e, end]) => (
        <Dot
          key={end}
          x={e.x}
          y={e.y}
          k={k}
          label={t("links.reattach")}
          variant="end"
          onDown={(ev) => onStart(ev, { kind: ev.altKey ? "fork" : "reattach", linkId, end })}
        />
      ))}
    </>
  );
}

// Grab dot of a hovered or selected link. It follows the pointer along the link (LinkLayer moves it
// imperatively through `dotRef`); dragging it out branches the wire there: a new link leaving this
// one at that point (a junction), same style.
export function BranchDot({ linkId, at, k, onStart, onHover, dotRef, getT }: {
  linkId: string; at: Pt; k: number;
  onStart: (e: React.PointerEvent, spec: LinkGestureSpec) => void;
  onHover: (inside: boolean) => void;
  dotRef: Ref<HTMLButtonElement>;
  getT: () => number;
}) {
  const { t } = useTranslation("reference");
  return (
    <Dot
      ref={dotRef}
      x={at.x}
      y={at.y}
      k={k}
      label={t("links.branch")}
      variant="connect"
      onHover={onHover}
      onDown={(e) => onStart(e, { kind: "branch", linkId, t: getT() })}
    />
  );
}

// Badge of an item with outgoing links: hides or shows everything downstream of it (view only).
// Shown on the item under the pointer, and always on a collapsed one so it can be expanded again.
export function CollapseBadge({ item, k, count, collapsed, onToggle }: {
  item: BoardItem; k: number; count: number; collapsed: boolean; onToggle: () => void;
}) {
  const { t } = useTranslation("reference");
  const label = t(collapsed ? "links.expandCount" : "links.collapseCount", { count });
  // Bottom-right corner, just outside, rotated with the item.
  const c = { x: item.x + item.w / 2, y: item.y + item.h / 2 };
  const r = ((item.rotation || 0) * Math.PI) / 180;
  const ox = item.w / 2 + 4 * k, oy = item.h / 2 + 4 * k;
  const x = c.x + ox * Math.cos(r) - oy * Math.sin(r), y = c.y + ox * Math.sin(r) + oy * Math.cos(r);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-link-handle
            aria-label={label}
            aria-pressed={collapsed}
            onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className="nb-link-badge nb-link-handle pointer-events-auto absolute flex h-4 min-w-4 items-center justify-center rounded-full border border-border bg-popover px-1 text-[10px] leading-none tabular-nums text-muted-foreground shadow-sm hover:text-foreground aria-pressed:border-primary/60 aria-pressed:text-foreground"
            style={{ left: x, top: y, transform: `translate(-50%, -50%) scale(${k})` }}
          />
        }
      >
        {collapsed ? t("links.badgeHidden", { count }) : t("links.badgeShown")}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// Target under a dragged end: a hairline outline and its four side points, the pinned one lit.
export function TargetHint({ item, target, k }: { item: BoardItem; target: Extract<LinkTarget, { kind: "item" }>; k: number }) {
  return (
    <>
      <div
        className="pointer-events-none absolute"
        style={{
          left: item.x, top: item.y, width: item.w, height: item.h,
          transform: `rotate(${item.rotation || 0}deg)`,
          borderRadius: 6 * k,
          boxShadow: `0 0 0 ${1.5 * k}px color-mix(in srgb, var(--color-primary) 70%, transparent)`,
        }}
      />
      {SIDES.map((side: Side) => {
        const p = sidePoint(item, side);
        const lit = target.side === side;
        return (
          <span
            key={side}
            className="pointer-events-none absolute rounded-full"
            style={{
              left: p.x, top: p.y, width: lit ? 10 : 6, height: lit ? 10 : 6,
              transform: `translate(-50%, -50%) scale(${k})`,
              background: lit ? "var(--color-primary)" : "color-mix(in srgb, var(--color-primary) 45%, transparent)",
            }}
          />
        );
      })}
    </>
  );
}

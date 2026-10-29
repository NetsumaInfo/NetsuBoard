// Compact floating toolbar of the selected link(s): route, heads, line, width, colour, label style,
// label, reverse, delete. With several links selected (Shift+click) every change applies to all of
// them; the first one shows the current values. Neutral icons, one tooltip each, screen-constant
// (scaled by `k` inside the panned layer); the choices of a group open in a small popover.

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import type { DrawShape, RouteStyle } from "../referenceShared";
import { HEADS_MODES, LINK_ROUTES, dashPatch, headsOf, headsPatch, linkDashed, linkRoute, type HeadsMode } from "./model";
import { LineIcon, OptionMenu, ToolButton } from "./linkToolbarParts";
import { LinkColorButton, LinkLabelStyleButton, LinkWidthButton } from "./LinkStyleControls";

const ROUTE_ICON: Record<RouteStyle, ReactNode> = {
  curved: <NetsuIcon name="route-curved" />, straight: <NetsuIcon name="route-straight" />, elbow: <NetsuIcon name="route-elbow" />,
};
const HEADS_ICON: Record<HeadsMode, ReactNode> = {
  none: <NetsuIcon name="arrowhead-none" />, end: <NetsuIcon name="arrowhead-end" />, both: <NetsuIcon name="arrowhead-both" />,
};

export function LinkEditorMenu({ shapes, readOnly, onPatch, onReverse, onDelete, onEditLabel }: {
  shapes: DrawShape[];
  readOnly: boolean;
  onPatch: (patch: Partial<DrawShape>) => void;
  onReverse: () => void;
  onDelete: () => void;
  onEditLabel: (() => void) | null;
}) {
  const { t } = useTranslation("reference");
  const shape = shapes[0];
  if (readOnly || !shape) return null;
  const route = linkRoute(shape);
  const heads = headsOf(shape);
  const dashed = linkDashed(shape);
  return (
    <div
      className="nb-link-menu pointer-events-auto flex items-center gap-0.5 rounded-lg border border-border bg-popover/95 p-0.5 text-popover-foreground shadow-sm"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {shapes.length > 1 && (
        <span className="px-1 text-[11px] tabular-nums text-muted-foreground">{t("links.selectedCount", { count: shapes.length })}</span>
      )}
      <OptionMenu<RouteStyle>
        label={t("links.route")}
        trigger={ROUTE_ICON[route]}
        value={route}
        options={LINK_ROUTES.map((r) => ({ value: r, label: t(`links.routes.${r}`), icon: ROUTE_ICON[r] }))}
        onPick={(r) => onPatch({ route: r, cp: undefined })}
      />
      <OptionMenu<HeadsMode>
        label={t("links.arrowheads")}
        trigger={HEADS_ICON[heads]}
        value={heads}
        options={HEADS_MODES.map((m) => ({ value: m, label: t(`links.heads.${m}`), icon: HEADS_ICON[m] }))}
        onPick={(m) => onPatch(headsPatch(m))}
      />
      <ToolButton label={t(dashed ? "links.dashes.dashed" : "links.dashes.solid")} pressed={dashed} onClick={() => onPatch(dashPatch(!dashed))}>
        <LineIcon dashed={dashed} />
      </ToolButton>
      <LinkWidthButton shape={shape} onPatch={onPatch} />
      <LinkColorButton shape={shape} onPatch={onPatch} />
      <LinkLabelStyleButton shape={shape} onPatch={onPatch} icon={<NetsuIcon name="label-style" />} />
      <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
      {onEditLabel && <ToolButton label={t("links.editLabel")} onClick={onEditLabel}><NetsuIcon name="edit-label" /></ToolButton>}
      <ToolButton label={t("links.reverse")} onClick={onReverse}><NetsuIcon name="reverse-edge" /></ToolButton>
      <ToolButton label={t("common:action.delete")} onClick={onDelete} className="hover:text-destructive"><NetsuIcon name="delete" /></ToolButton>
    </div>
  );
}

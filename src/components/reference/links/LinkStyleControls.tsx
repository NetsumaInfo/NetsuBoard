// Style panels of the link toolbar: colour (palette, recent colours, custom colour, opacity),
// width (presets and a custom value) and label style (font, size, colours, bold, italic). Each panel
// edits the reference link and hands the patch up; LinkEditorMenu applies it to every selected link.

import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import { NumberSpin } from "@/components/ui/number-spin";
import type { DrawShape } from "../referenceShared";
import { useBoard } from "../useReferenceBoard";
import { FontPicker } from "../inspectorControls";
import {
  LABEL_SIZES, LABEL_SIZE_MAX, LABEL_SIZE_MIN, LINK_PALETTE, LINK_WIDTH_MAX, LINK_WIDTH_MIN, LINK_WIDTH_PX, WIDTH_LEVELS,
  formatLabelStyle, labelFontPx, linkWidthPx, parseLabelStyle, widthPreset, type LabelStyle,
} from "./model";
import { rememberLinkColor } from "./linkActions";
import { LineIcon, PopoverButton, ToolButton } from "./linkToolbarParts";

type Patch = (patch: Partial<DrawShape>) => void;

const PERCENT = 100;
const LABEL_SIZE_KEYS = Object.keys(LABEL_SIZES) as (keyof typeof LABEL_SIZES)[];

function Swatch({ color, label, pressed, onPick }: { color: string; label: string; pressed: boolean; onPick: () => void }) {
  return (
    <Button variant="ghost" size="icon-xs" aria-label={label} aria-pressed={pressed} onClick={onPick} className="aria-pressed:bg-muted">
      <span className="size-3.5 rounded-full ring-1 ring-foreground/15" style={{ background: color }} />
    </Button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}

export function LinkColorButton({ shape, onPatch }: { shape: DrawShape; onPatch: Patch }) {
  const { t } = useTranslation("reference");
  const recent = useBoard((s) => s.prefs.linkRecentColors);
  const opened = useRef(shape.c);
  const same = (c: string) => c.toLowerCase() === shape.c.toLowerCase();
  const opacity = Math.round((shape.op ?? 1) * PERCENT);
  return (
    <PopoverButton
      label={t("links.color")}
      trigger={<span className="size-3 rounded-full ring-1 ring-foreground/15" style={{ background: shape.c, opacity: shape.op ?? 1 }} />}
      className="flex w-48 flex-col gap-1.5 p-1.5"
      onOpenChange={(open) => {
        // A colour only becomes "recent" once the panel closes, not at every step of a drag.
        if (open) opened.current = shape.c;
        else if (shape.c !== opened.current) rememberLinkColor(shape.c);
      }}
    >
      <div className="grid grid-cols-6 gap-0.5">
        {LINK_PALETTE.map((c) => <Swatch key={c} color={c} label={c} pressed={same(c)} onPick={() => onPatch({ c })} />)}
      </div>
      {recent.length > 0 && (
        <>
          <span className="px-1 text-[11px] text-muted-foreground">{t("links.recent")}</span>
          <div className="grid grid-cols-6 gap-0.5">
            {recent.map((c) => <Swatch key={c} color={c} label={c} pressed={same(c)} onPick={() => onPatch({ c })} />)}
          </div>
        </>
      )}
      <Row label={t("links.customColor")}>
        <ColorPicker value={shape.c} onChange={(c) => onPatch({ c })} ariaLabel={t("links.customColor")} presets={[...LINK_PALETTE]} />
      </Row>
      <Row label={t("links.opacity")}>
        <NumberSpin
          value={opacity}
          min={10}
          max={PERCENT}
          step={5}
          ariaLabel={t("links.opacity")}
          onCommit={(v) => onPatch({ op: v >= PERCENT ? undefined : v / PERCENT })}
        />
      </Row>
    </PopoverButton>
  );
}

export function LinkWidthButton({ shape, onPatch }: { shape: DrawShape; onPatch: Patch }) {
  const { t } = useTranslation("reference");
  const width = linkWidthPx(shape.w);
  const preset = widthPreset(shape.w);
  return (
    <PopoverButton label={t("links.widthLabel")} trigger={<LineIcon width={width} />} className="flex flex-col gap-1 p-1">
      <div className="flex gap-0.5">
        {WIDTH_LEVELS.map((l) => (
          <ToolButton key={l} label={t(`links.widths.${l}`)} pressed={preset === l} onClick={() => onPatch({ w: LINK_WIDTH_PX[l] })}>
            <LineIcon width={LINK_WIDTH_PX[l]} />
          </ToolButton>
        ))}
      </div>
      <Row label={t("links.custom")}>
        <NumberSpin
          value={width}
          min={LINK_WIDTH_MIN}
          max={LINK_WIDTH_MAX}
          step={0.5}
          ariaLabel={t("links.widthLabel")}
          onCommit={(w) => onPatch({ w })}
        />
      </Row>
    </PopoverButton>
  );
}

// Size presets drawn as a letter at the preset size: no hard-coded copy, the tooltip names it.
function SizePresets({ value, onPick }: { value: number; onPick: (size: number) => void }) {
  const { t } = useTranslation("reference");
  return (
    <>
      {LABEL_SIZE_KEYS.map((key) => (
        <ToolButton key={key} label={t(`links.sizes.${key}`)} pressed={value === LABEL_SIZES[key]} onClick={() => onPick(LABEL_SIZES[key])}>
          <span aria-hidden className="font-semibold leading-none" style={{ fontSize: LABEL_SIZES[key] }}>{t("links.sizeGlyph")}</span>
        </ToolButton>
      ))}
    </>
  );
}

export function LinkLabelStyleButton({ shape, onPatch, icon }: { shape: DrawShape; onPatch: Patch; icon: React.ReactNode }) {
  const { t } = useTranslation("reference");
  const style = parseLabelStyle(shape.fill);
  const size = labelFontPx(style);
  const set = (next: Partial<LabelStyle>) => onPatch({ fill: formatLabelStyle({ ...style, ...next }) });
  return (
    <PopoverButton label={t("links.labelStyle")} trigger={icon} className="flex w-56 flex-col gap-1.5 p-1.5">
      <Row label={t("links.font")}>
        <FontPicker value={style.font ?? ""} onChange={(font) => set({ font: font || undefined })} />
      </Row>
      <Row label={t("links.size")}>
        <SizePresets value={size} onPick={(s) => set({ size: s })} />
        <NumberSpin value={size} min={LABEL_SIZE_MIN} max={LABEL_SIZE_MAX} step={1} ariaLabel={t("links.size")} onCommit={(s) => set({ size: s })} />
      </Row>
      <Row label={t("links.textColor")}>
        <ColorPicker value={style.color ?? ""} onChange={(color) => set({ color })} ariaLabel={t("links.textColor")} presets={[...LINK_PALETTE]} />
      </Row>
      <Row label={t("links.background")}>
        <ColorPicker value={style.bg ?? ""} onChange={(bg) => set({ bg })} ariaLabel={t("links.background")} allowTransparent presets={[...LINK_PALETTE]} />
      </Row>
      <div className="flex gap-0.5 px-1">
        <ToolButton label={t("links.bold")} pressed={!!style.bold} onClick={() => set({ bold: !style.bold || undefined })}><NetsuIcon name="bold" on={!!style.bold} /></ToolButton>
        <ToolButton label={t("links.italic")} pressed={!!style.italic} onClick={() => set({ italic: !style.italic || undefined })}><NetsuIcon name="italic" on={!!style.italic} /></ToolButton>
        <Button variant="ghost" size="xs" className="ml-auto text-muted-foreground" onClick={() => onPatch({ fill: undefined })}>
          {t("links.resetStyle")}
        </Button>
      </div>
    </PopoverButton>
  );
}

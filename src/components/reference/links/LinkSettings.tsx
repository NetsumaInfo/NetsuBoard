// Settings > Links: how new links look (route, arrowheads, line, colour, width, label font and
// size), the focus on the links of the selected item, and moving an item with its downstream
// subtree. A link keeps its own style once drawn.

import type { ComponentType, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ColorPicker } from "@/components/ui/color-picker";
import { NumberSpin } from "@/components/ui/number-spin";
import type { RouteStyle } from "../referenceShared";
import { useBoard } from "../useReferenceBoard";
import { FontPicker } from "../inspectorControls";
import {
  HEADS_MODES, LABEL_SIZES, LABEL_SIZE_MAX, LABEL_SIZE_MIN, LINK_PALETTE, LINK_ROUTES, LINK_WIDTH_MAX, LINK_WIDTH_MIN,
  LINK_WIDTH_PX, WIDTH_LEVELS,
} from "./model";

type SegProps = { active: boolean; onClick: () => void; children: ReactNode };

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

// `Seg` is the segmented button of the settings page, handed in so both look the same.
export function LinkSettings({ Seg }: { Seg: ComponentType<SegProps> }) {
  const { t } = useTranslation("reference");
  const prefs = useBoard((s) => s.prefs);
  const setPrefs = useBoard((s) => s.setPrefs);
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold text-foreground">{t("settings.linksTitle")}</h3>
      <p className="text-[11px] text-muted-foreground">{t("settings.linksHint")}</p>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-foreground">{t("settings.linkFocus")}</span>
        <Seg active={prefs.linkFocus} onClick={() => setPrefs({ linkFocus: !prefs.linkFocus })}>
          {prefs.linkFocus ? t("settings.enabled") : t("settings.disabled")}
        </Seg>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-foreground">{t("settings.linkMoveSubtree")}</span>
        <Seg active={prefs.linkMoveSubtree} onClick={() => setPrefs({ linkMoveSubtree: !prefs.linkMoveSubtree })}>
          {prefs.linkMoveSubtree ? t("settings.enabled") : t("settings.disabled")}
        </Seg>
      </div>
      <Line label={t("links.route")}>
        {LINK_ROUTES.map((r: RouteStyle) => (
          <Seg key={r} active={prefs.linkRoute === r} onClick={() => setPrefs({ linkRoute: r })}>{t(`links.routes.${r}`)}</Seg>
        ))}
      </Line>
      <Line label={t("links.arrowheads")}>
        {HEADS_MODES.map((m) => (
          <Seg key={m} active={prefs.linkHeads === m} onClick={() => setPrefs({ linkHeads: m })}>{t(`links.heads.${m}`)}</Seg>
        ))}
      </Line>
      <Line label={t("links.dash")}>
        <Seg active={!prefs.linkDashed} onClick={() => setPrefs({ linkDashed: false })}>{t("links.dashes.solid")}</Seg>
        <Seg active={prefs.linkDashed} onClick={() => setPrefs({ linkDashed: true })}>{t("links.dashes.dashed")}</Seg>
      </Line>
      <Line label={t("links.widthLabel")}>
        {WIDTH_LEVELS.map((l) => (
          <Seg key={l} active={prefs.linkWidth === LINK_WIDTH_PX[l]} onClick={() => setPrefs({ linkWidth: LINK_WIDTH_PX[l] })}>{t(`links.widths.${l}`)}</Seg>
        ))}
        <NumberSpin value={prefs.linkWidth} min={LINK_WIDTH_MIN} max={LINK_WIDTH_MAX} step={0.5} ariaLabel={t("links.widthLabel")} onCommit={(linkWidth) => setPrefs({ linkWidth })} />
      </Line>
      <Line label={t("links.color")}>
        <ColorPicker value={prefs.linkColor} onChange={(linkColor) => setPrefs({ linkColor })} ariaLabel={t("links.color")} presets={[...LINK_PALETTE]} />
      </Line>
      <Line label={t("links.labelFont")}>
        <FontPicker value={prefs.linkLabelFont} onChange={(linkLabelFont) => setPrefs({ linkLabelFont })} />
        <Seg active={!prefs.linkLabelFont} onClick={() => setPrefs({ linkLabelFont: "" })}>{t("links.interfaceFont")}</Seg>
      </Line>
      <Line label={t("links.labelSize")}>
        {(Object.keys(LABEL_SIZES) as (keyof typeof LABEL_SIZES)[]).map((key) => (
          <Seg key={key} active={prefs.linkLabelSize === LABEL_SIZES[key]} onClick={() => setPrefs({ linkLabelSize: LABEL_SIZES[key] })}>
            {t(`links.sizes.${key}`)}
          </Seg>
        ))}
        <NumberSpin value={prefs.linkLabelSize} min={LABEL_SIZE_MIN} max={LABEL_SIZE_MAX} step={1} ariaLabel={t("links.labelSize")} onCommit={(linkLabelSize) => setPrefs({ linkLabelSize })} />
      </Line>
    </section>
  );
}

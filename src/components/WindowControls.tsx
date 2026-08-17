// Boutons système de la fenêtre frameless (réduire / agrandir-restaurer / fermer). La fenêtre est
// `decorations: false` : on redessine donc les contrôles. `data-no-drag` les exclut de la région
// non-client WebView2 utilisée par la barre de titre.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Minus, Square, X, Copy, Pin } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "@/store";
import { UpdateButton } from "@/components/updates/UpdateButton";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Title bar button: full bar height, no radius, so neighbouring buttons form one continuous strip. */
export const TITLEBAR_BTN =
  "inline-flex h-9 w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&_svg]:size-3.5";

async function win() {
  const m = await import("@tauri-apps/api/window");
  return m.getCurrentWindow();
}

/**
 * `withUpdate` = porter soi-même le bouton de mise à jour. Vrai partout où les contrôles sont seuls
 * dans la barre (installation, portails de connexion) : la mise à jour doit y rester atteignable.
 * La coquille principale, elle, le pose en TÊTE de sa barre, loin du bouton Fermer.
 */
export function WindowControls({ withUpdate = true }: { withUpdate?: boolean }) {
  const { t } = useTranslation(["shell", "common"]);
  const [maxed, setMaxed] = useState(false);
  const { pinned, onTopHold, togglePinned } = useApp(useShallow((s) => ({
    pinned: s.pinned, onTopHold: s.onTopHold, togglePinned: s.togglePinned,
  })));
  // L'épingle dit ce que fait la FENÊTRE : elle s'allume aussi quand un mode la tient au-dessus.
  const onTop = pinned || onTopHold;

  useEffect(() => {
    if (!isTauri) return;
    let un: (() => void) | undefined;
    void (async () => {
      const w = await win();
      setMaxed(await w.isMaximized());
      un = await w.onResized(async () => setMaxed(await w.isMaximized()));
    })();
    return () => un?.();
  }, []);

  if (!isTauri) return null;

  const btn = TITLEBAR_BTN;
  return (
    <div className="ml-auto flex items-center" data-no-drag>
      {withUpdate && <UpdateButton variant="icon" />}
      <Tooltip>
        <TooltipTrigger render={
          <button
            type="button"
            aria-label={pinned ? t("windowControls.unpin") : t("windowControls.pinAbove")}
            aria-pressed={onTop}
            className={`${btn} ${onTop ? "text-primary hover:text-primary" : ""}`}
            onClick={togglePinned}
          >
            <Pin className={onTop ? "fill-current" : ""} />
          </button>
        } />
        <TooltipContent>
          {onTopHold && !pinned ? t("windowControls.pinnedByMode") : pinned ? t("windowControls.unpinShort") : t("windowControls.pinAbove")}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={
          <button type="button" aria-label={t("windowControls.minimize")} className={btn} onClick={() => void win().then((w) => w.minimize()).catch(() => undefined)}>
            <Minus />
          </button>
        } />
        <TooltipContent>{t("windowControls.minimize")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={
          <button type="button" aria-label={maxed ? t("windowControls.restore") : t("windowControls.maximize")} className={btn} onClick={() => void win().then((w) => w.toggleMaximize()).catch(() => undefined)}>
            {maxed ? <Copy className="-scale-x-100" /> : <Square />}
          </button>
        } />
        <TooltipContent>{maxed ? t("windowControls.restore") : t("windowControls.maximize")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={
          <button type="button" aria-label={t("common:action.close")} className={`${btn} hover:bg-destructive hover:text-primary-foreground`} onClick={() => void win().then((w) => w.close()).catch(() => undefined)}>
            <X />
          </button>
        } />
        <TooltipContent>{t("common:action.close")}</TooltipContent>
      </Tooltip>
    </div>
  );
}

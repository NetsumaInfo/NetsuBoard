// Paramètres de NetsuBoard — surface UNIQUE : réglages du board, console (terminal) et « À propos ».
// Avant, seuls les réglages du board avaient une porte ; la console et la version n'en avaient aucune
// dans une app qui n'a plus qu'une page, alors que ce sont précisément les deux choses qu'on cherche
// quand quelque chose casse.
//
// Fenêtre CENTRÉE posée sur un voile volontairement translucide : le board reste lisible derrière,
// donc la couleur et le mode de fond se voient encore changer pendant qu'on les règle. Fermeture :
// croix, Échap, ou clic sur le voile.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Info, LayoutDashboard, Palette, Terminal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { markConsoleSeen, subscribeErrorCount } from "@/lib/appConsole";
import { BoardSettings, BOARD_SETTINGS_TABS, type BoardSettingsTab } from "@/components/reference/BoardSettings";
import { ConsolePanel } from "./console/ConsolePanel";
import { InterfacePanel } from "./InterfacePanel";
import { AboutPanel } from "./AboutPanel";
import { useSettingsUi, type SettingsSection } from "./useSettingsUi";

// Board = LayoutDashboard (la surface qu'on règle), Interface = Palette (thème et langue, comme dans
// NetsuRush). La palette sur « Board » disait « couleurs » alors que la page couvre aussi les médias,
// la navigation et les raccourcis — et laissait l'apparence de l'app sans icône propre.
const SECTIONS: { id: SettingsSection; icon: typeof Palette; labelKey: string }[] = [
  { id: "board", icon: LayoutDashboard, labelKey: "reference:settings.navBoard" },
  { id: "interface", icon: Palette, labelKey: "settings:nav.interface" },
  { id: "console", icon: Terminal, labelKey: "settings:tab.system.console" },
  { id: "about", icon: Info, labelKey: "settings:nav.about" },
];

export function AppSettings() {
  const { t } = useTranslation(["reference", "settings", "common"]);
  const open = useSettingsUi((s) => s.open);
  const section = useSettingsUi((s) => s.section);
  const setSection = useSettingsUi((s) => s.setSection);
  const closeSettings = useSettingsUi((s) => s.closeSettings);
  const [boardTab, setBoardTab] = useState<BoardSettingsTab>("look");
  const [capturing, setCapturing] = useState(false);
  const [errors, setErrors] = useState(0);

  useEffect(() => subscribeErrorCount(setErrors), []);
  // Console ouverte = erreurs lues : la pastille rouge globale n'a plus rien à signaler.
  useEffect(() => { if (open && section === "console") markConsoleSeen(); }, [open, section, errors]);

  // Échap ferme (sans voler les autres raccourcis du board quand le panneau est fermé). Pendant la
  // capture d'un raccourci, Échap annule la capture (géré dans la page Board) et ne ferme PAS.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !capturing) { e.stopPropagation(); closeSettings(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, capturing, closeSettings]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      {/* Voile : ferme au clic et détache la fenêtre du fond, sans masquer le board (cf. en-tête). */}
      <button
        type="button"
        aria-label={t("common:action.close")}
        tabIndex={-1}
        onClick={closeSettings}
        className="absolute inset-0 cursor-default bg-black/45 backdrop-blur-[2px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("reference:actions.settings")}
        className="relative flex h-[min(44rem,100%)] w-[min(56rem,100%)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-sm font-semibold text-foreground">{t("reference:actions.settings")}</h2>
          <button
            type="button"
            aria-label={t("common:action.close")}
            onClick={closeSettings}
            className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Nav des sections : trois destinations, jamais plus d'un clic de distance. */}
          <nav aria-label={t("reference:actions.settings")} className="flex w-40 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-2">
            {SECTIONS.map((item) => {
              const on = item.id === section;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={on ? "page" : undefined}
                  onClick={() => setSection(item.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                    on ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/60",
                  )}
                >
                  <Icon className="size-4 shrink-0" /> {t(item.labelKey)}
                  {item.id === "console" && errors > 0 && !on && (
                    <span className="ml-auto size-1.5 shrink-0 rounded-full bg-destructive" />
                  )}
                </button>
              );
            })}
          </nav>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* Sous-onglets : propres à la page Board (les 13 sections en liste plate étaient interminables). */}
            {section === "board" && (
              <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-4 py-2">
                {BOARD_SETTINGS_TABS.map((tb) => (
                  <button
                    key={tb.id}
                    type="button"
                    aria-pressed={boardTab === tb.id}
                    onClick={() => setBoardTab(tb.id)}
                    className={cn(
                      // Bordure TOUJOURS présente (transparente si active) → la largeur ne bouge pas au clic.
                      "inline-flex items-center rounded border px-2 py-1 text-xs font-medium transition-colors",
                      boardTab === tb.id
                        ? "border-transparent bg-primary text-primary-foreground"
                        : "border-border bg-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t(`reference:${tb.labelKey}`)}
                  </button>
                ))}
              </div>
            )}

            <div className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto", section === "board" ? "p-4" : "p-5")}>
              {section === "board" && <BoardSettings tab={boardTab} onCapturingChange={setCapturing} />}
              {section === "interface" && <InterfacePanel />}
              {section === "console" && <ConsolePanel />}
              {section === "about" && <AboutPanel />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Paramètres › Interface : thème de l'application et langue. Ces deux réglages EXISTAIENT dans le
// store (`setTheme`, `setLang`) sans aucune porte dans l'interface — NetsuBoard livrait onze thèmes
// et six langues qu'on ne pouvait ni voir ni changer.
//
// Le nuancier de NetsuRush est repris tel quel, avec ses deux cartes de personnalisation : couleurs
// retouchées par thème et thèmes enregistrés. La TROISIÈME (fond d'écran) est volontairement laissée
// de côté : une image ou une vidéo derrière un board de références concurrence le contenu qu'on y
// pose, et son décodage concurrence celui des vidéos du board.

import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useApp } from "@/store";
import { THEMES, type ThemeId, type ThemeMode } from "@/store/types";
import { LANGUAGES, type LangCode } from "@/i18n";
import { FlagIcon } from "@/components/language/FlagIcon";
import { Select, SelectTrigger, SelectContent, SelectItem } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ThemeColorsCard } from "./appearance/ThemeColorsCard";
import { CustomThemesCard } from "./appearance/CustomThemesCard";

const MODES: ThemeMode[] = ["dark", "light"];

// Aperçu d'un thème : palette forcée via data-theme local pour montrer ses vraies couleurs.
function Swatch({ theme }: { theme: ThemeId }) {
  return (
    <div
      data-theme={theme}
      className="flex h-14 overflow-hidden rounded-md"
      style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}
    >
      <span className="w-3 shrink-0" style={{ background: "var(--color-primary)" }} />
      <span className="flex flex-1 flex-col gap-1.5 p-2" style={{ background: "var(--color-surface)" }}>
        <span className="h-2 w-3/5 rounded-full" style={{ background: "var(--color-fg)" }} />
        <span className="h-2 w-full rounded-full" style={{ background: "var(--color-surface-2)" }} />
        <span className="h-2 w-4/5 rounded-full" style={{ background: "var(--color-border)" }} />
      </span>
    </div>
  );
}

function ThemeCard({ id, label, hint }: { id: ThemeId; label: string; hint: string }) {
  const { t } = useTranslation("settings");
  const active = useApp((s) => s.theme === id && !s.customThemeId);
  const setTheme = useApp((s) => s.setTheme);
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => setTheme(id)}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-lg border p-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-primary bg-accent" : "border-border hover:bg-accent/60",
      )}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{t(`appearance.theme.${id}.label`, { defaultValue: label })}</span>
        {active && <Check className="size-4 shrink-0 text-primary" />}
      </div>
      <Swatch theme={id} />
      <span className="text-xs leading-snug text-muted-foreground">
        {t(`appearance.theme.${id}.hint`, { defaultValue: hint })}
      </span>
    </button>
  );
}

// Bascule À CHAUD : `setLang` recharge les ressources i18next, aucun redémarrage requis.
function LanguageRow() {
  const { t } = useTranslation("language");
  const lang = useApp((s) => s.lang);
  const setLang = useApp((s) => s.setLang);
  const active = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];

  return (
    <section>
      <h2 className="text-sm font-medium">{t("settings.title")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("settings.subtitle")}</p>
      <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-border p-4">
        <span className="block text-[0.8125rem]">{t("settings.fieldLabel")}</span>
        <Select
          items={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
          value={lang}
          onValueChange={(v) => setLang(String(v) as LangCode)}
        >
          <SelectTrigger size="sm" className="w-44">
            {/* `flex!` : le déclencheur applique `[&>span]:line-clamp-1`, donc `display:-webkit-box`
                sur son span — le drapeau tombait sur sa propre ligne au-dessus du libellé. */}
            <span className="flex! min-w-0 items-center gap-2">
              <FlagIcon code={active.code} />
              <span className="truncate">{active.label}</span>
            </span>
          </SelectTrigger>
          <SelectContent>
            {LANGUAGES.map((l) => (
              <SelectItem key={l.code} value={l.code}>
                <span className="flex items-center gap-2">
                  <FlagIcon code={l.code} />
                  <span className="w-5 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{l.code}</span>
                  <span>{l.label}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  );
}

export function InterfacePanel() {
  const { t } = useTranslation("settings");
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-6">
        <header>
          <h2 className="text-sm font-medium">{t("appearance.title")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("appearance.subtitle")}</p>
        </header>
        {MODES.map((mode) => (
          <div key={mode} className="flex flex-col gap-2.5">
            <h3 className="text-xs font-medium text-muted-foreground">{t(`appearance.group.${mode}`)}</h3>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2.5">
              {THEMES.filter((theme) => theme.mode === mode).map((theme) => (
                <ThemeCard key={theme.id} id={theme.id} label={theme.label} hint={theme.hint} />
              ))}
            </div>
          </div>
        ))}
        <ThemeColorsCard />
        <CustomThemesCard />
      </section>

      <LanguageRow />
    </div>
  );
}

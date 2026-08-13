// Thèmes personnalisés : l'apparence courante (palette de socle + couleurs retouchées) enregistrée
// sous un nom, puis rappelée d'un clic.
//
// Le cycle est celui d'un DOCUMENT, pas d'un préréglage figé : on crée, on retouche, on enregistre.
// Sans « Enregistrer », un thème rappelé puis modifié perdait ses modifications au changement suivant
// sans que rien ne le dise — il fallait le supprimer et le recréer pour changer une couleur.
//
// Différence avec NetsuRush : PAS de fond d'écran. Un thème n'y capture que palette et couleurs, donc
// l'aperçu est une vignette de palette, sans affiche à charger.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { appearanceMatches, type CustomTheme } from "@/lib/customThemes";
import { cn } from "@/lib/utils";
import { useApp } from "@/store";

/** Dialogue de saisie : même formulaire pour nommer un thème neuf et pour en renommer un. */
interface NameDialogState {
  /** `null` = création ; sinon l'identifiant du thème renommé. */
  id: string | null;
  name: string;
}

function ThemePreview({ theme }: { theme: CustomTheme }) {
  return (
    // `data-theme` local : les couleurs NON retouchées viennent de la palette de socle, exactement
    // comme dans l'app. L'aperçu montre donc le thème réel, pas une approximation.
    <div
      data-theme={theme.base}
      className="flex h-14 overflow-hidden rounded-md"
      style={{ background: theme.colors.bg ?? "var(--color-bg)", border: "1px solid var(--color-border)" }}
    >
      <span className="w-3 shrink-0" style={{ background: theme.colors.primary ?? "var(--color-primary)" }} />
      <span className="flex flex-1 flex-col gap-1.5 p-2" style={{ background: theme.colors.surface ?? "var(--color-surface)" }}>
        <span className="h-2 w-3/5 rounded-full" style={{ background: theme.colors.fg ?? "var(--color-fg)" }} />
        <span className="h-2 w-full rounded-full" style={{ background: "var(--color-surface-2)" }} />
        <span className="h-2 w-4/5 rounded-full" style={{ background: theme.colors.border ?? "var(--color-border)" }} />
      </span>
    </div>
  );
}

export function CustomThemesCard() {
  const { t } = useTranslation(["settings", "common"]);
  const customThemes = useApp((s) => s.customThemes);
  const customThemeId = useApp((s) => s.customThemeId);
  const selectTheme = useApp((s) => s.selectTheme);
  const createCustomTheme = useApp((s) => s.createCustomTheme);
  const updateCustomTheme = useApp((s) => s.updateCustomTheme);
  const renameCustomTheme = useApp((s) => s.renameCustomTheme);
  const deleteCustomTheme = useApp((s) => s.deleteCustomTheme);
  // L'apparence courante doit être relue à chaque retouche, sinon le bouton « Enregistrer » ne
  // s'allume jamais : ces deux champs SONT ce qu'un thème capture ici.
  const theme = useApp((s) => s.theme);
  const themeColors = useApp((s) => s.themeColors);
  const currentAppearance = useApp((s) => s.currentAppearance);

  const [naming, setNaming] = useState<NameDialogState | null>(null);

  const active = customThemes.find((entry) => entry.id === customThemeId) ?? null;
  const dirty = useMemo(
    () => Boolean(active) && !appearanceMatches(active as CustomTheme, currentAppearance()),
    // `currentAppearance` est stable (fonction du store) : ce sont les champs capturés qui doivent
    // déclencher le recalcul.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, theme, themeColors, currentAppearance],
  );

  const submitName = () => {
    if (!naming) return;
    if (naming.id) renameCustomTheme(naming.id, naming.name);
    else createCustomTheme(naming.name);
    setNaming(null);
  };

  return (
    <section className="flex flex-col gap-3 border-t border-border pt-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          <h3 className="text-sm font-medium">{t("settings:appearance.custom.title")}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("settings:appearance.custom.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Visible seulement quand il y a quelque chose à enregistrer : un bouton toujours actif
              n'apprend rien sur l'état du thème. */}
          {dirty ? (
            <Button size="sm" onClick={() => active && updateCustomTheme(active.id)}>
              <Save className="size-3.5" /> {t("settings:appearance.custom.save")}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => setNaming({ id: null, name: "" })}>
            <Plus className="size-3.5" /> {t("settings:appearance.custom.create")}
          </Button>
        </div>
      </div>

      {dirty ? <p className="text-xs text-muted-foreground">{t("settings:appearance.custom.unsaved", { name: active?.name })}</p> : null}

      {customThemes.length ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2.5">
          {customThemes.map((entry) => {
            const selected = entry.id === customThemeId;
            return (
              <div key={entry.id} className="group relative">
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => selectTheme(entry.id)}
                  className={cn(
                    "flex w-full min-w-0 flex-col gap-2 rounded-lg border p-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    selected ? "border-primary bg-accent" : "border-border hover:bg-accent/60",
                  )}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{entry.name}</span>
                    {selected && <Check className="size-4 shrink-0 text-primary" />}
                  </div>
                  <ThemePreview theme={entry} />
                </button>
                {/* Actions au survol : renommer et supprimer. Elles vivent HORS du bouton de
                    sélection — un bouton dans un bouton n'est pas un contrôle valide. */}
                <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                  <CardAction
                    label={t("settings:appearance.custom.rename")}
                    onClick={() => setNaming({ id: entry.id, name: entry.name })}
                  >
                    <Pencil className="size-3" />
                  </CardAction>
                  <CardAction label={t("settings:appearance.custom.delete")} onClick={() => deleteCustomTheme(entry.id)}>
                    <Trash2 className="size-3" />
                  </CardAction>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("settings:appearance.custom.empty")}</p>
      )}

      <Dialog open={naming !== null} onOpenChange={(open) => { if (!open) setNaming(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{naming?.id ? t("settings:appearance.custom.rename") : t("settings:appearance.custom.create")}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={naming?.name ?? ""}
            onChange={(e) => setNaming((state) => (state ? { ...state, name: e.target.value } : state))}
            onKeyDown={(e) => { if (e.key === "Enter") submitName(); }}
            placeholder={t("settings:appearance.custom.namePlaceholder")}
          />
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setNaming(null)}>
              {t("common:action.cancel")}
            </Button>
            <Button size="sm" onClick={submitName}>{t("settings:appearance.custom.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function CardAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            onClick={onClick}
            className="rounded bg-black/70 p-1 text-white outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {children}
          </button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

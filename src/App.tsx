import { lazy, Suspense, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { nr } from "@/lib/bridge";
import { ReferencePanel } from "@/components/reference/ReferencePanel";
import { SetupGate } from "@/components/setup/SetupGate";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ErrorBadge } from "@/components/ErrorBadge";
import { WindowControls } from "@/components/WindowControls";
import { BrandIcon } from "@/components/BrandIcon";
import { BetaBadge } from "@/components/BetaBadge";
import { Spinner } from "@/components/ui/spinner";
import { Toaster } from "@/components/ui/toast";
import { AppSettings } from "@/components/settings/AppSettings";

// Fenêtre détachée du board (hash #reference, 2e WebviewWindow Tauri) : le board nu, sans le cadre.
const ReferenceWindow = lazy(() => import("@/components/reference/ReferenceWindow").then((m) => ({ default: m.ReferenceWindow })));
const IS_REFERENCE_WINDOW =
  typeof window !== "undefined" && window.location.hash.replace(/^#\/?/, "").startsWith("reference");

// Cadre affiché avant que la langue et le core ne soient prêts. La fenêtre Tauri est frameless : ses
// contrôles doivent exister DÈS le premier rendu, sinon la fenêtre n'est ni déplaçable ni fermable
// pendant le démarrage.
export function WindowLoading() {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <div data-tauri-drag-region className="flex h-9 shrink-0 items-center gap-2 px-3">
        <BrandIcon className="size-6" />
        <span className="text-xs font-semibold tracking-tight">NetsuBoard</span>
        <BetaBadge />
        <div className="ml-auto"><WindowControls /></div>
      </div>
      <div className="flex flex-1 items-center justify-center"><Spinner /></div>
    </div>
  );
}

// Coquille de NetsuBoard : une seule page. Pas de rail latéral, pas d'onglets, pas de sous-nav — il
// n'y a qu'un module, et lui donner une navigation reviendrait à meubler du vide.
function Shell() {
  const { t } = useTranslation();

  // Réapplique l'épinglage (always-on-top) au démarrage : l'état réel de la fenêtre Tauri se perd à
  // chaque lancement alors que la préférence, elle, survit.
  useEffect(() => { void nr.setAlwaysOnTop?.(false); }, []);

  return (
    <TooltipProvider delay={600}>
      <div className="flex h-screen flex-col overflow-hidden">
        <div data-tauri-drag-region className="flex h-9 shrink-0 items-center gap-2 px-3">
          <BrandIcon className="size-6" />
          <span className="text-xs font-semibold tracking-tight">{t("app.name", "NetsuBoard")}</span>
          <BetaBadge />
          <div className="ml-auto"><WindowControls /></div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <ReferencePanel />
        </div>

        {/* Paramètres : rendus au niveau de la coquille, pas dans la page — ils s'ouvrent aussi
            depuis la pastille d'erreur, qui vit ici, et doivent survivre au passage accueil ↔ board. */}
        <AppSettings />

        {/* Colonne flottante du coin bas-droit : les pastilles transitoires s'empilent au-dessus de
            l'indicateur d'erreur, qui reste ancré au bas. */}
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
          <Toaster />
          <ErrorBadge />
        </div>
      </div>
    </TooltipProvider>
  );
}

export default function App() {
  if (IS_REFERENCE_WINDOW) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<WindowLoading />}><ReferenceWindow /></Suspense>
      </ErrorBoundary>
    );
  }
  return (
    <ErrorBoundary>
      <SetupGate>
        <Shell />
      </SetupGate>
    </ErrorBoundary>
  );
}

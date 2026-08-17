import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { nr } from "@/lib/bridge";
import { useApp } from "@/store";
import { convexConfigured } from "@/lib/convexEnv";
import { ReferencePanel } from "@/components/reference/ReferencePanel";
import { SetupGate } from "@/components/setup/SetupGate";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ErrorBadge } from "@/components/ErrorBadge";
import { WindowControls } from "@/components/WindowControls";
import { HeaderLinks } from "@/components/HeaderLinks";
import { BrandIcon } from "@/components/BrandIcon";
import { BetaBadge } from "@/components/BetaBadge";
import { Spinner } from "@/components/ui/spinner";
import { Toaster } from "@/components/ui/toast";
import { AppSettings } from "@/components/settings/AppSettings";
import { UpdateBootstrap } from "@/components/updates/UpdateBootstrap";
import { UpdateButton } from "@/components/updates/UpdateButton";
import { armAutoInstall } from "@/store/updater";
import { useDiscordPresence } from "@/lib/discordPresence";
import { TextContextMenu } from "@/components/common/TextContextMenu";

// Fenêtre détachée du board (hash #reference, 2e WebviewWindow Tauri) : le board nu, sans le cadre.
const ReferenceWindow = lazy(() => import("@/components/reference/ReferenceWindow").then((m) => ({ default: m.ReferenceWindow })));
const IS_REFERENCE_WINDOW =
  typeof window !== "undefined" && window.location.hash.replace(/^#\/?/, "").startsWith("reference");

// Chargé PARESSEUSEMENT : le gate tire `convex/react`. Sans déploiement Convex il n'est jamais
// monté, et son chunk ne part donc jamais sur le réseau.
const LoginGate = lazy(() => import("@/components/auth/LoginGate").then((m) => ({ default: m.LoginGate })));

// Gate de connexion : TRAVERSANT tant que Convex n'est pas configuré (dev, navigateur, mock). Un
// board local doit s'ouvrir sans backend — le compte ne sert qu'à nommer un rapport de bug.
function AuthGate({ children }: { children: ReactNode }) {
  if (!convexConfigured) return <>{children}</>;
  return <Suspense fallback={<WindowLoading />}><LoginGate>{children}</LoginGate></Suspense>;
}

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
  // chaque lancement alors que la préférence, elle, survit — et c'est ELLE que la page lit pour
  // choisir son format, donc une fenêtre non épinglée sous une interface en mode épinglé.
  useEffect(() => { void nr.setAlwaysOnTop?.(useApp.getState().pinned); }, []);

  // Unattended launch update (opt-in, off by default). Armed HERE and nowhere else: setup and login
  // are behind us, so the relaunch it may trigger cannot cut a runtime download or a sign-in.
  useEffect(() => { armAutoInstall(); }, []);

  // Rich Presence Discord : pousse le board ouvert au core. Monté ICI seulement — la fenêtre détachée
  // du board est le même renderer et pousserait un second contexte concurrent.
  useDiscordPresence();

  return (
    <TooltipProvider delay={600}>
      <div className="flex h-screen flex-col overflow-hidden">
        <div data-tauri-drag-region className="flex h-9 shrink-0 items-center gap-2 px-3">
          <BrandIcon className="size-6" />
          <span className="text-xs font-semibold tracking-tight">{t("app.name", "NetsuBoard")}</span>
          <BetaBadge />
          {/* Le conteneur s'ajuste à son contenu : le `ml-auto` interne de WindowControls n'a donc
              aucune place à manger, et les deux raccourcis restent collés à l'épingle.
              La mise à jour ouvre la barre, avant les raccourcis : coincée entre l'épingle et
              Réduire, elle se lisait comme un contrôle de fenêtre et voisinait le bouton Fermer.
              Absente tant qu'aucune version n'attend — cf. UpdateButton. */}
          <div className="ml-auto flex items-center">
            <UpdateButton variant="icon" />
            <HeaderLinks />
            <WindowControls withUpdate={false} />
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <ReferencePanel />
        </div>

        {/* Paramètres : rendus au niveau de la coquille, pas dans la page — ils s'ouvrent aussi
            depuis la pastille d'erreur, qui vit ici, et doivent survivre au passage accueil ↔ board. */}
        <AppSettings />

        {/* Nouveautés de la version installée : une seule fois, après une mise à jour. La RECHERCHE
            d'une version plus récente n'est pas ici, elle appartient à `UpdateButton`. */}
        <UpdateBootstrap />

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
  // Écoute les retours OAuth deep-link (netsuboard://auth) dès le boot — actif avant même le login,
  // puisque c'est ce qui complète la connexion. No-op hors Tauri. Import dynamique : le module tire
  // `better-auth`, inutile de le parser au démarrage sans déploiement Convex.
  useEffect(() => {
    if (!convexConfigured) return;
    void import("@/lib/deepLink").then((m) => m.initAuthDeepLink());
  }, []);

  if (IS_REFERENCE_WINDOW) {
    return (
      <ErrorBoundary>
        <TextContextMenu />
        <Suspense fallback={<WindowLoading />}><ReferenceWindow /></Suspense>
      </ErrorBoundary>
    );
  }
  return (
    <ErrorBoundary>
      {/* Right-click policy for the whole window (native menu off, edit menu in text fields) —
          above the setup gate, so it also covers the first-run screens. */}
      <TextContextMenu />
      {/* Ordre : installation D'ABORD, connexion ensuite. La langue est la première étape de
          `SetupGate` — poser l'écran de connexion devant afficherait un texte dans une langue que
          l'utilisateur n'a pas encore choisie. */}
      <SetupGate>
        <AuthGate>
          <Shell />
        </AuthGate>
      </SetupGate>
    </ErrorBoundary>
  );
}

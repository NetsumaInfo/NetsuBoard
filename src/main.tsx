import React from "react";
import ReactDOM from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import App, { WindowLoading } from "./App";
import { initConsoleCapture } from "./lib/appConsole";
import i18n, { initI18n, hasChosenLang, type LangCode } from "./i18n";
import "./index.css";

// Capte les logs (renderer + core) au plus tôt pour le panneau Console (debug / bêta-test).
initConsoleCapture();

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

// La fenêtre Tauri est frameless : on monte immédiatement le cadre avec ses contrôles, avant tout
// travail asynchrone, sinon elle n'est ni déplaçable ni fermable pendant le démarrage.
root.render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}><WindowLoading /></I18nextProvider>
  </React.StrictMode>,
);

// Préférence de langue tenue par le core (nr.config.json) : elle couvre les renderers dont le
// localStorage est vierge, comme la fenêtre détachée du board.
async function sharedLang(): Promise<LangCode | undefined> {
  if (hasChosenLang()) return undefined; // choix local explicite : il gagne
  try {
    const { nr } = await import("./lib/bridge");
    const code = (await nr.configGet?.())?.lang;
    return (code as LangCode | undefined) || undefined;
  } catch {
    return undefined; // core injoignable → langue du système
  }
}

// Résout la langue de départ ET charge ses ressources AVANT le premier rendu (pas de flash de repli
// fr pour un utilisateur en ja/zh au démarrage à froid). i18n est déjà initialisé en fr en repli.
async function boot(): Promise<void> {
  await initI18n(await sharedLang()).catch(() => {});
  root.render(
    <React.StrictMode>
      <I18nextProvider i18n={i18n}><App /></I18nextProvider>
    </React.StrictMode>,
  );
}

void boot();

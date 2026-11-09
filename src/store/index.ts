// Store applicatif (zustand) composé de slices : coquille (onglet/sidebar), réglages, sources d'un
// lot de traitements. Chaque slice est typée sur l'état complet, si bien
// qu'une action peut lire/écrire les champs d'une autre slice.
import { create } from "zustand";
import { createShellSlice, type ShellSlice } from "./shell";
import { createSettingsSlice, type SettingsSlice } from "./settings";
import { createNetsulabSlice, type NetsulabSlice } from "./netsulab";

export type { TabId, DerushSection } from "./types";

export type AppState = ShellSlice & SettingsSlice & NetsulabSlice;

export const useApp = create<AppState>()((...a) => ({
  ...createShellSlice(...a),
  ...createSettingsSlice(...a),
  ...createNetsulabSlice(...a),
}));

// Dev uniquement : expose le store pour piloter/inspecter l'UI depuis un outil de preview
// (force-render d'une vue qui dépend d'un état hôte absent en navigateur). Strip en prod.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __useApp?: typeof useApp }).__useApp = useApp;
}

// Ouverture du panneau Paramètres. Store minuscule et GLOBAL : le panneau est rendu une seule fois
// par fenêtre (coquille App, fenêtre détachée), mais s'ouvre depuis des endroits qui ne se voient pas
// entre eux — l'engrenage de l'accueil, celui de la barre d'outils, le menu contextuel du board et la
// pastille d'erreur (qui vit hors du panneau Référence). Un booléen local par appelant obligeait à
// faire descendre l'état dans trois arbres distincts.

import { create } from "zustand";

export type SettingsSection = "board" | "interface" | "console" | "about";

type SettingsUi = {
  open: boolean;
  section: SettingsSection;
  /** Ouvre le panneau, éventuellement directement sur une section (pastille d'erreur → console). */
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  setSection: (section: SettingsSection) => void;
};

export const useSettingsUi = create<SettingsUi>((set) => ({
  open: false,
  section: "board",
  openSettings: (section) => set(section ? { open: true, section } : { open: true }),
  closeSettings: () => set({ open: false }),
  setSection: (section) => set({ section }),
}));

/** Raccourci hors composant (handlers, stores) : évite d'abonner l'appelant au store. */
export const openSettings = (section?: SettingsSection) => useSettingsUi.getState().openSettings(section);

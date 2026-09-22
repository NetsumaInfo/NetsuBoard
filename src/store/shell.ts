// Slice « coquille » : onglet actif, sidebar repliée, fenêtre.
import type { StateCreator } from "zustand";
import { nr } from "@/lib/bridge";
import type { AppState } from "./index";
import type { TabId, HostId } from "./types";
import {
  MODULE_IDS,
  enabledFromHidden,
  loadModulePreferences,
  normalizeHiddenModules,
  saveModulePreferences,
  type ModuleId,
} from "@/lib/modules";
import { defaultSettingsTabs, settingsPageDef, type SettingsPage } from "@/features/settings/nav";

export interface ShellSlice {
  tab: TabId;
  setTab: (t: TabId) => void;

  // Page active dans les Paramètres (nav interne multi-pages).
  settingsPage: SettingsPage;
  setSettingsPage: (p: SettingsPage) => void;
  /** Onglet retenu POUR CHAQUE page (pas un seul onglet courant) : revenir sur une page la rouvre
   *  là où on l'avait laissée. Dans le store et pas en état local — la sous-nav vit dans la BARRE DE
   *  TITRE et le panneau dans la page, deux arbres React qui doivent partager la sélection. */
  settingsTab: Record<SettingsPage, string>;
  setSettingsTab: (page: SettingsPage, tab: string) => void;
  /** Ouvre une page des Paramètres sur un onglet précis (bouton Télécharger, badge d'erreur…). */
  openSettings: (page: SettingsPage, tab?: string) => void;
  // Raccourcis des deux destinations les plus appelées depuis le reste de l'app.
  openExportSettings: () => void;
  openConsole: () => void;

  moduleOrder: ModuleId[];
  hiddenModules: ModuleId[];
  setModuleVisible: (id: ModuleId, visible: boolean) => void;
  moveModule: (id: ModuleId, direction: -1 | 1) => void;
  resetModules: () => void;

  // Barre latérale MASQUÉE entièrement (le rail hover-expand disparaît, l'espace est rendu au contenu).
  // Persisté. Se rouvre via le menu clic droit (fond de vue / barre de titre). Distinct du survol :
  // le rail s'ouvre déjà seul au survol, donc « replier » n'avait aucun sens — ici on le CACHE.
  sidebarHidden: boolean;
  toggleSidebar: () => void;

  // Fenêtre épinglée au-dessus (always-on-top) : persistée, appliquée à la fenêtre principale.
  // Sert le mode « coin de l'écran » (un seul écran) pour garder l'app visible pendant Resolve.
  pinned: boolean;
  togglePinned: () => void;
  // Fenêtre tenue au-dessus par un MODE et non par l'épingle : le mode transparent à la souris, qui
  // serait inutilisable derrière l'application du dessous. Jamais persisté — c'est un état de mode —
  // et l'épingle de la barre de titre l'affiche, sinon la fenêtre serait au-dessus sans le dire.
  onTopHold: boolean;
  setOnTopHold: (on: boolean) => void;

  // Hôte cible actif (Premiere / After Effects) — sélecteur en pied de sidebar.
  activeHost: HostId;
  setActiveHost: (h: HostId) => void;
}

const HOST_IDS: HostId[] = ["ppro", "aeft"];
function initialHost(): HostId {
  try {
    // Rendu en remote dans le panneau Adobe (?host=aeft|ppro, cf. index.html) : cet hôte gagne sur
    // la préférence persistée.
    const forced = (window as unknown as { __NR_HOST__?: string }).__NR_HOST__ as HostId | undefined;
    if (forced && HOST_IDS.includes(forced)) return forced;
    const v = localStorage.getItem("nr.activeHost") as HostId | null;
    if (v && HOST_IDS.includes(v)) return v;
  } catch { /* noop */ }
  return "ppro";
}

const initialModules = loadModulePreferences();

// Taille de fenêtre retenue POUR CHAQUE mode (épinglé / normal) : la bascule restitue la dernière
// taille de l'autre mode. Fenêtre sans décorations → la taille CSS du document EST la taille logique
// écrite par `setWindowSize`, aucun aller-retour avec la coquille n'est nécessaire pour la lire.
const WIN_SIZE_KEY = { pinned: "nr.pinnedSize", free: "nr.windowSize" } as const;
// Sans taille retenue : carré au premier épinglage, format normal modéré au premier dépinglage
// (assez large pour l'interface complète, sans sauter au plein écran).
const WIN_SIZE_DEFAULT = { pinned: { w: 560, h: 560 }, free: { w: 800, h: 640 } } as const;
type WinMode = keyof typeof WIN_SIZE_KEY;

function readWinSize(mode: WinMode): { w: number; h: number } {
  try {
    const v = JSON.parse(localStorage.getItem(WIN_SIZE_KEY[mode]) || "");
    if (v && typeof v.w === "number" && typeof v.h === "number" && v.w > 0 && v.h > 0) return { w: v.w, h: v.h };
  } catch { /* défaut ci-dessous */ }
  return WIN_SIZE_DEFAULT[mode];
}

function rememberWinSize(mode: WinMode): void {
  if (typeof window === "undefined") return;
  const w = Math.round(window.innerWidth), h = Math.round(window.innerHeight);
  if (w < 1 || h < 1) return;
  try { localStorage.setItem(WIN_SIZE_KEY[mode], JSON.stringify({ w, h })); } catch { /* noop */ }
}

export const createShellSlice: StateCreator<AppState, [], [], ShellSlice> = (set, get) => ({
  tab: "derush",
  setTab: (tab) => set({ tab }),

  activeHost: initialHost(),
  setActiveHost: (activeHost) => {
    try { localStorage.setItem("nr.activeHost", activeHost); } catch { /* noop */ }
    set({ activeHost });
  },

  settingsPage: "interface",
  setSettingsPage: (settingsPage) => set({ settingsPage }),
  settingsTab: defaultSettingsTabs(),
  setSettingsTab: (page, tab) => set((state) => ({ settingsTab: { ...state.settingsTab, [page]: tab } })),
  openSettings: (page, tab) => {
    const target = tab && settingsPageDef(page).tabs.some((t) => t.id === tab) ? tab : undefined;
    set((state) => ({
      tab: "settings",
      settingsPage: page,
      settingsTab: target ? { ...state.settingsTab, [page]: target } : state.settingsTab,
    }));
  },
  openExportSettings: () => get().openSettings("export"),
  openConsole: () => get().openSettings("system", "console"),

  moduleOrder: initialModules.order,
  hiddenModules: initialModules.hidden,
  setModuleVisible: (id, visible) => {
    const state = get();
    const hidden = visible
      ? state.hiddenModules.filter((item) => item !== id)
      : normalizeHiddenModules([...state.hiddenModules, id]);
    saveModulePreferences({ order: state.moduleOrder, hidden });
    const nextTab = !visible && state.tab === id ? enabledFromHidden(hidden)[0] ?? "settings" : state.tab;
    set({ hiddenModules: hidden, tab: nextTab });
  },
  moveModule: (id, direction) => {
    const order = [...get().moduleOrder];
    const index = order.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    const hidden = get().hiddenModules;
    saveModulePreferences({ order, hidden });
    set({ moduleOrder: order });
  },
  resetModules: () => {
    const order = [...MODULE_IDS];
    const hidden: ModuleId[] = [];
    saveModulePreferences({ order, hidden });
    set({ moduleOrder: order, hiddenModules: hidden });
  },

  sidebarHidden: typeof localStorage !== "undefined" && localStorage.getItem("nr.sidebarHidden") === "1",
  toggleSidebar: () =>
    set((s) => {
      const sidebarHidden = !s.sidebarHidden;
      try { localStorage.setItem("nr.sidebarHidden", sidebarHidden ? "1" : "0"); } catch { /* noop */ }
      return { sidebarHidden };
    }),

  pinned: typeof localStorage !== "undefined" && localStorage.getItem("nr.pinned") === "1",
  togglePinned: () =>
    set((s) => {
      const pinned = !s.pinned;
      try { localStorage.setItem("nr.pinned", pinned ? "1" : "0"); } catch { /* noop */ }
      nr.setAlwaysOnTop(pinned);
      // La taille courante appartient au mode QUITTÉ : on la retient avant d'appliquer celle du mode
      // visé, sinon un redimensionnement fait à la main serait perdu à chaque bascule.
      rememberWinSize(pinned ? "free" : "pinned");
      const size = readWinSize(pinned ? "pinned" : "free");
      nr.setWindowSize(size.w, size.h);
      return { pinned };
    }),

  onTopHold: false,
  setOnTopHold: (on) => set({ onTopHold: on }),
});

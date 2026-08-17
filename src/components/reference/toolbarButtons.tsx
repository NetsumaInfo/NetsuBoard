// Boutons de la barre d'outils ÉPINGLÉE : identité, libellé, icône, ordre. Séparé de la barre
// elle-même parce que deux écrans lisent cette liste — la barre pour rendre ce qui est choisi, les
// Paramètres pour proposer le choix.
//
// L'ordre de rendu est CELUI DE CETTE LISTE, pas celui des préférences : une barre d'outils dont la
// disposition change d'une session à l'autre se réapprend à chaque fois.
//
// Ce qui n'y figure pas : épingler, détacher, rattacher. Ces trois-là sont la SORTIE du format
// épinglé — les rendre masquables, c'est permettre de se retrouver dans une fenêtre coin sans rien
// pour en sortir.

import {
  Type, Frame, Pencil, SwatchBook, Pipette, LayoutGrid, Magnet, ZoomIn, ZoomOut, Maximize,
  Pause, Undo2, Redo2, MousePointerBan, Settings2, Save, SaveAll, FolderOpen, Share2, FilePlus2, Home,
} from "lucide-react";

export type PinnedButtonId =
  | "text" | "frame" | "draw" | "palette" | "extractPalette" | "tidy"
  | "snap" | "zoomOut" | "zoomIn" | "fit" | "freeze"
  | "undo" | "redo" | "mouseThrough" | "settings" | "save" | "saveAs" | "openProject"
  | "share" | "newScene" | "home";

export const PINNED_BUTTONS: { id: PinnedButtonId; labelKey: string; icon: typeof Type }[] = [
  { id: "text", labelKey: "toolbar.addText", icon: Type },
  { id: "frame", labelKey: "toolbar.addFrame", icon: Frame },
  { id: "draw", labelKey: "toolbar.draw", icon: Pencil },
  { id: "palette", labelKey: "palette.studio.open", icon: SwatchBook },
  { id: "extractPalette", labelKey: "shortcut.extractPalette", icon: Pipette },
  { id: "tidy", labelKey: "shortcut.arrangeDefault", icon: LayoutGrid },
  { id: "snap", labelKey: "toolbar.snap", icon: Magnet },
  { id: "zoomOut", labelKey: "actions.zoomOut", icon: ZoomOut },
  { id: "zoomIn", labelKey: "actions.zoomIn", icon: ZoomIn },
  { id: "fit", labelKey: "actions.fitAll", icon: Maximize },
  { id: "freeze", labelKey: "toolbar.freeze", icon: Pause },
  { id: "undo", labelKey: "actions.undo", icon: Undo2 },
  { id: "redo", labelKey: "actions.redo", icon: Redo2 },
  { id: "mouseThrough", labelKey: "mouseThrough.on", icon: MousePointerBan },
  { id: "settings", labelKey: "actions.settings", icon: Settings2 },
  { id: "save", labelKey: "toolbar.saveScene", icon: Save },
  { id: "saveAs", labelKey: "toolbar.saveAs", icon: SaveAll },
  { id: "openProject", labelKey: "toolbar.openScene", icon: FolderOpen },
  { id: "share", labelKey: "toolbar.share", icon: Share2 },
  { id: "newScene", labelKey: "actions.newScene", icon: FilePlus2 },
  { id: "home", labelKey: "toolbar.home", icon: Home },
];

// Barre épinglée par défaut : de quoi poser, regarder et annuler. Le document (enregistrer, ouvrir,
// accueil) reste au clic droit, qui le porte déjà.
export const DEFAULT_PINNED_BUTTONS: PinnedButtonId[] = [
  "text", "frame", "draw", "palette", "snap", "zoomOut", "zoomIn", "fit", "freeze",
];

// Ancrés à l'AUTRE bout par défaut : ce qui répare et ce qui touche à la fenêtre, loin des outils
// de pose.
export const DEFAULT_PINNED_BUTTONS_END: PinnedButtonId[] = ["undo", "redo", "mouseThrough"];

// Barre PLEINE (fenêtre normale) : mêmes boutons, mêmes deux extrémités, autour du nom du projet.
export const DEFAULT_BAR_BUTTONS: PinnedButtonId[] = [
  "home", "text", "frame", "draw", "palette", "extractPalette", "tidy",
  "snap", "zoomOut", "zoomIn", "fit", "freeze",
];
export const DEFAULT_BAR_BUTTONS_END: PinnedButtonId[] = [
  "undo", "redo", "newScene", "save", "saveAs", "openProject", "share", "settings", "mouseThrough",
];

// Bord de la fenêtre où la barre épinglée se pose. Gauche/droite la rendent verticale.
export type PinnedSide = "top" | "bottom" | "left" | "right";
export const PINNED_SIDES: { id: PinnedSide; labelKey: string }[] = [
  { id: "top", labelKey: "settings.sideTop" },
  { id: "bottom", labelKey: "settings.sideBottom" },
  { id: "left", labelKey: "settings.sideLeft" },
  { id: "right", labelKey: "settings.sideRight" },
];

export function isVerticalSide(side: PinnedSide): boolean {
  return side === "left" || side === "right";
}

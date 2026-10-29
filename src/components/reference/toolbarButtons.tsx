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
  AddTextGlyph, AddBlockGlyph, AddFrameGlyph, DrawToggleGlyph, PaletteStudioGlyph, ExtractPaletteGlyph,
  TidyGlyph, SnapGlyph, ZoomOutGlyph, ZoomInGlyph, FitAllGlyph, FreezeGlyph, UndoGlyph, RedoGlyph,
  MouseThroughGlyph, SettingsGlyph, SaveGlyph, SaveAsGlyph, OpenSceneGlyph, ShareGlyph, NewSceneGlyph,
  HomeGlyph, type Glyph,
} from "./netsuIcons";

export type PinnedButtonId =
  | "text" | "note" | "frame" | "draw" | "palette" | "extractPalette" | "tidy"
  | "snap" | "zoomOut" | "zoomIn" | "fit" | "freeze"
  | "undo" | "redo" | "mouseThrough" | "settings" | "save" | "saveAs" | "openProject"
  | "share" | "newScene" | "home";

export const PINNED_BUTTONS: { id: PinnedButtonId; labelKey: string; icon: Glyph }[] = [
  { id: "text", labelKey: "toolbar.addText", icon: AddTextGlyph },
  { id: "note", labelKey: "toolbar.addBlock", icon: AddBlockGlyph },
  { id: "frame", labelKey: "toolbar.addFrame", icon: AddFrameGlyph },
  { id: "draw", labelKey: "toolbar.draw", icon: DrawToggleGlyph },
  { id: "palette", labelKey: "palette.studio.open", icon: PaletteStudioGlyph },
  { id: "extractPalette", labelKey: "shortcut.extractPalette", icon: ExtractPaletteGlyph },
  { id: "tidy", labelKey: "shortcut.arrangeDefault", icon: TidyGlyph },
  { id: "snap", labelKey: "toolbar.snap", icon: SnapGlyph },
  { id: "zoomOut", labelKey: "actions.zoomOut", icon: ZoomOutGlyph },
  { id: "zoomIn", labelKey: "actions.zoomIn", icon: ZoomInGlyph },
  { id: "fit", labelKey: "actions.fitAll", icon: FitAllGlyph },
  { id: "freeze", labelKey: "toolbar.freeze", icon: FreezeGlyph },
  { id: "undo", labelKey: "actions.undo", icon: UndoGlyph },
  { id: "redo", labelKey: "actions.redo", icon: RedoGlyph },
  { id: "mouseThrough", labelKey: "mouseThrough.on", icon: MouseThroughGlyph },
  { id: "settings", labelKey: "actions.settings", icon: SettingsGlyph },
  { id: "save", labelKey: "toolbar.saveScene", icon: SaveGlyph },
  { id: "saveAs", labelKey: "toolbar.saveAs", icon: SaveAsGlyph },
  { id: "openProject", labelKey: "toolbar.openScene", icon: OpenSceneGlyph },
  { id: "share", labelKey: "toolbar.share", icon: ShareGlyph },
  { id: "newScene", labelKey: "actions.newScene", icon: NewSceneGlyph },
  { id: "home", labelKey: "toolbar.home", icon: HomeGlyph },
];

// Barre épinglée par défaut : de quoi poser, regarder et annuler. Le document (enregistrer, ouvrir,
// accueil) reste au clic droit, qui le porte déjà.
export const DEFAULT_PINNED_BUTTONS: PinnedButtonId[] = [
  "text", "note", "frame", "draw", "palette", "snap", "zoomOut", "zoomIn", "fit", "freeze",
];

// Ancrés à l'AUTRE bout par défaut : ce qui répare et ce qui touche à la fenêtre, loin des outils
// de pose.
export const DEFAULT_PINNED_BUTTONS_END: PinnedButtonId[] = ["undo", "redo", "mouseThrough"];

// Barre PLEINE (fenêtre normale) : mêmes boutons, mêmes deux extrémités, autour du nom du projet.
export const DEFAULT_BAR_BUTTONS: PinnedButtonId[] = [
  "home", "text", "note", "frame", "draw", "palette", "extractPalette", "tidy",
  "snap", "zoomOut", "zoomIn", "fit", "freeze",
];
export const DEFAULT_BAR_BUTTONS_END: PinnedButtonId[] = [
  "undo", "redo", "newScene", "save", "saveAs", "openProject", "share", "mouseThrough", "settings",
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

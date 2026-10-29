// Store local du board de référence (zustand). LOCAL et non assemblé dans le store global :
// la fenêtre détachée est un AUTRE renderer (autre instance de store) — la source de vérité
// partagée entre fenêtres, c'est la persistance disque + la sync IPC, pas ce store.

import { pruneLinks } from "./links/model";
import { linksWithin, remapLinks } from "./links/graph";
import { create } from "zustand";
import i18n from "@/i18n";
import type { MemberPresence } from "@/lib/collab/client";
import { uiLocale } from "@/lib/utils";
import {
  type BoardItem,
  type BoardView,
  type BoardScene,
  type Geom,
  type DrawTool,
  type DrawShape,
  type ArrowHead,
  type DashStyle,
  type RouteStyle,
  ZOOM_MIN,
  ZOOM_MAX,
  uid,
  fitSize,
  makeDrawItem,
  topZ,
  bottomZ,
} from "./referenceShared";
import { foldFrame, parkInto, sceneItems, splitLevel, switchLevel, unfoldFrame } from "./boardFolders";
import { noteMode } from "./blockModel";
import { frameContentIds } from "./boardFrames";
import {
  type BoardBg,
  type SaveOpts,
  type BoardPrefs,
  BG_KEY,
  SAVE_KEY,
  PLACE_KEY,
  PREFS_KEY,
  readBg,
  readSave,
  readPlaceFrame,
  readPrefs,
} from "./boardPrefs";
import {
  type ArrangeMode,
  type ArrangeOpts,
  type NormalizeMode,
  computeArrange,
  computeNormalize,
} from "./boardArrange";

export type { ArrangeMode } from "./boardArrange";

// Réglages d'un rangement de groupe : disposition + uniformisation de taille appliquées ENSEMBLE
// (une seule entrée d'annulation), avec l'écart et l'ordre choisis dans le sélecteur.
export interface TidyOpts extends ArrangeOpts {
  layout: ArrangeMode;
  uniform?: NormalizeMode | "none";
  // Géométrie de DÉPART, capturée avant le premier rangement. Le sélecteur applique à chaque clic
  // pour qu'on voie le résultat ; sans point de départ fixe, chaque essai repartirait du précédent
  // et la sélection dériverait d'échelle en échelle. Avec, comparer deux dispositions revient à
  // comparer deux rangements de la MÊME planche.
  base?: Map<string, { x: number; y: number; w: number; h: number }>;
  // Étiquette de coalescing : toute une session de réglages ne coûte qu'un seul Ctrl+Z.
  tag?: string;
}

// Portée d'une réinitialisation de transformation.
export type ResetKind = "scale" | "rotation" | "flip" | "crop" | "all";

export interface BoardState {
  sceneId: string | null;
  sceneName: string;
  // Fichier .netsu dont ce board est le contenu — c'est LUI qui fait foi quand il est posé, et la
  // scène quitte alors la bibliothèque interne (`sceneId` remis à null) : deux copies du même board
  // finiraient par diverger. `null` = board de travail anonyme (autosave, comportement d'origine).
  filePath: string | null;
  fileReadonly: boolean;       // archive .netsu v1 : lisible, pas enregistrable en place
  collabProjectId: string | null;
  collabRole: "owner" | "editor" | "viewer" | null;
  collabKeyEpoch: number;
  collabRotationRequired: boolean;
  collabPeerCandidates: number;
  collabOfflineQueued: boolean;
  // Présence OBSERVÉE des autres membres (cf. service.rs#member_presence). Vide hors board partagé.
  collabMembers: MemberPresence[];
  items: BoardItem[];
  // Items of every OTHER folder level (see boardFolders). `items` is only the level on screen.
  stash: BoardItem[];
  // Folders opened from the top level, innermost last. `view` = camera of the level it was opened
  // from, given back on the way out.
  folderPath: { id: string; view: BoardView }[];
  // Note sheet open full size over the board (NoteOverlay). Never persisted.
  noteOpenId: string | null;
  // Frame VIVANTE des séquences en lecture, hors du document. Elle vivait dans `items`, donc chaque
  // frame de chaque séquence recréait le tableau ENTIER : sur un board de plusieurs centaines de
  // médias, dix séquences à 12 images/s suffisaient à re-rendre tout le board 120 fois par seconde
  // (culling refiltré, barre d'outils, panneau, tous réveillés) — le coût dominant d'un gros board.
  // Ici, avancer d'une frame n'écrit qu'une entrée : seuls la séquence concernée et sa barre de
  // lecture se re-rendent. La position DOCUMENT reste `item.frame`, réécrite à l'arrêt de la lecture.
  seqFrames: Record<string, number>;
  view: BoardView;
  background: BoardBg;
  selectedId: string | null;   // item primaire (inspecteur)
  selectedIds: string[];       // multi-sélection
  editingId: string | null;    // note texte en cours d'édition
  focusReq: string | null;     // demande de centrage/zoom sur un item (double-clic) → consommée par le board
  croppingId: string | null;   // item en cours de rognage
  // Générateur de palettes ouvert. Vit ICI et pas dans la barre d'outils ou l'inspecteur : ces
  // deux-là se démontent quand la sélection change, et le panneau doit justement SURVIVRE à un
  // clic sur le board — on y sélectionne les images dont on veut extraire les couleurs.
  // `targetId` = bloc palette réécrit à la validation ; null = poser un nouveau bloc.
  studio: { targetId: string | null } | null;
  // Fenêtre transparente à la souris (cf. `boardMouseThrough`). Jamais persisté : une planche qui
  // rouvrirait sourde à la souris serait perdue.
  mouseThrough: boolean;
  // Avertissement en attente (barre d'outils ou raccourci) : la boite de dialogue s'ouvre dessus.
  mouseThroughAsk: boolean;
  frozen: boolean;             // tout figé (aucune lecture vidéo/YouTube)
  navigating: boolean;         // gel transitoire pendant pan/zoom/transformation (distinct de frozen)
  navigationHolds: number;     // compteur : plusieurs gestes peuvent brièvement se chevaucher
  drawMode: boolean;           // calque de dessin maison interactif
  drawBack: boolean;           // calque de dessin envoyé en ARRIÈRE-plan (sous les items)
  // Formes de dessin sélectionnées (hors mode dessin aussi). Une LISTE : un lasso doit pouvoir en
  // prendre plusieurs, exactement comme il prend plusieurs items. Poignées et inspecteur ne
  // s'affichent qu'à UNE forme — au-delà, il n'y a pas de géométrie commune à éditer.
  drawSel: string[];
  // `op` = opacité des NOUVEAUX tracés (1 = opaque ; le surligneur force ~0,45 si laissé à 1).
  pen: { color: string; width: number; tool: DrawTool; head1: ArrowHead; head2: ArrowHead; dash: DashStyle; route: RouteStyle; op: number };
  past: BoardItem[][];         // historique UNIFIÉ : snapshots d'`items` (tout le contenu, dessin inclus)
  future: BoardItem[][];       // pile de rétablissement
  save: SaveOpts;              // réglages d'enregistrement auto (Paramètres)
  placeFrame: boolean;         // cadre « zone de pose » (contour du contenu) — activable (Paramètres)
  prefs: BoardPrefs;           // préférences persistées (favoris polices, défauts notes, navigation)
  clipCount: number;           // nombre d'items dans le presse-papiers interne (état des menus)
  dirty: boolean;              // modifications non sauvegardées
  // `sticky` : notice de progression (opération en cours) — pas d'auto-effacement, remplacée
  // par la notice de fin (succès/échec) de l'opération.
  notice: { text: string; kind: "ok" | "error"; sticky?: boolean } | null;

  addItem: (item: Omit<BoardItem, "id" | "z"> & Partial<Pick<BoardItem, "id" | "z">>) => string;
  // `record` (défaut true) : empile une entrée d'historique. Mettre à false pour les MAJ automatiques
  // (durée vidéo sondée, auto-hauteur d'embed, lecture de séquence) qui ne sont pas des actions utilisateur.
  updateItem: (id: string, geom: Partial<Geom>, record?: boolean) => void;
  patchItem: (id: string, patch: Partial<BoardItem>, record?: boolean) => void;
  removeItem: (id: string) => void;
  removeSelected: () => void;
  duplicateItem: (id: string) => void;
  // Duplicates several items at once; the links between them are duplicated with them.
  duplicateItems: (ids: string[]) => void;
  setSeqFrame: (id: string, frame: number) => void;
  commitSeqFrame: (id: string, frame: number) => void;
  groupSequence: (ids: string[]) => void;
  addSequenceFrom: (sourceId: string | null, frames: string[], dims?: { w: number; h: number }, fps?: number) => void;
  selectAll: () => void;
  select: (id: string | null) => void;
  toggleSelect: (id: string) => void;
  selectMany: (ids: string[]) => void;
  // `tag` : coalesce les appels répétés (nudge clavier maintenu) en UNE entrée d'annulation.
  moveBy: (ids: string[], dx: number, dy: number, record?: boolean, tag?: string) => void;
  arrange: (mode: ArrangeMode) => void;
  // Rangement complet de la sélection : uniformisation de taille PUIS disposition, en une entrée.
  tidy: (opts: TidyOpts) => void;
  // Uniformise la taille de la sélection (même hauteur / largeur / surface), centres conservés.
  normalize: (mode: NormalizeMode) => void;
  // Réinitialise les transformations de la sélection (échelle native, rotation, miroirs, rognage).
  reset: (kind: ResetKind) => void;
  // Applique un patch à TOUTE la sélection en une entrée d'historique (opacité, gris, couleur…).
  patchSelected: (patch: Partial<BoardItem>, tag?: string) => void;
  // Ajoute plusieurs items d'un coup (import de dossier, collage multiple) — une seule entrée.
  addItems: (items: BoardItem[], select?: boolean) => string[];
  // Presse-papiers INTERNE du board : survit au changement de scène (copier ici, coller là-bas).
  copySelection: () => number;
  cutSelection: () => number;
  pasteClipboard: (x: number, y: number) => number;
  bringSelectedToFront: () => void;
  sendSelectedToBack: () => void;
  setEditing: (id: string | null) => void;
  requestFocus: (id: string | null) => void;
  setCropping: (id: string | null) => void;
  setStudio: (studio: { targetId: string | null } | null) => void;
  setMouseThrough: (on: boolean) => void;
  setMouseThroughAsk: (on: boolean) => void;
  toggleFrozen: () => void;
  beginNavigation: () => void;
  endNavigation: () => void;
  setDrawMode: (on: boolean) => void;
  setDrawBack: (back: boolean) => void;
  setPen: (p: Partial<BoardState["pen"]>) => void;
  selectDrawShape: (id: string | null) => void;
  selectDrawShapes: (ids: string[]) => void;
  // Résultat d'UN lasso : items et formes de dessin posés ensemble, en une seule écriture. Deux
  // appels séparés se seraient annulés l'un l'autre (chacun vide la sélection de l'autre).
  selectRegion: (itemIds: string[], shapeIds: string[]) => void;
  // `tag` : coalesce les écritures répétées (nudge clavier d'une forme) en UNE entrée d'annulation.
  drawSetShapes: (next: DrawShape[], record?: boolean, tag?: string) => void;
  undo: () => void;
  redo: () => void;
  setBackground: (bg: Partial<BoardBg>) => void;
  setSave: (s: Partial<SaveOpts>) => void;
  setPlaceFrame: (on: boolean) => void;
  setPrefs: (p: Partial<BoardPrefs>) => void;
  toggleFavFont: (font: string) => void;
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
  setView: (view: BoardView) => void;
  setNotice: (n: BoardState["notice"]) => void;
  loadScene: (scene: BoardScene) => void;
  // Folders: fold/unfold a frame, open one, go back up to `depth` (0 = top level), park items in
  // a folder card, pick the card's cover, and fold everything back flat (before sharing).
  openNote: (id: string | null) => void;
  // Shows an item wherever it lives: opens the folders that hold it, then frames and selects it.
  revealItem: (id: string) => void;
  toggleFolder: (id: string) => void;
  enterFolder: (id: string) => void;
  leaveFolder: (depth: number) => void;
  moveIntoFolder: (folderId: string, ids: string[]) => boolean;
  setFolderCover: (itemId: string) => void;
  flattenFolders: () => void;
  newScene: (name?: string) => void;
  clearDirty: () => void;
}

const INITIAL_VIEW: BoardView = { tx: 0, ty: 0, scale: 1 };

// ── Contrôleur d'historique unifié ───────────────────────────────────────────
// Vit HORS du store (état de coalescing, ne doit jamais déclencher de re-render).
// Une entrée = un snapshot du tableau `items` (immutable : chaque mutateur recrée le tableau,
// l'ancienne référence reste un instantané valide → partage structurel, coût quasi nul).
const HISTORY_MAX = 100;
let pendingPast: BoardItem[] | null = null; // snapshot d'`items` capturé au DÉBUT d'une rafale
let burstTag: string | null = null;         // tag de la rafale en cours (coalescing)
let flushQueued = false;                    // un flush micro-tâche est-il programmé
let lastTag: string | null = null;          // tag de la dernière entrée empilée (coalescing cross-tick)
// Folder levels parked when each snapshot was taken: folding moves items between `items` and
// `stash` in one step, so undoing it must give both back together.
const stashAt = new WeakMap<BoardItem[], BoardItem[]>();

// Empile l'instantané en attente dans la pile d'annulation (à la fin du tick courant). Deux mutations
// du MÊME tick (ex. déplacement de groupe : updateItem + moveBy) partagent un seul `pendingPast` → 1 entrée.
function flushHistory() {
  flushQueued = false;
  const snap = pendingPast;
  const tag = burstTag;
  pendingPast = null;
  burstTag = null;
  if (!snap) return;
  useBoard.setState((s) => {
    // Rafale cross-tick de même tag (drag de couleur, frappe au clavier) → garder l'entrée existante.
    if (tag && tag === lastTag && s.past.length) return { future: [] };
    lastTag = tag;
    return { past: [...s.past.slice(-(HISTORY_MAX - 1)), snap], future: [] };
  });
}

// Marque une mutation de contenu : capture l'état AVANT (une fois par rafale) et programme le flush.
function recordHistory(items: BoardItem[], tag: string | null) {
  if (pendingPast == null) {
    pendingPast = items;
    stashAt.set(items, useBoard.getState().stash);
  }
  burstTag = tag;
  if (!flushQueued) {
    flushQueued = true;
    queueMicrotask(flushHistory);
  }
}

// Frontière de coalescing : un changement de sélection/mode termine une rafale tagguée (frappe, couleur)
// pour qu'une édition ultérieure du même item démarre une nouvelle entrée d'annulation.
function resetCoalesce() {
  lastTag = null;
}

// Réinitialise le contrôleur (chargement/nouvelle scène, undo/redo).
function resetHistoryCtl() {
  pendingPast = null;
  burstTag = null;
  flushQueued = false;
  lastTag = null;
}

// Timer d'auto-effacement de la notice (hors store : ne déclenche aucun re-render).
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

// Sélection de dessin VIDE, partagée : une sélection vidée doit garder la même identité de tableau,
// sinon chaque clic sur le fond rerend tous les abonnés pour un « rien » différent du précédent.
const EMPTY_DRAW_SEL: string[] = [];

// Deleting an item takes the links anchored to it along (one undo entry restores both).
function dropLinksOf(items: BoardItem[], removed: ReadonlySet<string>): BoardItem[] {
  const draw = items.find((it) => it.kind === "draw");
  if (!draw?.shapes?.length) return items;
  const shapes = pruneLinks(draw.shapes, removed);
  return shapes === draw.shapes ? items : items.map((it) => (it === draw ? { ...it, shapes } : it));
}

// Presse-papiers INTERNE : vit hors du store pour survivre au chargement d'une autre scène — on
// copie dans un board, on colle dans un autre. `clipCount` en reflète la taille pour l'UI.
let internalClipboard: BoardItem[] = [];
// Links between the copied items, pasted back between their copies.
let internalClipLinks: DrawShape[] = [];

// Copies of the links between remapped items, appended to the drawing layer (created if needed).
function withLinkCopies(items: BoardItem[], links: DrawShape[], idMap: Map<string, string>): BoardItem[] {
  const copies = remapLinks(links, idMap, uid);
  if (!copies.length) return items;
  const draw = items.find((it) => it.kind === "draw");
  if (!draw) return [...items, { ...makeDrawItem(), shapes: copies }];
  return items.map((it) => (it === draw ? { ...it, shapes: [...(it.shapes ?? []), ...copies] } : it));
}

// Recale la sélection/édition sur un jeu d'items restauré (undo/redo) : retire les références mortes.
function reconcile(items: BoardItem[], s: BoardState) {
  const ids = new Set(items.map((i) => i.id));
  const selectedIds = s.selectedIds.filter((id) => ids.has(id));
  const selectedId = s.selectedId && ids.has(s.selectedId) ? s.selectedId : (selectedIds[selectedIds.length - 1] ?? null);
  const editingId = s.editingId && ids.has(s.editingId) ? s.editingId : null;
  const croppingId = s.croppingId && ids.has(s.croppingId) ? s.croppingId : null;
  const shapes = items.find((i) => i.kind === "draw")?.shapes ?? [];
  const shapeIds = new Set(shapes.map((sh) => sh.id));
  const kept = s.drawSel.filter((id) => shapeIds.has(id));
  // Identité préservée quand rien n'est tombé : un nouveau tableau à chaque undo rerendrait tous
  // les abonnés pour une sélection inchangée.
  const drawSel = kept.length === s.drawSel.length ? s.drawSel : kept;
  return { selectedIds, selectedId, editingId, croppingId, drawSel };
}

function isReadOnlyCollaborator(state: Pick<BoardState, "collabProjectId" | "collabRole">): boolean {
  return state.collabProjectId !== null && state.collabRole === "viewer";
}

export const useBoard = create<BoardState>((set, get) => ({
  sceneId: null,
  sceneName: i18n.t("reference:scene.untitled"),
  filePath: null,
  fileReadonly: false,
  collabProjectId: null,
  collabRole: null,
  collabKeyEpoch: 0,
  collabRotationRequired: false,
  collabPeerCandidates: 0,
  collabOfflineQueued: false,
  collabMembers: [],
  items: [],
  stash: [],
  folderPath: [],
  noteOpenId: null,
  view: INITIAL_VIEW,
  background: readBg(),
  selectedId: null,
  selectedIds: [],
  editingId: null,
  focusReq: null,
  croppingId: null,
  studio: null,
  seqFrames: {},
  mouseThrough: false,
  mouseThroughAsk: false,
  frozen: false,
  navigating: false,
  navigationHolds: 0,
  drawMode: false,
  drawBack: false,
  drawSel: EMPTY_DRAW_SEL,
  pen: { color: "#f43f5e", width: 4, tool: "pen", head1: "none", head2: "arrow", dash: "solid", route: "straight", op: 1 },
  past: [],
  future: [],
  save: readSave(),
  placeFrame: readPlaceFrame(),
  prefs: readPrefs(),
  clipCount: 0,
  dirty: false,
  notice: null,

  addItem: (item) => {
    if (isReadOnlyCollaborator(get())) return "";
    const id = item.id ?? uid();
    const z = item.z ?? (topZ(get().items) + 1);
    set((s) => {
      recordHistory(s.items, null);
      return {
        items: [...s.items, { ...item, id, z } as BoardItem],
        selectedId: id,
        selectedIds: [id],
        drawSel: EMPTY_DRAW_SEL,
        dirty: true,
      };
    });
    return id;
  },

  updateItem: (id, geom, record = true) =>
    set((s) => {
      if (isReadOnlyCollaborator(s)) return {};
      // Geste (déplacer/redimensionner/pivoter) : 1 commit au pointerup → 1 entrée discrète.
      if (record) recordHistory(s.items, null);
      return {
        items: s.items.map((it) => (it.id === id ? { ...it, ...geom } : it)),
        dirty: true,
      };
    }),

  patchItem: (id, patch, record = true) =>
    set((s) => {
      if (isReadOnlyCollaborator(s)) return {};
      // Tag = item + champs modifiés → les rafales (drag de couleur, frappe d'une note) se coalescent
      // en une seule entrée d'annulation ; les actions discrètes (clics distincts) restent séparées.
      if (record) recordHistory(s.items, `patch:${id}:${Object.keys(patch).sort().join(",")}`);
      return {
        items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
        dirty: true,
      };
    }),

  removeItem: (id) =>
    set((s) => {
      if (isReadOnlyCollaborator(s)) return {};
      recordHistory(s.items, null);
      return {
        items: dropLinksOf(s.items.filter((it) => it.id !== id), new Set([id])),
        selectedId: s.selectedId === id ? null : s.selectedId,
        selectedIds: s.selectedIds.filter((x) => x !== id),
        dirty: true,
      };
    }),

  removeSelected: () =>
    set((s) => {
      if (isReadOnlyCollaborator(s)) return {};
      const kill = new Set(s.selectedIds);
      recordHistory(s.items, null);
      return {
        items: dropLinksOf(s.items.filter((it) => !kill.has(it.id)), kill),
        selectedId: null,
        selectedIds: [],
        dirty: true,
      };
    }),

  // Duplique un item (décalé) et le sélectionne. Le calque de dessin (singleton) n'est pas dupliqué.
  duplicateItem: (id) =>
    set((s) => {
      if (isReadOnlyCollaborator(s)) return {};
      const src = s.items.find((it) => it.id === id);
      if (!src || src.kind === "draw") return {};
      recordHistory(s.items, null);
      const top = topZ(s.items) + 1;
      const copy: BoardItem = { ...src, id: uid(), x: src.x + 24, y: src.y + 24, z: top };
      return { items: [...s.items, copy], selectedId: copy.id, selectedIds: [copy.id], dirty: true };
    }),

  duplicateItems: (ids) =>
    set((s) => {
      if (isReadOnlyCollaborator(s)) return {};
      const wanted = new Set(ids);
      const picked = s.items.filter((it) => wanted.has(it.id) && it.kind !== "draw");
      if (!picked.length) return {};
      recordHistory(s.items, null);
      let z = topZ(s.items);
      const idMap = new Map<string, string>();
      const copies = picked.map((src) => {
        const id = uid();
        idMap.set(src.id, id);
        return { ...src, id, x: src.x + 24, y: src.y + 24, z: ++z };
      });
      const shapes = s.items.find((it) => it.kind === "draw")?.shapes ?? [];
      const items = withLinkCopies([...s.items, ...copies], linksWithin(shapes, wanted), idMap);
      const sel = copies.map((c) => c.id);
      return { items, selectedIds: sel, selectedId: sel[sel.length - 1] ?? null, drawSel: EMPTY_DRAW_SEL, dirty: true };
    }),

  // Frame courante d'une séquence (lecteur). NE marque PAS `dirty` : l'avance auto à 12 fps
  // déclencherait l'autosave en boucle et persisterait un index mi-animation. La frame réelle est
  // capturée au prochain enregistrement (action utilisateur).
  // Avance de lecture : n'écrit QUE la frame vivante (cf. `seqFrames`). Ni `items`, ni `dirty`.
  setSeqFrame: (id, frame) =>
    set((s) => (s.seqFrames[id] === frame ? s : { seqFrames: { ...s.seqFrames, [id]: frame } })),

  // Fixe la frame vivante DANS le document (fin de lecture, saut manuel) puis oublie l'entrée vivante
  // — sans quoi elle masquerait la valeur du document au rendu suivant.
  commitSeqFrame: (id, frame) =>
    set((s) => {
      if (isReadOnlyCollaborator(s)) return {};
      const { [id]: _live, ...rest } = s.seqFrames;
      return {
        seqFrames: rest,
        items: s.items.map((it) => (it.id === id ? { ...it, frame } : it)),
      };
    }),

  // Fusionne ≥2 items image sélectionnés en une séquence (frames = leurs refs, ordre gauche→droite).
  // La séquence prend la géométrie du 1er item ; les sources sont retirées.
  groupSequence: (ids) =>
    set((s) => {
      if (isReadOnlyCollaborator(s)) return {};
      const picked = s.items.filter((it) => ids.includes(it.id) && it.kind === "image");
      if (picked.length < 2) return {};
      const ordered = [...picked].sort((a, b) => a.x - b.x || a.y - b.y);
      const frames = ordered.map((it) => it.ref).filter(Boolean);
      if (frames.length < 2) return {};
      recordHistory(s.items, null);
      const first = ordered[0];
      const top = topZ(s.items) + 1;
      const seq: BoardItem = {
        id: uid(), kind: "sequence", ref: frames[0], src: "",
        x: first.x, y: first.y, w: first.w, h: first.h, rotation: 0, z: top,
        natW: first.natW, natH: first.natH,
        frames, frame: 0, fps: 12, speed: 1, seqPlay: false,
        title: first.title,
      };
      const kill = new Set(ids);
      return {
        items: [...s.items.filter((it) => !kill.has(it.id)), seq],
        selectedId: seq.id, selectedIds: [seq.id], drawSel: EMPTY_DRAW_SEL, dirty: true,
      };
    }),

  // Transforme l'item source (vidéo) EN SÉQUENCE, EN PLACE — même id, plan et centre : la séquence
  // apparaît SUR l'original, AUCUN doublon. La taille suit le RATIO RÉEL des frames (`dims`, sondé sur
  // la 1re image, recentré) → pas de déformation/rognage. Les champs propres à la vidéo (boucle, durée,
  // mode de lecture, rognage) sont effacés. Sans source → ajout d'un nouvel item (repli).
  addSequenceFrom: (sourceId, frames, dims, fps) =>
    set((s) => {
      if (isReadOnlyCollaborator(s)) return {};
      const fr = (frames || []).filter(Boolean);
      if (!fr.length) return {};
      recordHistory(s.items, null);
      // fps de LECTURE = fps de CAPTURE → le mouvement joue en temps réel (sinon capture 8 / lecture 12
      // = vitesse fausse + saccades). Repli 12 (séquence d'images simples, sans cadence source).
      const playFps = fps && fps > 0 ? fps : 12;
      const src = sourceId ? s.items.find((it) => it.id === sourceId) ?? null : null;
      if (!src) {
        const top = topZ(s.items) + 1;
        const fit = dims && dims.w > 0 && dims.h > 0 ? fitSize(dims.w, dims.h) : { w: 320, h: 180 };
        const seq: BoardItem = {
          id: uid(), kind: "sequence", ref: fr[0], src: "",
          x: 120, y: 120, w: fit.w, h: fit.h, rotation: 0, z: top,
          natW: dims?.w, natH: dims?.h, frames: fr, frame: 0, fps: playFps, speed: 1, seqPlay: true,
        };
        return { items: [...s.items, seq], selectedId: seq.id, selectedIds: [seq.id], drawSel: EMPTY_DRAW_SEL, dirty: true };
      }
      const fit = dims && dims.w > 0 && dims.h > 0 ? fitSize(dims.w, dims.h) : { w: src.w, h: src.h };
      const cx = src.x + src.w / 2, cy = src.y + src.h / 2; // recentre quand le ratio change
      const next: BoardItem = {
        ...src,
        kind: "sequence", ref: fr[0], src: "",
        x: cx - fit.w / 2, y: cy - fit.h / 2, w: fit.w, h: fit.h,
        natW: dims?.w ?? src.natW, natH: dims?.h ?? src.natH,
        frames: fr, frame: 0, fps: playFps, speed: 1, seqPlay: true,
        crop: undefined, trimIn: undefined, trimOut: undefined, playMode: undefined, dur: undefined,
        seqIn: undefined, seqOut: undefined,
        // Mémorise l'original (vidéo/YouTube) pour le bouton « revenir à l'original ».
        prevMedia: { kind: src.kind, ref: src.ref, src: src.src, trimIn: src.trimIn, trimOut: src.trimOut, crop: src.crop, sourceUrl: src.sourceUrl },
      };
      return {
        items: s.items.map((it) => (it.id === src.id ? next : it)),
        selectedId: src.id, selectedIds: [src.id], drawSel: EMPTY_DRAW_SEL, dirty: true,
      };
    }),

  selectAll: () => {
    resetCoalesce();
    set((s) => {
      const ids = s.items.filter((it) => it.kind !== "draw").map((it) => it.id);
      return { selectedIds: ids, selectedId: ids[ids.length - 1] ?? null, editingId: null, drawSel: EMPTY_DRAW_SEL };
    });
  },

  // Sélection d'item → vide la sélection de forme de dessin (et inversement) : exclusion mutuelle.
  select: (id) => {
    resetCoalesce();
    set({ selectedId: id, selectedIds: id ? [id] : [], editingId: null, drawSel: EMPTY_DRAW_SEL });
  },

  toggleSelect: (id) => {
    resetCoalesce();
    set((s) => {
      const has = s.selectedIds.includes(id);
      const ids = has ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id];
      return { selectedIds: ids, selectedId: has ? (ids[ids.length - 1] ?? null) : id, drawSel: EMPTY_DRAW_SEL };
    });
  },

  selectMany: (ids) => {
    resetCoalesce();
    set({ selectedIds: ids, selectedId: ids[ids.length - 1] ?? null, editingId: null, drawSel: EMPTY_DRAW_SEL });
  },

  moveBy: (ids, dx, dy, record = true, tag) =>
    set((s) => {
      if (isReadOnlyCollaborator(s)) return {};
      const move = new Set(ids);
      if (record) recordHistory(s.items, tag ?? null);
      return {
        items: s.items.map((it) => (move.has(it.id) ? { ...it, x: it.x + dx, y: it.y + dy } : it)),
        dirty: true,
      };
    }),

  // Les boutons d'alignement/répartition partagent l'écart du sélecteur de rangement : régler
  // « collé » (écart 0) doit valoir pour TOUS les gestes de mise en ordre, pas seulement « Ranger ».
  arrange: (mode) => get().tidy({ layout: mode, gap: get().prefs.arrangeGap }),

  // Uniformisation PUIS disposition : les deux passes partagent un seul instantané d'historique,
  // sinon « ranger » coûterait deux Ctrl+Z pour un seul geste utilisateur.
  tidy: ({ layout, uniform, gap, sort, base, tag }) =>
    set((s) => {
      if (isReadOnlyCollaborator(s)) return {};
      if (tidyUnits(s.items, s.selectedIds).length < 2) return {};
      recordHistory(s.items, tag ?? null);

      // Retour au point de départ avant de ranger : le sélecteur rejoue depuis la même planche à
      // chaque changement de réglage.
      const from = base
        ? s.items.map((it) => (base.has(it.id) ? { ...it, ...base.get(it.id)! } : it))
        : s.items;
      const picked = tidyUnits(from, s.selectedIds);

      let sel = picked;
      let items = from;
      if (uniform && uniform !== "none") {
        const size = computeNormalize(sel.filter((it) => it.kind !== "frame" || it.folder), uniform);
        if (size.size) {
          items = items.map((it) => (size.has(it.id) ? { ...it, ...size.get(it.id)! } : it));
          sel = items.filter((it) => size.has(it.id) || sel.some((p) => p.id === it.id));
        }
      }

      // `keepSize` : une taille commune vient d'être imposée, le rangement ne doit pas la défaire.
      // A frame cannot be scaled like a picture: with one in the lot, blocks are placed, not resized.
      const hasFrame = sel.some((it) => it.kind === "frame" && !it.folder);
      const keepSize = hasFrame || (!!uniform && uniform !== "none");
      const pos = computeArrange(sel, layout, { gap, sort, keepSize, locale: uiLocale() });
      if (!pos.size && items === s.items) return {};
      return { items: placeUnits(items, pos), dirty: true };
    }),

  normalize: (mode) =>
    set((s) => {
      if (isReadOnlyCollaborator(s)) return {};
      // A frame is a container, not a picture: it keeps its size.
      const sel = tidyUnits(s.items, s.selectedIds).filter((it) => it.kind !== "frame" || it.folder);
      const size = computeNormalize(sel, mode);
      if (!size.size) return {};
      recordHistory(s.items, null);
      return {
        items: s.items.map((it) => (size.has(it.id) ? { ...it, ...size.get(it.id)! } : it)),
        dirty: true,
      };
    }),

  // Réinitialisations : toujours à CENTRE CONSTANT. « scale » = retour à la taille native 1:1 (sans
  // ratio natif connu, l'item est laissé tel quel) ; « crop » restaure aussi le ratio d'origine,
  // puisque notre rognage est exprimé en fractions du média et déforme donc la boîte affichée.
  reset: (kind) =>
    set((s) => {
      if (isReadOnlyCollaborator(s)) return {};
      const ids = new Set(s.selectedIds);
      if (!ids.size) return {};
      const all = kind === "all";
      let touched = false;
      const items = s.items.map((it) => {
        if (!ids.has(it.id) || it.kind === "draw") return it;
        const next: BoardItem = { ...it };
        const cx = it.x + it.w / 2;
        const cy = it.y + it.h / 2;
        if ((all || kind === "rotation") && it.rotation) next.rotation = 0;
        if ((all || kind === "flip") && (it.flipH || it.flipV)) { next.flipH = false; next.flipV = false; }
        if ((all || kind === "crop") && it.crop) {
          next.crop = undefined;
          if (it.natW && it.natH) next.h = (next.w * it.natH) / it.natW;
        }
        if ((all || kind === "scale") && it.natW && it.natH) { next.w = it.natW; next.h = it.natH; }
        next.x = cx - next.w / 2;
        next.y = cy - next.h / 2;
        if (next.w !== it.w || next.h !== it.h || next.x !== it.x || next.y !== it.y
          || next.rotation !== it.rotation || next.flipH !== it.flipH || next.flipV !== it.flipV
          || next.crop !== it.crop) touched = true;
        return next;
      });
      if (!touched) return {};
      recordHistory(s.items, null);
      return { items, dirty: true };
    }),

  patchSelected: (patch, tag) =>
    set((s) => {
      if (isReadOnlyCollaborator(s)) return {};
      const ids = new Set(s.selectedIds);
      if (!ids.size) return {};
      recordHistory(s.items, tag ?? null);
      return {
        items: s.items.map((it) => (ids.has(it.id) ? { ...it, ...patch } : it)),
        dirty: true,
      };
    }),

  addItems: (list, select = true) => {
    if (isReadOnlyCollaborator(get())) return [];
    if (!list.length) return [];
    const ids: string[] = [];
    set((s) => {
      recordHistory(s.items, null);
      let z = topZ(s.items);
      const added = list.map((it) => {
        const id = it.id || uid();
        ids.push(id);
        return { ...it, id, z: it.z ?? ++z } as BoardItem;
      });
      return {
        items: [...s.items, ...added],
        ...(select ? { selectedIds: ids, selectedId: ids[ids.length - 1] ?? null, drawSel: EMPTY_DRAW_SEL } : {}),
        dirty: true,
      };
    });
    return ids;
  },

  copySelection: () => {
    const s = get();
    const picked = s.items.filter((it) => s.selectedIds.includes(it.id) && it.kind !== "draw");
    internalClipboard = picked.map((it) => ({ ...it }));
    const shapes = s.items.find((it) => it.kind === "draw")?.shapes ?? [];
    internalClipLinks = linksWithin(shapes, new Set(picked.map((it) => it.id))).map((l) => ({ ...l }));
    set({ clipCount: internalClipboard.length });
    return internalClipboard.length;
  },

  cutSelection: () => {
    if (isReadOnlyCollaborator(get())) return 0;
    const n = get().copySelection();
    if (n) get().removeSelected();
    return n;
  },

  // Colle le presse-papiers interne en gardant les positions RELATIVES du groupe copié, recentré
  // sur le point demandé (curseur). Les items collés deviennent la sélection.
  pasteClipboard: (x, y) => {
    if (isReadOnlyCollaborator(get())) return 0;
    if (!internalClipboard.length) return 0;
    const src = internalClipboard;
    const minX = Math.min(...src.map((it) => it.x));
    const minY = Math.min(...src.map((it) => it.y));
    const maxX = Math.max(...src.map((it) => it.x + it.w));
    const maxY = Math.max(...src.map((it) => it.y + it.h));
    const dx = x - (minX + maxX) / 2;
    const dy = y - (minY + maxY) / 2;
    const idMap = new Map(src.map((it) => [it.id, uid()]));
    get().addItems(src.map((it) => ({ ...it, id: idMap.get(it.id)!, x: it.x + dx, y: it.y + dy })));
    // Same tick as addItems: the links join its history entry.
    if (internalClipLinks.length) set((s) => ({ items: withLinkCopies(s.items, internalClipLinks, idMap) }));
    return src.length;
  },

  bringSelectedToFront: () =>
    set((s) => {
      if (isReadOnlyCollaborator(s)) return {};
      const ids = new Set(s.selectedIds);
      if (!ids.size) return {};
      recordHistory(s.items, null);
      let z = topZ(s.items);
      return { items: s.items.map((it) => (ids.has(it.id) ? { ...it, z: ++z } : it)), dirty: true };
    }),

  sendSelectedToBack: () =>
    set((s) => {
      if (isReadOnlyCollaborator(s)) return {};
      const ids = new Set(s.selectedIds);
      if (!ids.size) return {};
      recordHistory(s.items, null);
      let z = bottomZ(s.items);
      return { items: s.items.map((it) => (ids.has(it.id) ? { ...it, z: --z } : it)), dirty: true };
    }),

  setEditing: (id) => {
    // A note sheet is written in its full-size editor; a text note or block is written in place.
    const target = id ? get().items.find((it) => it.id === id) : undefined;
    if (id && target && noteMode(target) === "sheet") {
      get().openNote(id);
      return;
    }
    if (id && isReadOnlyCollaborator(get())) return;
    resetCoalesce();
    set({ editingId: id });
  },
  // Demande de centrage/zoom sur un item (double-clic) ; le board la consomme puis remet à null.
  requestFocus: (id) => set({ focusReq: id }),
  setCropping: (id) => {
    if (id && isReadOnlyCollaborator(get())) return;
    resetCoalesce();
    set({ croppingId: id });
  },
  setStudio: (studio) => {
    if (studio && isReadOnlyCollaborator(get())) return;
    set({ studio });
  },
  setMouseThrough: (on) => set({ mouseThrough: on }),
  setMouseThroughAsk: (on) => set({ mouseThroughAsk: on }),
  toggleFrozen: () => set((s) => ({ frozen: !s.frozen })),
  beginNavigation: () => set((s) => ({ navigationHolds: s.navigationHolds + 1, navigating: true })),
  endNavigation: () => set((s) => {
    const navigationHolds = Math.max(0, s.navigationHolds - 1);
    return { navigationHolds, navigating: navigationHolds > 0 };
  }),
  setDrawMode: (on) => {
    if (on && isReadOnlyCollaborator(get())) return;
    // The shared document has one drawing layer, the board's top level one.
    if (on && get().collabProjectId && get().folderPath.length) {
      get().setNotice({ kind: "error", text: i18n.t("reference:folder.drawTopLevel") });
      return;
    }
    resetCoalesce();
    set((s) => ({
      drawMode: on, selectedId: null, selectedIds: [], editingId: null, drawSel: EMPTY_DRAW_SEL,
      // plus d'outil souris : à l'entrée, tomber sur le stylo si l'état portait encore "select".
      pen: on && s.pen.tool === "select" ? { ...s.pen, tool: "pen" } : s.pen,
    }));
  },
  setDrawBack: (back) => {
    if (isReadOnlyCollaborator(get())) return;
    set({ drawBack: back, dirty: true });
  },
  setPen: (p) => set((s) => ({ pen: { ...s.pen, ...p } })),

  // Sélectionne une forme de dessin (handles + inspecteur) → vide la sélection d'items.
  selectDrawShape: (id) => { resetCoalesce(); set({ drawSel: id ? [id] : EMPTY_DRAW_SEL, selectedId: null, selectedIds: [], editingId: null }); },

  selectDrawShapes: (ids) => {
    resetCoalesce();
    set({ drawSel: ids.length ? ids : EMPTY_DRAW_SEL, selectedId: null, selectedIds: [], editingId: null });
  },

  // Un lasso ne connaît pas la frontière items/dessin : il pose les deux, et l'exclusion mutuelle
  // ne vaut qu'entre deux sélections faites SÉPARÉMENT.
  selectRegion: (itemIds, shapeIds) => {
    resetCoalesce();
    set({
      selectedIds: itemIds,
      selectedId: itemIds[itemIds.length - 1] ?? null,
      drawSel: shapeIds.length ? shapeIds : EMPTY_DRAW_SEL,
      editingId: null,
    });
  },

  // Écrit les formes du calque dessin (item singleton, créé au besoin). `record` empile une entrée
  // dans l'historique UNIFIÉ — passé à false pour les mises à jour live (drag du stylo, etc.).
  drawSetShapes: (next, record = true, tag) =>
    set((s) => {
      if (isReadOnlyCollaborator(s)) return {};
      if (record) recordHistory(s.items, tag ?? null);
      const item = s.items.find((i) => i.kind === "draw");
      const items = item
        ? s.items.map((it) => (it.id === item.id ? { ...it, shapes: next } : it))
        : [...s.items, { ...makeDrawItem(), shapes: next }];
      return { items, dirty: true };
    }),

  // Annuler / Rétablir UNIFIÉS : restaurent un snapshot complet d'`items` (médias, texte, cadres,
  // séquences ET dessin). La sélection est recalée sur le contenu restauré (références mortes retirées).
  undo: () =>
    set((s) => {
      if (isReadOnlyCollaborator(s)) return {};
      if (!s.past.length) return {};
      resetHistoryCtl();
      const prev = s.past[s.past.length - 1];
      stashAt.set(s.items, s.stash);
      return {
        items: prev,
        stash: stashAt.get(prev) ?? s.stash,
        past: s.past.slice(0, -1),
        future: [...s.future, s.items],
        dirty: true,
        ...reconcile(prev, s),
      };
    }),

  redo: () =>
    set((s) => {
      if (isReadOnlyCollaborator(s)) return {};
      if (!s.future.length) return {};
      resetHistoryCtl();
      const next = s.future[s.future.length - 1];
      stashAt.set(s.items, s.stash);
      return {
        items: next,
        stash: stashAt.get(next) ?? s.stash,
        past: [...s.past, s.items],
        future: s.future.slice(0, -1),
        dirty: true,
        ...reconcile(next, s),
      };
    }),

  setBackground: (bg) =>
    set((s) => {
      const next = { ...s.background, ...bg };
      try { localStorage.setItem(BG_KEY, JSON.stringify(next)); } catch { /* best-effort */ }
      return { background: next };
    }),

  setSave: (patch) =>
    set((s) => {
      const next = { ...s.save, ...patch };
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(next)); } catch { /* best-effort */ }
      return { save: next };
    }),

  setPlaceFrame: (on) => {
    try { localStorage.setItem(PLACE_KEY, on ? "1" : "0"); } catch { /* best-effort */ }
    set({ placeFrame: on });
  },

  setPrefs: (patch) =>
    set((s) => {
      const next = { ...s.prefs, ...patch };
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* best-effort */ }
      return { prefs: next };
    }),

  // Bascule une police dans les favoris (épinglée en tête du FontPicker).
  toggleFavFont: (font) =>
    set((s) => {
      const has = s.prefs.favFonts.includes(font);
      const favFonts = has ? s.prefs.favFonts.filter((f) => f !== font) : [...s.prefs.favFonts, font];
      const next = { ...s.prefs, favFonts };
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* best-effort */ }
      return { prefs: next };
    }),

  bringToFront: (id) =>
    set((s) => {
      if (isReadOnlyCollaborator(s)) return {};
      recordHistory(s.items, null);
      const top = topZ(s.items);
      return { items: s.items.map((it) => (it.id === id ? { ...it, z: top + 1 } : it)), dirty: true };
    }),

  sendToBack: (id) =>
    set((s) => {
      if (isReadOnlyCollaborator(s)) return {};
      recordHistory(s.items, null);
      const bottom = bottomZ(s.items);
      return { items: s.items.map((it) => (it.id === id ? { ...it, z: bottom - 1 } : it)), dirty: true };
    }),

  setView: (view) =>
    set({ view: { ...view, scale: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.scale)) } }),

  // Notice auto-effacée : erreurs affichées plus longtemps que les confirmations. Le timer est
  // centralisé ici (annulé/reprogrammé à chaque notice) — les appelants ne gèrent rien.
  setNotice: (notice) => {
    if (noticeTimer) { clearTimeout(noticeTimer); noticeTimer = null; }
    if (notice && !notice.sticky) {
      noticeTimer = setTimeout(() => {
        noticeTimer = null;
        useBoard.setState({ notice: null });
      }, notice.kind === "error" ? 5000 : 2600);
    }
    set({ notice });
  },

  loadScene: (scene) => {
    resetHistoryCtl();
    set({
      sceneId: scene.id,
      sceneName: scene.name,
      filePath: scene.filePath ?? null,
      fileReadonly: !!scene.fileReadonly,
      collabProjectId: scene.collaboration?.projectId ?? null,
      collabRole: null,
      collabKeyEpoch: 0,
      collabRotationRequired: false,
      collabPeerCandidates: 0,
      collabMembers: [],
      collabOfflineQueued: false,
      ...splitLevel(scene.items, null),
      folderPath: [],
      noteOpenId: null,
      seqFrames: {},   // positions vivantes de la scène précédente : jamais reportées sur la nouvelle
      view: scene.view ?? INITIAL_VIEW,
      selectedId: null,
      selectedIds: [],
      editingId: null,
      croppingId: null,
      studio: null,
      drawMode: false,
      drawBack: false,
      drawSel: EMPTY_DRAW_SEL,
      past: [],
      future: [],
      dirty: false,
    });
  },

  newScene: (name = i18n.t("reference:scene.untitled")) => {
    resetHistoryCtl();
    set({ sceneId: null, sceneName: name, filePath: null, fileReadonly: false, collabProjectId: null, collabRole: null, collabKeyEpoch: 0, collabRotationRequired: false, collabPeerCandidates: 0, collabOfflineQueued: false, items: [], stash: [], folderPath: [], noteOpenId: null, view: INITIAL_VIEW, selectedId: null, selectedIds: [], editingId: null, croppingId: null, studio: null, drawMode: false, drawBack: false, drawSel: EMPTY_DRAW_SEL, past: [], future: [], dirty: false });
  },

  openNote: (id) => set({ noteOpenId: id, editingId: null }),

  revealItem: (id) => {
    const s = get();
    const all = sceneItems(s.items, s.stash, currentFolder(s));
    const byId = new Map(all.map((it) => [it.id, it]));
    const target = byId.get(id);
    if (!target) return;
    const chain: string[] = [];
    for (let p = target.parent, guard = 0; p && guard < 64; guard++) {
      chain.unshift(p);
      p = byId.get(p)?.parent;
    }
    const path = s.folderPath.map((f) => f.id);
    const same = path.length === chain.length && path.every((f, i) => f === chain[i]);
    if (!same) {
      if (path.length) get().leaveFolder(0);
      for (const f of chain) get().enterFolder(f);
    }
    get().select(id);
    get().requestFocus(id);
  },

  toggleFolder: (id) =>
    set((s) => {
      if (isReadOnlyCollaborator(s)) return {};
      const frame = s.items.find((it) => it.id === id && it.kind === "frame");
      if (!frame) return {};
      recordHistory(s.items, null);
      const next = frame.folder ? unfoldFrame(frame, s.items, s.stash) : foldFrame(frame, s.items, s.stash);
      return { ...next, ...reconcile(next.items, s), dirty: true };
    }),

  enterFolder: (id) =>
    set((s) => {
      const folder = s.items.find((it) => it.id === id && it.folder);
      if (!folder) return {};
      const from = currentFolder(s) ?? null;
      return {
        ...switchLevel(s.items, s.stash, from, id),
        ...levelReset(),
        folderPath: [...s.folderPath, { id, view: s.view }],
      };
    }),

  leaveFolder: (depth) =>
    set((s) => {
      if (depth < 0 || depth >= s.folderPath.length) return {};
      const from = s.folderPath[s.folderPath.length - 1].id;
      const to = depth ? s.folderPath[depth - 1].id : null;
      return {
        ...switchLevel(s.items, s.stash, from, to),
        ...levelReset(),
        folderPath: s.folderPath.slice(0, depth),
        view: s.folderPath[depth].view,
      };
    }),

  moveIntoFolder: (folderId, ids) => {
    const s = get();
    if (isReadOnlyCollaborator(s)) return false;
    const next = parkInto(folderId, ids, s.items, s.stash);
    if (!next) return false;
    set((st) => {
      recordHistory(st.items, null);
      return { ...next, ...reconcile(next.items, st), dirty: true };
    });
    return true;
  },

  setFolderCover: (itemId) =>
    set((s) => {
      const folderId = currentFolder(s);
      if (!folderId || isReadOnlyCollaborator(s)) return {};
      return {
        stash: s.stash.map((it) => (it.id === folderId ? { ...it, cover: itemId } : it)),
        dirty: true,
      };
    }),

  // Back to the top level with every folder unfolded, innermost first.
  flattenFolders: () =>
    set((s) => {
      if (!s.stash.length && !s.items.some((it) => it.folder)) return {};
      const from = currentFolder(s) ?? null;
      let level = switchLevel(s.items, s.stash, from, null);
      for (let guard = 0; guard < 10_000; guard++) {
        const folder = level.items.find((it) => it.folder);
        if (!folder) break;
        level = unfoldFrame(folder, level.items, level.stash);
      }
      return {
        items: sceneItems(level.items, level.stash, null),
        stash: [],
        folderPath: [],
        view: s.folderPath[0]?.view ?? s.view,
        ...levelReset(),
      };
    }),

  clearDirty: () => set({ dirty: false }),
}));

// Blocks moved by « Ranger »: a selected frame moves as one block with its content, so the items it
// holds are not arranged on their own.
function tidyUnits(items: BoardItem[], selectedIds: string[]): BoardItem[] {
  const ids = new Set(selectedIds);
  const carried = new Set<string>();
  for (const it of items) {
    if (it.kind === "frame" && !it.folder && ids.has(it.id)) for (const id of frameContentIds(it, items)) carried.add(id);
  }
  return items.filter((it) => ids.has(it.id) && it.kind !== "draw" && !carried.has(it.id));
}

// Applies arranged positions. A frame only moves (size kept) and takes its content along.
function placeUnits(items: BoardItem[], pos: Map<string, Partial<BoardItem>>): BoardItem[] {
  const shift = new Map<string, { dx: number; dy: number }>();
  for (const it of items) {
    const p = pos.get(it.id);
    if (!p || it.kind !== "frame" || it.folder) continue;
    const dx = (p.x ?? it.x) - it.x, dy = (p.y ?? it.y) - it.y;
    for (const id of frameContentIds(it, items)) shift.set(id, { dx, dy });
    shift.set(it.id, { dx, dy });
  }
  return items.map((it) => {
    const d = shift.get(it.id);
    if (d) return d.dx || d.dy ? { ...it, x: it.x + d.dx, y: it.y + d.dy } : it;
    const p = pos.get(it.id);
    return p ? { ...it, ...p } : it;
  });
}

const currentFolder = (s: Pick<BoardState, "folderPath">): string | null =>
  s.folderPath.length ? s.folderPath[s.folderPath.length - 1].id : null;

// State dropped when the level on screen changes: selections and edits point at items that are
// no longer shown, and the undo history holds snapshots of the level that was left.
function levelReset() {
  resetHistoryCtl();
  return {
    selectedId: null,
    selectedIds: [],
    editingId: null,
    croppingId: null,
    noteOpenId: null,
    drawSel: EMPTY_DRAW_SEL,
    drawMode: false,
    past: [],
    future: [],
  };
}

// Barre d'outils du board. Trois zones : à GAUCHE ce qui pose et regarde (ajout, zoom, cadrage,
// gel), au CENTRE le nom du projet et son état (modifié, notice), à DROITE ce qui touche au
// DOCUMENT (annuler/rétablir, nouvelle scène, enregistrer, ouvrir, partager) puis la fenêtre
// (réglages, épingle, détacher). Le partage est un menu : le projet lui-même, ou une image de la scène.
//
// Les DEUX barres se disposent dans les Paramètres (`barButtons` / `pinnedButtons`, deux extrémités
// chacune) ; `compact` est la version épinglée, qui choisit en plus son bord. Épingler, détacher et
// rattacher n'en font jamais partie : ce sont les sorties du format.

import { lazy, Suspense, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { ShortcutTip } from "@/components/ui/kbd";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { convexConfigured } from "@/lib/convexEnv";
import { useBoard } from "./useReferenceBoard";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import {
  AddTextGlyph, AddBlockGlyph, AddFrameGlyph, DrawToggleGlyph, PaletteStudioGlyph, ExtractPaletteGlyph,
  TidyGlyph, SnapGlyph, ZoomOutGlyph, ZoomInGlyph, FitAllGlyph, FreezeGlyph, UndoGlyph, RedoGlyph,
  MouseThroughGlyph, SettingsGlyph, SaveGlyph, SaveAsGlyph, OpenSceneGlyph, NewSceneGlyph,
  HomeGlyph, PinWindowGlyph, DetachGlyph, AttachGlyph, type Glyph, type GlyphProps,
} from "./netsuIcons";

// LAZY, and mounted only while open: this dialog pulls `convex/react`, which must stay out of the
// entry chunk of an app that opens without a backend — and its hooks would throw outside the Convex
// provider, which does not exist when no deployment is configured.
// Pastille d'état d'un board partagé. Lazy comme le dialogue : la chaîne convex/react ne doit pas
// entrer dans le bundle de démarrage (cf. src/lib/convexEnv.ts).
const CollabStatus = lazy(() =>
  import("./CollabStatus").then((module) => ({ default: module.CollabStatus })),
);
const CollaborationDialog = lazy(() =>
  import("./CollaborationDialog").then((module) => ({ default: module.CollaborationDialog })),
);
import { fileLabel } from "./useScenePersistence";
import { recoverAllOnlineMedia } from "./boardMediaActions";
import { countRecoverableOnlineItems } from "./boardMediaRecovery";
import { ExportImageDialog } from "./ExportImageDialog";
import { askMouseThrough, setMouseThrough } from "./boardMouseThrough";
import { extractPaletteToBoard } from "./boardPaletteActions";
import { isVerticalSide, type PinnedButtonId } from "./toolbarButtons";
import type { BoardHandle } from "./ReferenceBoard";
import type { ShortcutAction } from "./referenceShared";

// `action` = raccourci-commande qui fait la MÊME chose : sa touche paraît dans l'infobulle, lue dans
// les préférences (un rebind se voit tout de suite).
function IconBtn({ icon: Icon, iconProps, label, onClick, disabled, active, action }: {
  icon: Glyph; iconProps?: Omit<GlyphProps, "className">; label: string; onClick: () => void;
  disabled?: boolean; active?: boolean; action?: ShortcutAction;
}) {
  const combo = useBoard((s) => (action ? s.prefs.shortcutKeys[action] : ""));
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant={active ? "default" : "ghost"} size="icon-sm" onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={active} />
        }
      >
        <Icon {...iconProps} />
      </TooltipTrigger>
      <TooltipContent>
        <ShortcutTip label={label} combo={combo} />
      </TooltipContent>
    </Tooltip>
  );
}

export function Toolbar({
  board,
  onHome,
  onSave,
  onSaveAs,
  onOpen,
  onDetach,
  onAttach,
  onSettings,
  onExport,
  pinned,
  onTogglePin,
  draggable,
  compact,
  className,
}: {
  board: RefObject<BoardHandle | null>;
  onHome?: () => void;
  onSave?: () => void;
  onSaveAs?: () => void;
  onOpen?: () => void;
  onDetach?: () => void;
  onAttach?: () => void;
  onSettings?: () => void;
  onExport?: () => void;
  pinned?: boolean;
  onTogglePin?: () => void;
  draggable?: boolean; // fenêtre détachée sans cadre : la barre sert de zone de déplacement
  compact?: boolean;   // fenêtre épinglée : outils de planche seulement, le document reste au clic droit
  className?: string;
}) {
  const { t } = useTranslation("reference");
  const sceneName = useBoard((s) => s.sceneName);
  const filePath = useBoard((s) => s.filePath);
  const dirty = useBoard((s) => s.dirty);
  const notice = useBoard((s) => s.notice);
  const frozen = useBoard((s) => s.frozen);
  const toggleFrozen = useBoard((s) => s.toggleFrozen);
  const drawMode = useBoard((s) => s.drawMode);
  const setDrawMode = useBoard((s) => s.setDrawMode);
  const newScene = useBoard((s) => s.newScene);
  const undo = useBoard((s) => s.undo);
  const redo = useBoard((s) => s.redo);
  const canUndo = useBoard((s) => s.past.length > 0);
  const canRedo = useBoard((s) => s.future.length > 0);
  const [recovering, setRecovering] = useState(false);
  const [imgExport, setImgExport] = useState(false);
  const [collab, setCollab] = useState(false);
  const mouseThrough = useBoard((s) => s.mouseThrough);
  const prefs = useBoard((s) => s.prefs);
  const askOpen = useBoard((s) => s.mouseThroughAsk);
  const setAskOpen = useBoard((s) => s.setMouseThroughAsk);
  const setStudio = useBoard((s) => s.setStudio);
  // Scalars, not the item list: the toolbar must not re-render (and re-scan the board) on every item
  // commit, note keystroke or sequence step. `some` stops at the first match.
  const recoverableCount = useBoard((s) => countRecoverableOnlineItems(s.items));
  const hasItems = useBoard((s) => s.items.some((i) => i.kind !== "draw"));
  const snap = useBoard((s) => s.prefs.snap);
  const setPrefs = useBoard((s) => s.setPrefs);
  const readOnly = useBoard((s) => s.collabProjectId !== null && s.collabRole === "viewer");
  const rotationRequired = useBoard((s) => s.collabRotationRequired);
  const syncQueued = useBoard((s) => s.collabOfflineQueued);
  const shared = useBoard((s) => s.collabProjectId !== null);

  // Choisir un autre outil/ajout quitte le mode dessin (revient au curseur normal).
  const leaveDraw = () => { if (useBoard.getState().drawMode) setDrawMode(false); };
  // Rangement : les réglages mémorisés du sélecteur « Ranger », comme le raccourci.
  const tidySelection = () => {
    const st = useBoard.getState();
    st.tidy({ layout: st.prefs.arrangeLayout, uniform: st.prefs.arrangeUniform, gap: st.prefs.arrangeGap, sort: st.prefs.arrangeSort });
  };
  const retryMissing = async () => {
    if (recovering) return;
    setRecovering(true);
    try {
      const result = await recoverAllOnlineMedia();
      if (result.recovered > 0) onSave?.();
      useBoard.getState().setNotice({
        kind: result.failed ? "error" : "ok",
        text: t("notice.recoveryResult", result),
      });
    } finally {
      setRecovering(false);
    }
  };

  // Boutons adressables par les deux barres : une seule définition, jamais deux à garder d'accord.
  const B: Record<PinnedButtonId, React.ReactNode> = {
    text: <IconBtn icon={AddTextGlyph} label={t("toolbar.addText")} action="addText" disabled={readOnly} onClick={() => { leaveDraw(); board.current?.addText(); }} />,
    // The "note" id is persisted in user prefs: it now adds a text block (a sheet is in the Add menu).
    note: <IconBtn icon={AddBlockGlyph} label={t("toolbar.addBlock")} disabled={readOnly} onClick={() => { leaveDraw(); board.current?.addBlock(); }} />,
    frame: <IconBtn icon={AddFrameGlyph} label={t("toolbar.addFrame")} action="addFrame" disabled={readOnly} onClick={() => { leaveDraw(); board.current?.addFrame(); }} />,
    draw: (
      <IconBtn
        icon={DrawToggleGlyph}
        iconProps={{ on: drawMode }}
        label={drawMode ? t("toolbar.exitDraw") : t("toolbar.draw")}
        action="toggleDraw"
        active={drawMode}
        disabled={readOnly}
        onClick={() => setDrawMode(!drawMode)}
      />
    ),
    // Générateur de palettes : son état vit dans le store, le panneau survit aux rendus de la barre.
    palette: <IconBtn icon={PaletteStudioGlyph} label={t("palette.studio.open")} disabled={readOnly} onClick={() => { leaveDraw(); setStudio({ targetId: null }); }} />,
    extractPalette: <IconBtn icon={ExtractPaletteGlyph} label={t("shortcut.extractPalette")} action="extractPalette" disabled={readOnly} onClick={() => void extractPaletteToBoard()} />,
    tidy: <IconBtn icon={TidyGlyph} iconProps={{ mode: prefs.arrangeLayout }} label={t("shortcut.arrangeDefault")} action="arrangeDefault" disabled={readOnly} onClick={tidySelection} />,
    // Aimant : accrochage bords/centres/coins. Alt le suspend le temps d'un geste, ce bouton l'éteint.
    snap: <IconBtn icon={SnapGlyph} iconProps={{ on: snap }} label={snap ? t("toolbar.snapOff") : t("toolbar.snapOn")} active={snap} onClick={() => setPrefs({ snap: !snap })} />,
    zoomOut: <IconBtn icon={ZoomOutGlyph} label={t("actions.zoomOut")} action="zoomOut" onClick={() => board.current?.zoomBy(0.8)} />,
    zoomIn: <IconBtn icon={ZoomInGlyph} label={t("actions.zoomIn")} action="zoomIn" onClick={() => board.current?.zoomBy(1.25)} />,
    fit: <IconBtn icon={FitAllGlyph} label={t("actions.fitAll")} action="fit" onClick={() => board.current?.fit()} />,
    freeze: (
      <IconBtn
        icon={FreezeGlyph}
        iconProps={{ on: frozen }}
        label={frozen ? t("toolbar.playAll") : t("toolbar.freezeAll")}
        action="toggleFreeze"
        onClick={toggleFrozen}
      />
    ),
    undo: <IconBtn icon={UndoGlyph} label={t("actions.undo")} action="undo" onClick={undo} disabled={readOnly || !canUndo} />,
    redo: <IconBtn icon={RedoGlyph} label={t("actions.redo")} action="redo" onClick={redo} disabled={readOnly || !canRedo} />,
    mouseThrough: (
      <IconBtn
        icon={MouseThroughGlyph}
        iconProps={{ on: mouseThrough }}
        label={mouseThrough ? t("mouseThrough.off") : t("mouseThrough.on")}
        action="toggleMouseThrough"
        active={mouseThrough}
        onClick={askMouseThrough}
      />
    ),
    settings: onSettings ? <IconBtn icon={SettingsGlyph} label={t("actions.settings")} onClick={onSettings} /> : null,
    save: onSave ? <IconBtn icon={SaveGlyph} label={t("toolbar.saveScene")} action="save" onClick={onSave} /> : null,
    saveAs: onSaveAs ? <IconBtn icon={SaveAsGlyph} label={t("toolbar.saveAs")} action="saveAs" onClick={onSaveAs} /> : null,
    openProject: onOpen ? <IconBtn icon={OpenSceneGlyph} label={t("toolbar.openScene")} action="openProject" onClick={onOpen} /> : null,
    newScene: <IconBtn icon={NewSceneGlyph} label={t("actions.newScene")} action="newScene" onClick={() => newScene()} />,
    // Partager : le PROJET (.netsu) ou une IMAGE de la scène — deux sorties, d'où le menu.
    share: (
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("toolbar.share")} />} />}
          >
            <NetsuIcon name="share" />
          </TooltipTrigger>
          <TooltipContent>{t("toolbar.share")}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          {onExport && (
            <DropdownMenuItem onClick={onExport}>
              <NetsuIcon name="share-project" /> {t("toolbar.shareProject")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem disabled={!hasItems} onClick={() => setImgExport(true)}>
            <NetsuIcon name="export-image" /> {t("exportImage.menu")}
          </DropdownMenuItem>
          {/* Partager À QUELQU'UN, et non un fichier : le projet devient collaboratif et les amis
              choisis reçoivent une invitation dans leur application. Sans déploiement Convex il n'y
              a ni compte ni amis : l'entrée disparaît plutôt que de mener à une impasse. */}
          {convexConfigured && (
            <DropdownMenuItem onClick={() => setCollab(true)}>
              <NetsuIcon name="collab" /> {t("collab.menu")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    home: onHome ? <IconBtn icon={HomeGlyph} label={t("toolbar.home")} onClick={onHome} /> : null,
  };

  // Sorties du format épinglé : jamais masquables.
  const windowButtons = (
    <>
      {onTogglePin && (
        <IconBtn
          icon={PinWindowGlyph}
          iconProps={{ on: pinned }}
          label={pinned ? t("actions.unpin") : t("actions.pin")}
          onClick={onTogglePin}
        />
      )}
      {onDetach && <IconBtn icon={DetachGlyph} label={t("actions.detach")} onClick={onDetach} />}
      {onAttach && <IconBtn icon={AttachGlyph} label={t("actions.attach")} onClick={onAttach} />}
    </>
  );
  const dialogs = (
    <>
      <ExportImageDialog open={imgExport} onOpenChange={setImgExport} />
      {collab && (
        <Suspense fallback={null}>
          <CollaborationDialog open onOpenChange={setCollab} />
        </Suspense>
      )}
      <MouseThroughDialog open={askOpen} onOpenChange={setAskOpen} />
    </>
  );
  const dragStyle = draggable ? ({ WebkitAppRegion: "drag" } as React.CSSProperties) : undefined;
  const noDragStyle = draggable ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties) : undefined;

  // L'ORDRE est celui des préférences : c'est la disposition posée au glisser-déposer.
  const group = (ids: PinnedButtonId[]) =>
    ids.map((id) => <span key={id} className="contents">{B[id]}</span>);

  // Barre RÉDUITE : les boutons choisis, sur le bord choisi.
  if (compact) {
    const vertical = isVerticalSide(prefs.pinnedSide);
    return (
      <div
        className={cn(
          "nr-chrome flex shrink-0 items-center gap-1 border-border bg-card/80 backdrop-blur",
          vertical ? "h-full w-10 flex-col px-1 py-1" : "h-9 w-full px-1",
          vertical ? (prefs.pinnedSide === "left" ? "border-r" : "border-l") : (prefs.pinnedSide === "bottom" ? "border-t" : "border-b"),
          draggable && "select-none",
          className,
        )}
        style={dragStyle}
      >
        <div
          className={cn("flex min-h-0 min-w-0 items-center gap-1 overflow-auto", vertical && "flex-col")}
          style={noDragStyle}
        >
          {group(prefs.pinnedButtons)}
        </div>
        {/* Ancrés à l'autre bout : les boutons choisis pour y aller, puis les sorties du format. */}
        <div
          className={cn("flex shrink-0 items-center gap-1", vertical ? "mt-auto flex-col" : "ml-auto")}
          style={noDragStyle}
        >
          {group(prefs.pinnedButtonsEnd)}
          {windowButtons}
        </div>
        {dialogs}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "nr-chrome flex shrink-0 items-center gap-1 border-b border-border bg-card/80 px-2 backdrop-blur",
        compact ? "h-9 px-1" : "h-11",
        draggable && "select-none",
        className,
      )}
      style={draggable ? ({ WebkitAppRegion: "drag" } as React.CSSProperties) : undefined}
    >
      {/* zone interactive : les contrôles ne doivent pas hériter du drag de la barre */}
      <div
        className="flex shrink-0 items-center gap-1"
        style={draggable ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties) : undefined}
      >
      {group(prefs.barButtons)}
      </div>

      {/* Zone centrale : nom du projet et son état. Centrée dans la place LAISSÉE par les deux
          groupes d'outils plutôt qu'en centre absolu — un centre absolu passerait sous les boutons
          dès que la fenêtre se resserre. Elle reste draggable (fenêtre détachée) hors des contrôles.
          Épinglé : la place manque pour un nom de projet, il ne reste que l'espace. */}
      <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 px-2 text-xs text-muted-foreground">
        {/* Un projet lié à un fichier affiche SON nom et, en infobulle, son chemin complet : savoir
            où il est enregistré est la raison d'être du format. */}
        {filePath ? (
          <Tooltip>
            <TooltipTrigger render={<span className="flex min-w-0 items-center gap-1 truncate" />}>
              <NetsuIcon name="open-project-file" className="size-3.5" />
              <span className="truncate">{fileLabel(filePath)}</span>
            </TooltipTrigger>
            <TooltipContent>{filePath}</TooltipContent>
          </Tooltip>
        ) : (
          <span className="truncate font-medium text-foreground">{sceneName}</span>
        )}
        {dirty && <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label={t("toolbar.unsaved")} />}
        {/* Board partagé : qui est là et ce qui reste à faire, sous une pastille. Elle remplace les
            mentions en texte, qui disaient l'état sans jamais dire QUI ni quoi faire. */}
        {shared && convexConfigured && (
          <Suspense fallback={null}>
            <CollabStatus />
          </Suspense>
        )}
        {readOnly && <span className="shrink-0">· {t("collab.role.viewer")}</span>}
        {shared && !convexConfigured && rotationRequired && (
          <span className="shrink-0 text-amber-500">· {t("collab.status.rotation")}</span>
        )}
        {shared && !convexConfigured && !rotationRequired && syncQueued && (
          <span className="shrink-0">· {t("collab.status.pending")}</span>
        )}
        {notice && (
          <span className={cn("truncate", notice.kind === "error" ? "text-destructive" : "text-[var(--color-ok)]")}>
            · {notice.text}
          </span>
        )}
        {recoverableCount > 0 && (
          <Button
            variant="ghost"
            size="xs"
            disabled={recovering}
            onClick={() => void retryMissing()}
            aria-label={t("notice.redownloadAll", { count: recoverableCount })}
            style={draggable ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties) : undefined}
          >
            <NetsuIcon name="redownload-all" busy={recovering} />
            {t("notice.redownloadAll", { count: recoverableCount })}
          </Button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1" style={noDragStyle}>
        {group(prefs.barButtonsEnd)}
        {windowButtons}
      </div>

      {dialogs}
    </div>
  );
}

// Avertissement du mode transparent à la souris : il donne la SORTIE, pas un risque.
function MouseThroughDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation("reference");
  const setPrefs = useBoard((s) => s.setPrefs);
  const [dontAsk, setDontAsk] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("mouseThrough.on")}</DialogTitle>
          <DialogDescription>{t("mouseThrough.warning")}</DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox checked={dontAsk} onCheckedChange={(v) => setDontAsk(v === true)} />
          {t("mouseThrough.dontAskAgain")}
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("common:action.cancel")}</Button>
          <Button
            onClick={() => {
              if (dontAsk) setPrefs({ mouseThroughWarned: true });
              setMouseThrough(true);
              onOpenChange(false);
            }}
          >
            {t("common:action.continue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

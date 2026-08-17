// Barre d'outils du board. Trois zones : à GAUCHE ce qui pose et regarde (ajout, zoom, cadrage,
// gel), au CENTRE le nom du projet et son état (modifié, notice), à DROITE ce qui touche au
// DOCUMENT (annuler/rétablir, nouvelle scène, enregistrer, ouvrir, partager) puis la fenêtre
// (réglages, épingle, détacher). Le partage est un menu : le projet lui-même, ou une image de la scène.
//
// Les DEUX barres se disposent dans les Paramètres (`barButtons` / `pinnedButtons`, deux extrémités
// chacune) ; `compact` est la version épinglée, qui choisit en plus son bord. Épingler, détacher et
// rattacher n'en font jamais partie : ce sont les sorties du format.

import { useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  ImagePlus, Type, Frame, Pencil, ZoomIn, ZoomOut, Maximize, FilePlus2,
  Save, SaveAll, FileCheck2, FolderOpen, Share2, PictureInPicture2, Minimize2, Pin, PinOff, Play, Pause,
  Settings2, Home, Undo2, Redo2, RotateCw, Magnet, Package, ImageDown, SwatchBook,
  MousePointer2, MousePointerBan, Pipette, LayoutGrid,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { ComboKeys } from "@/components/ui/kbd";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useBoard } from "./useReferenceBoard";
import { fileLabel } from "./useScenePersistence";
import { recoverAllOnlineMedia, recoverableOnlineItems } from "./boardMediaActions";
import { ExportImageDialog } from "./ExportImageDialog";
import { askMouseThrough, setMouseThrough } from "./boardMouseThrough";
import { extractPaletteToBoard } from "./boardPaletteActions";
import { isVerticalSide, type PinnedButtonId } from "./toolbarButtons";
import type { BoardHandle } from "./ReferenceBoard";
import type { ShortcutAction } from "./referenceShared";

// `action` = raccourci-commande qui fait la MÊME chose : sa touche paraît dans l'infobulle, lue dans
// les préférences (un rebind se voit tout de suite).
function IconBtn({ icon: Icon, label, onClick, disabled, active, action }: {
  icon: typeof ImagePlus; label: string; onClick: () => void;
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
        <Icon />
      </TooltipTrigger>
      <TooltipContent>
        <span className="flex items-center gap-1.5">
          {label}
          {combo && <ComboKeys combo={combo} />}
        </span>
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
  const items = useBoard((s) => s.items);
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
  const mouseThrough = useBoard((s) => s.mouseThrough);
  const prefs = useBoard((s) => s.prefs);
  const askOpen = useBoard((s) => s.mouseThroughAsk);
  const setAskOpen = useBoard((s) => s.setMouseThroughAsk);
  const setStudio = useBoard((s) => s.setStudio);
  const recoverableCount = recoverableOnlineItems(items).length;
  const hasItems = items.some((i) => i.kind !== "draw");
  const snap = useBoard((s) => s.prefs.snap);
  const setPrefs = useBoard((s) => s.setPrefs);

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
    text: <IconBtn icon={Type} label={t("toolbar.addText")} action="addText" onClick={() => { leaveDraw(); board.current?.addText(); }} />,
    frame: <IconBtn icon={Frame} label={t("toolbar.addFrame")} action="addFrame" onClick={() => { leaveDraw(); board.current?.addFrame(); }} />,
    draw: (
      <IconBtn
        icon={Pencil}
        label={drawMode ? t("toolbar.exitDraw") : t("toolbar.draw")}
        action="toggleDraw"
        active={drawMode}
        onClick={() => setDrawMode(!drawMode)}
      />
    ),
    // Générateur de palettes : son état vit dans le store, le panneau survit aux rendus de la barre.
    palette: <IconBtn icon={SwatchBook} label={t("palette.studio.open")} onClick={() => { leaveDraw(); setStudio({ targetId: null }); }} />,
    extractPalette: <IconBtn icon={Pipette} label={t("shortcut.extractPalette")} action="extractPalette" onClick={() => void extractPaletteToBoard()} />,
    tidy: <IconBtn icon={LayoutGrid} label={t("shortcut.arrangeDefault")} action="arrangeDefault" onClick={tidySelection} />,
    // Aimant : accrochage bords/centres/coins. Alt le suspend le temps d'un geste, ce bouton l'éteint.
    snap: <IconBtn icon={Magnet} label={snap ? t("toolbar.snapOff") : t("toolbar.snapOn")} active={snap} onClick={() => setPrefs({ snap: !snap })} />,
    zoomOut: <IconBtn icon={ZoomOut} label={t("actions.zoomOut")} action="zoomOut" onClick={() => board.current?.zoomBy(0.8)} />,
    zoomIn: <IconBtn icon={ZoomIn} label={t("actions.zoomIn")} action="zoomIn" onClick={() => board.current?.zoomBy(1.25)} />,
    fit: <IconBtn icon={Maximize} label={t("actions.fitAll")} action="fit" onClick={() => board.current?.fit()} />,
    freeze: (
      <IconBtn
        icon={frozen ? Play : Pause}
        label={frozen ? t("toolbar.playAll") : t("toolbar.freezeAll")}
        action="toggleFreeze"
        onClick={toggleFrozen}
      />
    ),
    undo: <IconBtn icon={Undo2} label={t("actions.undo")} action="undo" onClick={undo} disabled={!canUndo} />,
    redo: <IconBtn icon={Redo2} label={t("actions.redo")} action="redo" onClick={redo} disabled={!canRedo} />,
    mouseThrough: (
      <IconBtn
        icon={mouseThrough ? MousePointer2 : MousePointerBan}
        label={mouseThrough ? t("mouseThrough.off") : t("mouseThrough.on")}
        action="toggleMouseThrough"
        active={mouseThrough}
        onClick={askMouseThrough}
      />
    ),
    settings: onSettings ? <IconBtn icon={Settings2} label={t("actions.settings")} onClick={onSettings} /> : null,
    save: onSave ? <IconBtn icon={Save} label={t("toolbar.saveScene")} action="save" onClick={onSave} /> : null,
    saveAs: onSaveAs ? <IconBtn icon={SaveAll} label={t("toolbar.saveAs")} action="saveAs" onClick={onSaveAs} /> : null,
    openProject: onOpen ? <IconBtn icon={FolderOpen} label={t("toolbar.openScene")} action="openProject" onClick={onOpen} /> : null,
    newScene: <IconBtn icon={FilePlus2} label={t("actions.newScene")} action="newScene" onClick={() => newScene()} />,
    // Partager : le PROJET (.netsu) ou une IMAGE de la scène — deux sorties, d'où le menu.
    share: (
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("toolbar.share")} />} />}
          >
            <Share2 />
          </TooltipTrigger>
          <TooltipContent>{t("toolbar.share")}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          {onExport && (
            <DropdownMenuItem onClick={onExport}>
              <Package /> {t("toolbar.shareProject")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem disabled={!hasItems} onClick={() => setImgExport(true)}>
            <ImageDown /> {t("exportImage.menu")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    home: onHome ? <IconBtn icon={Home} label={t("toolbar.home")} onClick={onHome} /> : null,
  };

  // Sorties du format épinglé : jamais masquables.
  const windowButtons = (
    <>
      {onTogglePin && (
        <IconBtn
          icon={pinned ? Pin : PinOff}
          label={pinned ? t("actions.unpin") : t("actions.pin")}
          onClick={onTogglePin}
        />
      )}
      {onDetach && <IconBtn icon={PictureInPicture2} label={t("actions.detach")} onClick={onDetach} />}
      {onAttach && <IconBtn icon={Minimize2} label={t("actions.attach")} onClick={onAttach} />}
    </>
  );
  const dialogs = (
    <>
      <ExportImageDialog open={imgExport} onOpenChange={setImgExport} />
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
              <FileCheck2 className="size-3.5 shrink-0" />
              <span className="truncate">{fileLabel(filePath)}</span>
            </TooltipTrigger>
            <TooltipContent>{filePath}</TooltipContent>
          </Tooltip>
        ) : (
          <span className="truncate font-medium text-foreground">{sceneName}</span>
        )}
        {dirty && <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label={t("toolbar.unsaved")} />}
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
            <RotateCw className={cn(recovering && "animate-spin")} />
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

// Page « Référence » (onglet) : board mood-board + barre d'outils + gestion de scènes +
// inspecteur d'item + sélecteur de rushs/plans du projet.

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/store";
import { Toolbar } from "./Toolbar";
import { BoardContextMenu } from "./BoardMenu";
import { SceneDialog } from "./SceneDialog";
import { ExportDialog } from "./ExportDialog";
import { Inspector } from "./Inspector";
import { SequencePlayer } from "./SequencePlayer";
import { CropOverlay } from "./CropOverlay";
import { ReferenceHome } from "./ReferenceHome";
import { ReferenceBoard, type BoardHandle } from "./ReferenceBoard";
import { PaletteStudio } from "./PaletteStudio";
import { useBoard } from "./useReferenceBoard";
import { useScenePersistence } from "./useScenePersistence";
import { useBoardShortcuts } from "./useBoardShortcuts";
import { useProjectActions } from "./useProjectActions";
import { useReferencePush } from "./useReferencePush";
import { useAutosave } from "./useAutosave";
import { useUnsavedWarning } from "./useUnsavedWarning";
import { useDeselectOnBlur } from "./useAppFocus";
import { isTouchFirst, onPenSeen, probeDevices } from "./tabletInput";
import { openSettings } from "@/components/settings/useSettingsUi";

// Import en attente : posé par l'accueil (dépôt/parcourir), ingéré une fois le board monté.
type Pending = { files?: File[]; paths?: string[] };

export function ReferencePanel() {
  const boardRef = useRef<BoardHandle>(null);
  const persistence = useScenePersistence();
  const [sceneDlg, setSceneDlg] = useState(false);
  const [exportDlg, setExportDlg] = useState(false);
  // Landing : toujours l'accueil au montage de l'onglet (le board en session reste dans le store).
  const [mode, setMode] = useState<"home" | "board">("home");
  const [pending, setPending] = useState<Pending | null>(null);
  const items = useBoard((s) => s.items);
  // Épinglé (fenêtre principale au-dessus, format coin) → board flottante, barre d'outils réduite.
  const pinned = useApp((s) => s.pinned);
  const pinnedToolbar = useBoard((s) => s.prefs.pinnedToolbar);
  const touchUi = useBoard((s) => s.prefs.touchUi);
  const bigTargets = useBoard((s) => s.prefs.bigTargets);

  // Identité stable : les actions de document alimentent l'effet clavier, qui se réabonnerait à
  // chaque rendu si ce rappel changeait d'identité.
  const goBoard = useCallback(() => setMode("board"), []);
  const project = useProjectActions(persistence, goBoard);

  useBoardShortcuts(boardRef, { onSave: project.save, onSaveAs: project.saveAs, onOpenProject: project.openProject });
  useReferencePush(boardRef);
  useAutosave(persistence);
  useUnsavedWarning();
  useDeselectOnBlur();

  // Démarrage d'un nouveau board depuis l'accueil : purge le board restauré puis ingère.
  const startNew = (p: Pending) => {
    useBoard.getState().newScene();
    setPending(p);
    setMode("board");
  };
  const onOpenScene = async (id: string) => {
    await persistence.open(id);
    setMode("board");
  };

  // Réglages Stylet portés sur <html> : ils touchent des écrans hors board (accueil, dialogues,
  // barre de fenêtre), donc c'est la racine du document qui les porte, pas la planche. `auto` =
  // ce que dit la machine — un stylet déjà vu, ou un tactile sans souris (cf. probeDevices).
  useEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute("data-big-targets", bigTargets);
    const apply = () => {
      const d = probeDevices();
      root.toggleAttribute("data-touch-ui", touchUi === "auto" ? d.penSeen || isTouchFirst(d) : touchUi === "on");
    };
    apply();
    // Le premier contact du stylet est la SEULE façon d'apprendre qu'une tablette est branchée :
    // aucune media query ne la déclare. `auto` bascule donc en cours de session, pas au montage.
    return onPenSeen(apply);
  }, [touchUi, bigTargets]);

  // Ingestion différée : le board n'existe qu'en mode "board" → on attend son montage.
  useEffect(() => {
    if (mode !== "board" || !pending || !boardRef.current) return;
    if (pending.files) boardRef.current.addFiles(pending.files);
    pending.paths?.forEach((p) => boardRef.current?.addPath(p));
    setPending(null);
  }, [mode, pending]);

  // L'épinglage ne change QUE le format de la fenêtre : il ne navigue pas. À l'accueil on reste à
  // l'accueil, sur une planche on reste sur la planche — dans les deux sens de la bascule.
  if (mode === "home") {
    return (
      <div className={`relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden${pinned ? " bg-[var(--color-bg)]" : ""}`}>
        <ReferenceHome
          hasSession={items.length > 0}
          onResume={() => setMode("board")}
          onOpen={onOpenScene}
          onNew={() => startNew({})}
          onNewFiles={(files) => startNew({ files })}
          onSettings={() => openSettings()}
          onOpenProject={persistence.available ? project.openProject : undefined}
          onOpenRecent={persistence.available ? project.openRecent : undefined}
          recents={persistence.recentProjects}
        />
        <SceneDialog open={sceneDlg} onOpenChange={setSceneDlg} persistence={persistence} />
      </div>
    );
  }

  // UN SEUL arbre pour les deux formats, épinglé compris. Rendre deux arbres distincts démontait le
  // recadrage et le générateur de palette à chaque bascule — une popup ouverte disparaissait — et
  // faisait clignoter la page entière au moment précis où la fenêtre change de taille.
  //
  // Épinglé : la barre de titre de l'app sert de zone de déplacement et la barre d'outils est
  // RÉDUITE (poser, dessiner, cadrer, annuler) — le document et le retour à l'accueil restent au
  // clic droit —, et le réglage `pinnedToolbar` la retire pour retrouver la planche entièrement nue.
  const onHome = () => setMode("home");
  const onOpen = persistence.available ? () => setSceneDlg(true) : undefined;
  return (
    <div className={`relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden${pinned ? " bg-[var(--color-bg)]" : ""}`}>
      {(!pinned || pinnedToolbar) && (
        // `key` : les deux barres n'ont pas le même contenu, la nouvelle apparaît en fondu plutôt
        // que de remplacer l'ancienne d'un trait pendant que la fenêtre change de format.
        <Toolbar
          key={pinned ? "compact" : "full"}
          board={boardRef}
          compact={pinned}
          className="animate-in fade-in duration-200"
          onHome={onHome}
          onSave={persistence.available ? project.save : undefined}
          onSaveAs={persistence.available ? project.saveAs : undefined}
          onOpen={onOpen}
          onSettings={() => openSettings()}
          onExport={!pinned && persistence.available ? () => setExportDlg(true) : undefined}
        />
      )}
      <BoardContextMenu
        board={boardRef}
        onHome={onHome}
        onSave={persistence.available ? project.save : undefined}
        onSaveAs={persistence.available ? project.saveAs : undefined}
        onOpenProject={pinned && persistence.available ? project.openProject : undefined}
        onOpen={onOpen}
        onSettings={() => openSettings()}
      >
        <ReferenceBoard ref={boardRef} />
        <Inspector />
        <SequencePlayer />
      </BoardContextMenu>
      <SceneDialog open={sceneDlg} onOpenChange={setSceneDlg} persistence={persistence} />
      <ExportDialog open={exportDlg} onOpenChange={setExportDlg} onExport={persistence.exportBoard} onWeigh={persistence.weigh} />
      <CropOverlay />
      {/* Mounted here, beside the board rather than inside the toolbar or the inspector: those
          two re-render and unmount with the selection, and picking images on the board is part
          of using this panel. */}
      <PaletteStudio />
    </div>
  );
}

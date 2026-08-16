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

  // Ingestion différée : le board n'existe qu'en mode "board" → on attend son montage.
  useEffect(() => {
    if (mode !== "board" || !pending || !boardRef.current) return;
    if (pending.files) boardRef.current.addFiles(pending.files);
    pending.paths?.forEach((p) => boardRef.current?.addPath(p));
    setPending(null);
  }, [mode, pending]);

  // Mode épinglé : pas d'accueil, on rend directement le board de session pour un usage flottant
  // instantané ; la barre de titre de l'app sert de zone de déplacement. La barre d'outils y est
  // RÉDUITE (poser, dessiner, cadrer, annuler) — le document reste au clic droit —, et le réglage
  // `pinnedToolbar` la retire pour retrouver la planche entièrement nue.
  if (pinned) {
    return (
      <div className="relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-bg)]">
        {pinnedToolbar && <Toolbar board={boardRef} compact />}
        <BoardContextMenu
          board={boardRef}
          onSave={persistence.available ? project.save : undefined}
          onSaveAs={persistence.available ? project.saveAs : undefined}
          onOpenProject={persistence.available ? project.openProject : undefined}
          onOpen={persistence.available ? () => setSceneDlg(true) : undefined}
          onSettings={() => openSettings()}
        >
          <ReferenceBoard ref={boardRef} />
          <Inspector />
          <SequencePlayer />
        </BoardContextMenu>
        <SceneDialog open={sceneDlg} onOpenChange={setSceneDlg} persistence={persistence} />
        <CropOverlay />
        <PaletteStudio />
      </div>
    );
  }

  if (mode === "home") {
    return (
      <div className="relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
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

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
      <Toolbar
        board={boardRef}
        onHome={() => setMode("home")}
        onSave={persistence.available ? project.save : undefined}
        onSaveAs={persistence.available ? project.saveAs : undefined}
        onOpen={persistence.available ? () => setSceneDlg(true) : undefined}
        onSettings={() => openSettings()}
        onExport={persistence.available ? () => setExportDlg(true) : undefined}
      />
      <BoardContextMenu
        board={boardRef}
        onHome={() => setMode("home")}
        onSave={persistence.available ? project.save : undefined}
        onSaveAs={persistence.available ? project.saveAs : undefined}
        onOpen={persistence.available ? () => setSceneDlg(true) : undefined}
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

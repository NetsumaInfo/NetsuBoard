// Menu contextuel (clic droit) du board : actions sur l'item visé OU actions générales du board.
// Clic droit sur un item → le sélectionne d'abord (actions item) ; clic droit sur le vide →
// actions board. Partagé par l'onglet et la fenêtre détachée (où il remplace la barre d'outils).

import { useState, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { WebGlyph } from "./netsuIcons";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import { enclosingFrame } from "./boardFrames";
import { requestOpenDoc } from "./boardPdf";
import { convertToEmbed, downloadMediaFromEmbed, reloadMedia, reloadableMedia, relocateMissingMedia } from "./boardMediaActions";
import { routeOf, shifted } from "./drawGeometry";
import { LINK_PALETTE } from "./links/model";
import { deleteShapes, reverseLinks } from "./links/linkActions";
import { useLinkUi } from "./links/linkUi";
import { EdgeLinkMenu, ItemLinkMenu, MultiLinkMenu } from "./links/LinkMenuItems";
import { noteMode, type NoteMode } from "./blockModel";
import { switchNoteMode } from "./blockActions";
import { MODE_ICONS, NOTE_MODES } from "./TextModeControls";
import { uid, type ArrowHead, type BoardItem, type DashStyle, type DrawShape, type RouteStyle } from "./referenceShared";
import { iconForLink } from "./brandIcons";
import { nr } from "@/lib/bridge";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuCheckboxItem,
  ContextMenuSeparator, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent,
} from "@/components/ui/context-menu";
import { useBoard } from "./useReferenceBoard";
import { AddLinkDialog } from "./AddLinkDialog";
import { ExportImageDialog } from "./ExportImageDialog";
import { ExportLoopDialog } from "./ExportLoopDialog";
import { loopExportable } from "./boardLoopExport";
import { extractPaletteToBoard } from "./boardPaletteActions";
import type { BoardHandle } from "./ReferenceBoard";

export function BoardContextMenu({
  board,
  children,
  onSave,
  onSaveAs,
  onOpenProject,
  onOpen,
  onHome,
  onAttach,
  onSettings,
  pinned,
  onTogglePin,
}: {
  board: RefObject<BoardHandle | null>;
  children: ReactNode;
  onSave?: () => void;
  onSaveAs?: () => void;
  onOpenProject?: () => void;
  onOpen?: () => void;
  onHome?: () => void;
  onAttach?: () => void;
  onSettings?: () => void;
  pinned?: boolean;
  onTogglePin?: () => void;
}) {
  const { t } = useTranslation("reference");
  const item = useBoard((s) => s.items.find((i) => i.id === s.selectedId && s.selectedIds.length === 1) ?? null);
  const hasItems = useBoard((s) => s.items.some((i) => i.kind !== "draw"));
  // Cadre qui contient l'item visé : un cadre emmène et fait de la place à son contenu, il faut donc
  // une sortie explicite. Le sélecteur ne rend qu'un id → aucun re-render tant que le cadre ne change pas.
  const frameId = useBoard((s) => {
    const it = s.items.find((i) => i.id === s.selectedId && s.selectedIds.length === 1);
    return it ? enclosingFrame(it, s.items)?.id ?? null : null;
  });
  // Groupable en séquence : ≥2 items image sélectionnés.
  const groupable = useBoard(
    (s) => s.selectedIds.filter((id) => s.items.find((i) => i.id === id)?.kind === "image").length >= 2,
  );
  // ≥2 items sélectionnés → actions de groupe (ranger, uniformiser).
  const multi = useBoard((s) => s.selectedIds.length >= 2);
  // Au moins un média dont on peut lire les pixels → extraction de palette (sélection, ou board entier).
  const hasSampleable = useBoard((s) => {
    const pool = s.selectedIds.length ? s.items.filter((i) => s.selectedIds.includes(i.id)) : s.items;
    return pool.some((i) => (i.kind === "image" || i.kind === "video" || i.kind === "sequence") && !i.missing);
  });
  const frozen = useBoard((s) => s.frozen);
  const drawMode = useBoard((s) => s.drawMode);
  const drawBack = useBoard((s) => s.drawBack);
  const drawSel = useBoard((s) => s.drawSel);
  const hasDraw = useBoard((s) => s.items.some((i) => i.kind === "draw" && (i.shapes?.length ?? 0) > 0));
  const background = useBoard((s) => s.background);
  const inFolder = useBoard((s) => s.folderPath.length > 0);
  // Right-click landed on an item, a drawn shape or inside a multi-selection.
  const targeted = useBoard((s) => s.selectedIds.length > 0 || s.drawSel.length > 0);
  const canUndo = useBoard((s) => s.past.length > 0);
  const canRedo = useBoard((s) => s.future.length > 0);
  // Board reçu d'ailleurs : ses rushs référencés sont ailleurs sur le disque de celui qui l'ouvre.
  const missingCount = useBoard((s) => s.items.filter((i) => !!i.missing && i.kind !== "sequence").length);
  const [ytOpen, setYtOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [imgExport, setImgExport] = useState(false);
  // Held apart from the selection: the dialog outlives a click that deselects the item.
  const [loopItem, setLoopItem] = useState<BoardItem | null>(null);

  const store = useBoard.getState;

  // Before the menu opens: target what is under the cursor. A right-click inside an existing
  // multi-selection keeps it (its group actions are the whole point of aiming there); otherwise the
  // item — or the drawn shape — under the cursor becomes the selection, and empty space clears it.
  const onContextMenu = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const id = target.closest("[data-board-item]")?.getAttribute("data-board-item") ?? null;
    if (id) {
      if (!store().selectedIds.includes(id)) store().select(id);
      return;
    }
    const shapeId = target.closest("[data-draw-shape]")?.getAttribute("data-draw-shape") ?? null;
    // Même règle que pour les items : viser une forme DÉJÀ dans le groupe garde le groupe, c'est
    // justement pour ses actions collectives qu'on l'a visée.
    if (shapeId) {
      if (!store().drawSel.includes(shapeId)) store().selectDrawShape(shapeId);
    } else store().select(null);
  };

  // Selected drawn shape: same two actions as its keyboard shortcuts (Ctrl+D / Suppr).
  const duplicateShape = () => {
    const st = store();
    const shapes = st.items.find((i) => i.kind === "draw")?.shapes ?? [];
    const off = 16 / st.view.scale;
    const copies = st.drawSel
      .map((id) => shapes.find((s) => s.id === id))
      .filter((src): src is NonNullable<typeof src> => src != null)
      .map((src) => ({ ...shifted(src, off, off), id: uid() }));
    if (!copies.length) return;
    st.drawSetShapes([...shapes, ...copies]);
    st.selectDrawShapes(copies.map((copy) => copy.id));
  };
  // Selected edge (arrow or line): style, direction and label, all written on the shape itself.
  const edge = useBoard((s) => {
    if (s.drawSel.length !== 1) return null;
    const sh = s.items.find((i) => i.kind === "draw")?.shapes?.find((x) => x.id === s.drawSel[0]);
    return sh && (sh.t === "arrow" || sh.t === "line") ? sh : null;
  });
  const patchEdge = (patch: Partial<DrawShape>) => {
    const st = store();
    const shapes = st.items.find((i) => i.kind === "draw")?.shapes ?? [];
    st.drawSetShapes(shapes.map((sh) => (sh.id === st.drawSel[0] ? { ...sh, ...patch } : sh)));
  };
  // Branches hanging from the link keep their place (links/junction mirrorJunctions).
  const reverseEdge = () => reverseLinks(store().drawSel.slice(0, 1));
  const headsOf = (sh: DrawShape): "none" | "end" | "both" => {
    const h1: ArrowHead = sh.h1 ?? "none";
    const h2: ArrowHead = sh.h2 ?? (sh.t === "arrow" ? "arrow" : "none");
    return h1 !== "none" && h2 !== "none" ? "both" : h2 !== "none" ? "end" : "none";
  };
  const setHeads = (mode: "none" | "end" | "both") =>
    patchEdge({ h1: mode === "both" ? "arrow" : "none", h2: mode === "none" ? "none" : "arrow" });
  // Branches hanging from a deleted link are re-rooted on its items (links/junction removeShapes).
  const deleteShape = () => deleteShapes(store().drawSel);

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger className="relative min-h-0 flex-1" onContextMenuCapture={onContextMenu}>
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent>
          {/* Aimed at something: only what acts on it. Board actions stay on a right-click on empty
              space, otherwise the two lists stack into a menu taller than the window. */}
          {targeted ? (
            <>
              {item && (
                <>
                  {item.kind === "text" && noteMode(item) === "sheet" && (
                    <ContextMenuItem onClick={() => store().openNote(item.id)}>
                      <NetsuIcon name="note" /> {t("noteCard.open")}
                    </ContextMenuItem>
                  )}
                  {item.kind === "text" && (
                    <ContextMenuSub>
                      <ContextMenuSubTrigger><NetsuIcon name="change-type" /> {t("textMode.displayAs")}</ContextMenuSubTrigger>
                      <ContextMenuSubContent>
                        {NOTE_MODES.map((m: NoteMode) => {
                          const Icon = MODE_ICONS[m];
                          return (
                            <ContextMenuCheckboxItem key={m} checked={noteMode(item) === m} onCheckedChange={() => void switchNoteMode(item.id, m)}>
                              <Icon /> {t(`textMode.${m}`)}
                            </ContextMenuCheckboxItem>
                          );
                        })}
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                  )}
                  {item.kind === "frame" && item.folder && (
                    <ContextMenuItem onClick={() => store().enterFolder(item.id)}>
                      <NetsuIcon name="folder-open" /> {t("folder.open")}
                    </ContextMenuItem>
                  )}
                  {item.folder && (
                    <ContextMenuCheckboxItem
                      checked={(item.coverStyle ?? store().prefs.folderCover) === "mosaic"}
                      onCheckedChange={(on) => store().patchItem(item.id, { coverStyle: on ? "mosaic" : "image" })}
                    >
                      <NetsuIcon name="folder-mosaic" on={(item.coverStyle ?? store().prefs.folderCover) === "mosaic"} /> {t("folder.coverMosaic")}
                    </ContextMenuCheckboxItem>
                  )}
                  {item.kind === "frame" && (
                    <ContextMenuItem onClick={() => store().toggleFolder(item.id)}>
                      {item.folder ? <NetsuIcon name="frame" /> : <NetsuIcon name="folder" />}
                      {t(item.folder ? "folder.toFrame" : "folder.toFolder")}
                    </ContextMenuItem>
                  )}
                  {inFolder && item.kind === "image" && (
                    <ContextMenuItem onClick={() => store().setFolderCover(item.id)}>
                      <NetsuIcon name="set-cover" /> {t("folder.setCover")}
                    </ContextMenuItem>
                  )}
                  {(item.kind === "frame" || item.kind === "text" || (inFolder && item.kind === "image")) && <ContextMenuSeparator />}
                  <ContextMenuItem onClick={() => store().duplicateItem(item.id)}>
                    <NetsuIcon name="duplicate" /> {t("actions.duplicate")}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => void board.current?.copySelection(false)}>
                    <NetsuIcon name="copy-clipboard" /> {t("actions.copy")}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => void board.current?.copySelection(true)}>
                    <NetsuIcon name="cut" /> {t("actions.cut")}
                  </ContextMenuItem>
                  <ContextMenuSub>
                    <ContextMenuSubTrigger><NetsuIcon name="flip-h" /> {t("boardMenu.groupTransform")}</ContextMenuSubTrigger>
                    <ContextMenuSubContent>
                      <ContextMenuItem onClick={() => store().patchItem(item.id, { flipH: !item.flipH })}>
                        <NetsuIcon name="flip-h" /> {t("actions.flipH")}
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => store().patchItem(item.id, { flipV: !item.flipV })}>
                        <NetsuIcon name="flip-v" /> {t("actions.flipV")}
                      </ContextMenuItem>
                      {(item.kind === "image" || item.kind === "video") && (
                        <ContextMenuItem onClick={() => store().setCropping(item.id)}>
                          <NetsuIcon name="crop" /> {t("actions.crop")}
                        </ContextMenuItem>
                      )}
                      <ContextMenuItem onClick={() => store().bringToFront(item.id)}>
                        <NetsuIcon name="z-front" /> {t("actions.bringToFront")}
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => store().sendToBack(item.id)}>
                        <NetsuIcon name="z-back" /> {t("actions.sendToBack")}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuSub>
                        <ContextMenuSubTrigger><NetsuIcon name="reset" /> {t("actions.reset")}</ContextMenuSubTrigger>
                        <ContextMenuSubContent>
                          <ContextMenuItem onClick={() => store().reset("scale")}>{t("actions.resetScale")}</ContextMenuItem>
                          <ContextMenuItem onClick={() => store().reset("rotation")}>{t("actions.resetRotation")}</ContextMenuItem>
                          <ContextMenuItem onClick={() => store().reset("flip")}>{t("actions.resetFlip")}</ContextMenuItem>
                          <ContextMenuItem onClick={() => store().reset("crop")}>{t("actions.resetCrop")}</ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem onClick={() => store().reset("all")}>{t("actions.resetAll")}</ContextMenuItem>
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  {/* Même bascule que le bouton de lien posé sur l'item. */}
                  {frameId && (
                    <ContextMenuItem
                      onClick={() => store().patchItem(item.id, { detached: item.detached ? undefined : true })}
                    >
                      <NetsuIcon name="link-frame" on={!item.detached} />
                      {t(item.detached ? "actions.linkFrame" : "actions.unlinkFrame")}
                    </ContextMenuItem>
                  )}
                  {item.docFile && !item.missing && (
                    <>
                      <ContextMenuItem onClick={() => requestOpenDoc(item.id)}>
                        <NetsuIcon name="file-text" /> {t("pdf.openDocument")}
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => void nr.openPath(item.docFile!.ref)}>
                        <NetsuIcon name="open-in-app" /> {t("pdf.openInApp")}
                      </ContextMenuItem>
                      {item.docFile.type === "pdf" && (
                        <>
                          <ContextMenuItem onClick={() => void import("./boardDocExtract").then((m) => m.extractPdfPages(item.id, "sequence"))}>
                            <NetsuIcon name="extract-pages" /> {t("pdf.extractPages")}
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => void import("./boardDocExtract").then((m) => m.extractPdfPages(item.id, "separate"))}>
                            <NetsuIcon name="extract-separate" /> {t("pdf.extractSeparate")}
                          </ContextMenuItem>
                        </>
                      )}
                    </>
                  )}
                  {(() => {
                    const linkUrl =
                      item.kind === "youtube" ? `https://www.youtube.com/watch?v=${item.ref}`
                      : item.kind === "embed" ? item.ref
                      : item.sourceUrl || null;
                    // Rechargement à la demande, item par item. Proposé MÊME quand la case a l'air
                    // correcte : une source qui a changé, un fichier repris par le ménage ou une
                    // synchronisation en retard donnent une case plausible et périmée.
                    const reload = reloadableMedia(item) && item.kind !== "embed";
                    const loop = loopExportable(item);
                    const asEmbed = (item.kind === "image" || item.kind === "video") && !!item.sourceUrl;
                    if (!linkUrl && !reload && !loop && !asEmbed && item.kind !== "embed") return null;
                    const LinkIcon = linkUrl ? iconForLink(linkUrl) : WebGlyph;
                    return (
                      <ContextMenuSub>
                        <ContextMenuSubTrigger><NetsuIcon name="video" /> {t("boardMenu.groupMedia")}</ContextMenuSubTrigger>
                        <ContextMenuSubContent>
                          {linkUrl && (
                            <ContextMenuItem onClick={() => void nr.openExternal(linkUrl)}>
                              <LinkIcon /> {t("actions.openLink")}
                            </ContextMenuItem>
                          )}
                          {reload && (
                            <ContextMenuItem onClick={() => void reloadMedia(item.id)}>
                              <NetsuIcon name="reload-media" /> {t("actions.reloadMedia")}
                            </ContextMenuItem>
                          )}
                          {item.kind === "embed" && (
                            <ContextMenuItem onClick={() => void downloadMediaFromEmbed(item.id)}>
                              <NetsuIcon name="download-media" /> {item.localMedia ? t("actions.restoreDownload") : t("boardMenu.downloadMedia")}
                            </ContextMenuItem>
                          )}
                          {loop && (
                            <ContextMenuItem onClick={() => setLoopItem(item)}>
                              <NetsuIcon name="export-loop" /> {t("exportLoop.menu")}
                            </ContextMenuItem>
                          )}
                          {asEmbed && (
                            <ContextMenuItem onClick={() => convertToEmbed(item.id)}>
                              <NetsuIcon name="as-embed" /> {t("boardMenu.showAsEmbed")}
                            </ContextMenuItem>
                          )}
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                    );
                  })()}
                  <ItemLinkMenu itemId={item.id} />
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive" onClick={() => store().removeItem(item.id)}>
                    <NetsuIcon name="delete" /> {t("common:action.delete")}
                  </ContextMenuItem>
                </>
              )}

              {drawSel.length > 0 && (
                <>
                  {item && <ContextMenuSeparator />}
                  {edge && (
                    <>
                      <ContextMenuItem onClick={() => useLinkUi.getState().startEdit(edge.id)}>
                        <NetsuIcon name="edit-label" /> {t("links.editLabel")}
                      </ContextMenuItem>
                      <ContextMenuSub>
                        <ContextMenuSubTrigger>
                          <span className="size-3.5 rounded-full border border-border" style={{ background: edge.c }} /> {t("links.color")}
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent className="grid grid-cols-4 gap-1 p-1.5">
                          {LINK_PALETTE.map((c) => (
                            <ContextMenuItem key={c} aria-label={c} className="justify-center px-1.5" onClick={() => patchEdge({ c })}>
                              <span className="size-4 rounded-full border border-border" style={{ background: c }} />
                            </ContextMenuItem>
                          ))}
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                      <ContextMenuSub>
                        <ContextMenuSubTrigger><NetsuIcon name="arrowhead-end" /> {t("links.arrowheads")}</ContextMenuSubTrigger>
                        <ContextMenuSubContent>
                          {(["none", "end", "both"] as const).map((m) => (
                            <ContextMenuCheckboxItem key={m} checked={headsOf(edge) === m} onCheckedChange={() => setHeads(m)}>
                              <NetsuIcon name={`arrowhead-${m}`} /> {t(`links.heads.${m}`)}
                            </ContextMenuCheckboxItem>
                          ))}
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                      <ContextMenuSub>
                        <ContextMenuSubTrigger><NetsuIcon name="dash" /> {t("links.dash")}</ContextMenuSubTrigger>
                        <ContextMenuSubContent>
                          {(["solid", "dashed"] as DashStyle[]).map((d) => (
                            <ContextMenuCheckboxItem key={d} checked={(edge.dash ?? "solid") === d || (d === "dashed" && edge.dash === "dotted")} onCheckedChange={() => patchEdge({ dash: d })}>
                              {t(`links.dashes.${d}`)}
                            </ContextMenuCheckboxItem>
                          ))}
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                      <ContextMenuSub>
                        <ContextMenuSubTrigger><NetsuIcon name="route-curved" /> {t("links.route")}</ContextMenuSubTrigger>
                        <ContextMenuSubContent>
                          {(["curved", "straight", "elbow"] as RouteStyle[]).map((r) => (
                            <ContextMenuCheckboxItem key={r} checked={routeOf(edge) === r} onCheckedChange={() => patchEdge({ route: r, cp: undefined })}>
                              {t(`links.routes.${r}`)}
                            </ContextMenuCheckboxItem>
                          ))}
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                      <ContextMenuItem onClick={reverseEdge}>
                        <NetsuIcon name="reverse-edge" /> {t("links.reverse")}
                      </ContextMenuItem>
                      <EdgeLinkMenu linkId={edge.id} />
                      <ContextMenuSeparator />
                    </>
                  )}
                  <ContextMenuItem onClick={duplicateShape}>
                    <NetsuIcon name="duplicate" /> {t("actions.duplicate")}
                  </ContextMenuItem>
                  <ContextMenuItem variant="destructive" onClick={deleteShape}>
                    <NetsuIcon name="delete" /> {t("common:action.delete")}
                  </ContextMenuItem>
                </>
              )}

              {multi && (
                <>
                  <ContextMenuItem onClick={() => { const p = store().prefs; store().tidy({ layout: p.arrangeLayout, uniform: p.arrangeUniform, gap: p.arrangeGap, sort: p.arrangeSort }); }}>
                    <NetsuIcon name="tidy" mode={store().prefs.arrangeLayout} /> {t("tidy.title")}
                  </ContextMenuItem>
                  <MultiLinkMenu />
                  <ContextMenuSub>
                    <ContextMenuSubTrigger><NetsuIcon name="uniform-size" /> {t("tidy.uniform")}</ContextMenuSubTrigger>
                    <ContextMenuSubContent>
                      <ContextMenuItem onClick={() => store().normalize("height")}>{t("tidy.uniformHeight")}</ContextMenuItem>
                      <ContextMenuItem onClick={() => store().normalize("width")}>{t("tidy.uniformWidth")}</ContextMenuItem>
                      <ContextMenuItem onClick={() => store().normalize("area")}>{t("tidy.uniformArea")}</ContextMenuItem>
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  {groupable && (
                    <ContextMenuItem onClick={() => store().groupSequence(store().selectedIds)}>
                      <NetsuIcon name="group-sequence" /> {t("arrange.groupSequence")}
                    </ContextMenuItem>
                  )}
                  <ContextMenuItem onClick={() => void board.current?.copySelection(false)}>
                    <NetsuIcon name="copy-clipboard" /> {t("actions.copy")}
                  </ContextMenuItem>
                </>
              )}

              {hasSampleable && (
                <ContextMenuItem onClick={() => void extractPaletteToBoard()}>
                  <NetsuIcon name="extract-palette" /> {t("palette.extract")}
                </ContextMenuItem>
              )}

              <ContextMenuSeparator />
              <ContextMenuItem disabled={!canUndo} onClick={() => store().undo()}>
                <NetsuIcon name="undo" /> {t("actions.undo")}
              </ContextMenuItem>
              <ContextMenuItem disabled={!canRedo} onClick={() => store().redo()}>
                <NetsuIcon name="redo" /> {t("actions.redo")}
              </ContextMenuItem>
            </>
          ) : (
            <>
              <ContextMenuSub>
                <ContextMenuSubTrigger><NetsuIcon name="add-image" /> {t("common:action.add")}</ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  <ContextMenuItem onClick={async () => { const p = await nr.chooseImages(); if (p?.length) board.current?.addPaths(p); }}>
                    <NetsuIcon name="add-image" /> {t("boardMenu.image")}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={async () => { const p = await nr.chooseFiles(); if (p?.length) board.current?.addPaths(p); }}>
                    <NetsuIcon name="add-video" /> {t("boardMenu.video")}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={async () => { const p = await nr.chooseDocuments(); if (p?.length) board.current?.addPaths(p); }}>
                    <NetsuIcon name="add-document" /> {t("boardMenu.document")}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={async () => { const p = await nr.chooseImages(); if (p?.length) board.current?.addSequence(p); }}>
                    <NetsuIcon name="add-sequence" /> {t("boardMenu.imageSequence")}
                  </ContextMenuItem>
                  {/* Import GROUPÉ : le dossier devient un cadre titré, contenu rangé automatiquement. */}
                  <ContextMenuItem onClick={async () => { const d = await nr.chooseDir(); if (d) board.current?.addFolder(d); }}>
                    <NetsuIcon name="folder" /> {t("boardMenu.folder")}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => setYtOpen(true)}>
                    <NetsuIcon name="web" /> {t("boardMenu.onlineVideo")}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => setCardOpen(true)}>
                    <NetsuIcon name="site-card" /> {t("boardMenu.siteCard")}
                  </ContextMenuItem>
                  {/* One Text entry, three modes (see blockModel); the inspector switches them later. */}
                  <ContextMenuSub>
                    <ContextMenuSubTrigger><NetsuIcon name="add-text" /> {t("boardMenu.text")}</ContextMenuSubTrigger>
                    <ContextMenuSubContent>
                      <ContextMenuItem onClick={() => board.current?.addText()}>
                        <NetsuIcon name="add-text" /> {t("textMode.text")}
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => board.current?.addBlock()}>
                        <NetsuIcon name="add-block" /> {t("textMode.block")}
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => board.current?.addNote()}>
                        <NetsuIcon name="mode-sheet" /> {t("textMode.sheet")}
                      </ContextMenuItem>
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  <ContextMenuItem onClick={() => board.current?.addFrame()}>
                    <NetsuIcon name="add-frame" /> {t("boardMenu.frame")}
                  </ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuItem onClick={() => board.current?.pasteClipboard()}>
                <NetsuIcon name="paste" /> {t("boardMenu.paste")}
              </ContextMenuItem>
              {hasSampleable && (
                <ContextMenuItem onClick={() => void extractPaletteToBoard()}>
                  <NetsuIcon name="extract-palette" /> {t("palette.extract")}
                </ContextMenuItem>
              )}

              <ContextMenuSeparator />

              <ContextMenuItem disabled={!canUndo} onClick={() => store().undo()}>
                <NetsuIcon name="undo" /> {t("actions.undo")}
              </ContextMenuItem>
              <ContextMenuItem disabled={!canRedo} onClick={() => store().redo()}>
                <NetsuIcon name="redo" /> {t("actions.redo")}
              </ContextMenuItem>
              {missingCount > 0 && (
                <ContextMenuItem onClick={() => void relocateMissingMedia()}>
                  <NetsuIcon name="relocate-missing" /> {t("boardMenu.relocateMissing", { count: missingCount })}
                </ContextMenuItem>
              )}

              <ContextMenuSeparator />

              <ContextMenuSub>
                <ContextMenuSubTrigger><NetsuIcon name="fullscreen" /> {t("boardMenu.groupView")}</ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  <ContextMenuItem disabled={!hasItems} onClick={() => store().selectAll()}>
                    <NetsuIcon name="select-all" /> {t("boardMenu.selectAll")}
                  </ContextMenuItem>
                  <ContextMenuItem disabled={!hasItems} onClick={() => board.current?.fit()}>
                    <NetsuIcon name="fit-all" /> {t("actions.fitAll")}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => board.current?.zoomBy(1.25)}>
                    <NetsuIcon name="zoom-in" /> {t("actions.zoomIn")}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => board.current?.zoomBy(0.8)}>
                    <NetsuIcon name="zoom-out" /> {t("actions.zoomOut")}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuCheckboxItem checked={!frozen} onCheckedChange={() => store().toggleFrozen()}>
                    <NetsuIcon name="freeze" on={frozen} /> {t("boardMenu.autoplay")}
                  </ContextMenuCheckboxItem>
                  <ContextMenuCheckboxItem
                    checked={background.mode === "dots"}
                    onCheckedChange={() => store().setBackground({ mode: background.mode === "dots" ? "solid" : "dots" })}
                  >
                    <NetsuIcon name="dot-bg" on={background.mode === "dots"} /> {t("boardMenu.dotBg")}
                  </ContextMenuCheckboxItem>
                  {hasDraw && (
                    <ContextMenuCheckboxItem checked={drawBack} onCheckedChange={() => store().setDrawBack(!drawBack)}>
                      <NetsuIcon name="z-back" /> {t("boardMenu.drawBack")}
                    </ContextMenuCheckboxItem>
                  )}
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuCheckboxItem checked={drawMode} onCheckedChange={() => store().setDrawMode(!drawMode)}>
                <NetsuIcon name="draw-toggle" on={drawMode} /> {t("boardMenu.drawMode")}
              </ContextMenuCheckboxItem>
              <ContextMenuSub>
                <ContextMenuSubTrigger><NetsuIcon name="save" /> {t("boardMenu.groupFile")}</ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  <ContextMenuItem onClick={() => store().newScene()}>
                    <NetsuIcon name="new-scene" /> {t("actions.newScene")}
                  </ContextMenuItem>
                  {onSave && <ContextMenuItem onClick={onSave}><NetsuIcon name="save" /> {t("common:action.save")}</ContextMenuItem>}
                  {onSaveAs && <ContextMenuItem onClick={onSaveAs}><NetsuIcon name="save-as" /> {t("toolbar.saveAs")}</ContextMenuItem>}
                  {onOpenProject && <ContextMenuItem onClick={onOpenProject}><NetsuIcon name="open-project-file" /> {t("boardMenu.openProject")}</ContextMenuItem>}
                  {onOpen && <ContextMenuItem onClick={onOpen}><NetsuIcon name="open-scene" /> {t("boardMenu.openScene")}</ContextMenuItem>}
                  {hasItems && (
                    <ContextMenuItem onClick={() => setImgExport(true)}>
                      <NetsuIcon name="export-image" /> {t("exportImage.menu")}
                    </ContextMenuItem>
                  )}
                </ContextMenuSubContent>
              </ContextMenuSub>

              {(onHome || onAttach || onTogglePin || onSettings) && <ContextMenuSeparator />}
              {onSettings && <ContextMenuItem onClick={onSettings}><NetsuIcon name="settings" /> {t("actions.settings")}</ContextMenuItem>}
              {onHome && <ContextMenuItem onClick={onHome}><NetsuIcon name="home" /> {t("boardMenu.backHome")}</ContextMenuItem>}
              {onTogglePin && (
                <ContextMenuCheckboxItem checked={!!pinned} onCheckedChange={onTogglePin}>
                  <NetsuIcon name="pin-window" on={!!pinned} /> {t("boardMenu.alwaysOnTop")}
                </ContextMenuCheckboxItem>
              )}
              {onAttach && <ContextMenuItem onClick={onAttach}><NetsuIcon name="attach" /> {t("actions.attach")}</ContextMenuItem>}
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      <AddLinkDialog board={board} open={ytOpen} onOpenChange={setYtOpen} />
      <AddLinkDialog board={board} open={cardOpen} onOpenChange={setCardOpen} asCard />
      <ExportImageDialog open={imgExport} onOpenChange={setImgExport} />
      {loopItem && <ExportLoopDialog item={loopItem} open onOpenChange={(v) => { if (!v) setLoopItem(null); }} />}
    </>
  );
}

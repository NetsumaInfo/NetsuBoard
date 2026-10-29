// "Extract pages as images" of a PDF card: every page (100 at most) rendered to a PNG asset, then
// either ONE sequence item (the board's carousel) or one image per page in a grid, placed to the
// right of the PDF card. One undo step either way. Lazy: pdf.js loads on the first extraction.

import i18n from "@/i18n";
import { nr } from "@/lib/bridge";
import { logError } from "@/lib/appLog";
import { errorText } from "@/lib/errorText";
import { displaySrc, topZ, type BoardItem } from "./referenceShared";
import { useBoard } from "./useReferenceBoard";
import { loadPdf, thumbScale } from "./boardPdf";
import { PDF_EXTRACT_SIDE, docCardSize, extractCount, gridFrom } from "./boardDocs";

export type ExtractMode = "sequence" | "separate";

const GAP = 48;
const running = new Set<string>();

async function renderPage(
  doc: Awaited<ReturnType<typeof loadPdf>>,
  index: number,
): Promise<{ blob: Blob; w: number; h: number }> {
  const page = await doc.getPage(index + 1);
  try {
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: thumbScale(base.width, base.height, PDF_EXTRACT_SIDE) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    const out = { w: canvas.width, h: canvas.height };
    canvas.width = canvas.height = 0;
    if (!blob) throw new Error("page encode failed");
    return { blob, ...out };
  } finally {
    page.cleanup();
  }
}

/** Renders the pages of the PDF card `itemId` and adds the result to the board. */
export async function extractPdfPages(itemId: string, mode: ExtractMode): Promise<void> {
  const start = useBoard.getState().items.find((it) => it.id === itemId);
  const docFile = start?.docFile;
  if (!start || !docFile || docFile.type !== "pdf" || running.has(itemId)) return;
  if (!nr.reference?.saveAsset) return;
  running.add(itemId);
  const notify = useBoard.getState().setNotice;
  try {
    const doc = await loadPdf({ url: displaySrc("image", docFile.ref) });
    try {
      const total = extractCount(doc.numPages);
      const stem = docFile.name.replace(/\.[^.]*$/, "") || docFile.name;
      const projectPath = useBoard.getState().filePath || undefined;
      const pages: { ref: string; w: number; h: number }[] = [];
      for (let i = 0; i < total; i++) {
        notify({ kind: "ok", sticky: true, text: i18n.t("reference:ingest.progress", { done: i, total }) });
        const page = await renderPage(doc, i);
        const saved = await nr.reference.saveAsset(await page.blob.arrayBuffer(), "png", { projectPath, title: `${stem}-p${i + 1}` });
        if (!saved.ok || !saved.path) throw new Error(saved.error || "page copy failed");
        pages.push({ ref: saved.path, w: page.w, h: page.h });
      }
      if (!pages.length) throw new Error("no page");

      // The card may have moved or been removed while the pages rendered.
      const store = useBoard.getState();
      const card = store.items.find((it) => it.id === itemId) ?? start;
      const x0 = card.x + card.w + GAP;
      let z = topZ(store.items);
      let added: BoardItem[];
      if (mode === "sequence") {
        const first = pages[0];
        const { w, h } = docCardSize(first.w, first.h, Math.max(card.w, card.h));
        added = [{
          id: "", kind: "sequence", ref: first.ref, src: "",
          x: x0, y: card.y, w, h, rotation: 0, z: ++z,
          natW: first.w, natH: first.h,
          frames: pages.map((p) => p.ref), frame: 0,
          fps: store.prefs.seqFps > 0 ? store.prefs.seqFps : 12, speed: 1, seqPlay: false,
          title: docFile.name,
        }];
      } else {
        const cell = Math.max(store.prefs.mediaMaxSize, 320);
        const spots = gridFrom(pages.length, cell, cell, { x: x0, y: card.y }, store.prefs.arrangeGap);
        added = pages.map((p, i) => {
          const { w, h } = docCardSize(p.w, p.h, cell);
          return {
            id: "", kind: "image", ref: p.ref, src: displaySrc("image", p.ref),
            x: spots[i].x + (cell - w) / 2, y: spots[i].y + (cell - h) / 2, w, h, rotation: 0, z: ++z,
            natW: p.w, natH: p.h, title: `${stem} ${i + 1}`,
          } satisfies BoardItem;
        });
      }
      useBoard.getState().addItems(added);
      notify({ kind: "ok", text: i18n.t("reference:ingest.done", { count: added.length }) });
    } finally {
      void doc.destroy();
    }
  } catch (e) {
    logError("board:pdf", `extract ${docFile.name}: ${errorText(e)}`);
    notify({ kind: "error", text: i18n.t("reference:pdf.extractFailed") });
  } finally {
    running.delete(itemId);
  }
}

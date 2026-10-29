// PDF support of the board, on top of pdf.js (Apache-2.0). Everything here is lazy: the library and
// its worker are only fetched the first time a PDF is dropped or opened, never at board start.

import type { PDFDocumentProxy } from "pdfjs-dist";

export const PDF_RE = /\.pdf$/i;
export const PDF_THUMB_SIDE = 1024;

export type PdfSource = { url: string } | { data: ArrayBuffer };

let libPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function lib() {
  if (!libPromise) {
    libPromise = (async () => {
      const [pdfjs, worker] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })();
    libPromise.catch(() => { libPromise = null; });
  }
  return libPromise;
}

/** Scale that brings the long side of a page to `side` pixels (never zero, never NaN). */
export function thumbScale(pageW: number, pageH: number, side = PDF_THUMB_SIDE): number {
  const long = Math.max(pageW, pageH);
  return long > 0 ? side / long : 1;
}

/** Pixel size of a page rendered at `cssWidth` CSS pixels wide on a screen of density `dpr`. */
export function pageCanvasSize(pageW: number, pageH: number, cssWidth: number, dpr: number) {
  const ratio = pageW > 0 ? pageH / pageW : 1.4142;
  const cssH = cssWidth * ratio;
  const k = Math.max(1, dpr);
  return { cssW: cssWidth, cssH, pxW: Math.max(1, Math.round(cssWidth * k)), pxH: Math.max(1, Math.round(cssH * k)) };
}

/** Opens a PDF. The caller owns the result and must `destroy()` it. */
export async function loadPdf(source: PdfSource): Promise<PDFDocumentProxy> {
  const pdfjs = await lib();
  let data: Uint8Array | undefined;
  if ("data" in source) data = new Uint8Array(source.data);
  else {
    const res = await fetch(source.url);
    if (!res.ok) throw new Error(`pdf fetch ${res.status}`);
    data = new Uint8Array(await res.arrayBuffer());
  }
  // No eval: the CSP forbids it, pdf.js then takes its plain path.
  return pdfjs.getDocument({ data, isEvalSupported: false }).promise;
}

/** Page 1 as a PNG blob (long side ~1024 px) plus the page size in PDF points and the page count. */
export async function renderPdfThumb(
  doc: PDFDocumentProxy,
): Promise<{ blob: Blob; w: number; h: number; pages: number }> {
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: thumbScale(base.width, base.height) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  // PDF pages are transparent: a white sheet behind, like every viewer.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  page.cleanup();
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error("thumbnail encode failed");
  return { blob, w: Math.round(base.width), h: Math.round(base.height), pages: doc.numPages };
}

// "Open document" from the context menu reaches the card that owns the live state.
const openBus = new EventTarget();

export function requestOpenDoc(id: string): void {
  openBus.dispatchEvent(new CustomEvent("open", { detail: id }));
}

export function onOpenDoc(cb: (id: string) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<string>).detail);
  openBus.addEventListener("open", handler);
  return () => openBus.removeEventListener("open", handler);
}

/** Zoom steps of the live viewer, as a factor of the card width. */
export const PDF_ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/** Next zoom step in `dir` (1 / -1); stays put at the ends and snaps an unknown value. */
export function stepZoom(current: number, dir: 1 | -1): number {
  if (dir === 1) return PDF_ZOOMS.find((z) => z > current + 1e-6) ?? PDF_ZOOMS[PDF_ZOOMS.length - 1];
  return [...PDF_ZOOMS].reverse().find((z) => z < current - 1e-6) ?? PDF_ZOOMS[0];
}

/** Index (0-based) of the page under the reading line, given each page's top offset. */
export function pageAtOffset(tops: number[], line: number): number {
  let lo = 0;
  let hi = tops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tops[mid] <= line) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

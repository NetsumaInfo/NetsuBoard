// Live PDF card, two reading modes remembered per card (`docFile.view`):
//  - "scroll": all pages stacked in a scroller; pages render lazily near the visible area and
//    release their canvas when they leave it;
//  - "pages": a carousel, one page at a time fitted to the card, prev/next buttons and Left/Right.
// The page width follows the card and the canvas is rendered at screen density x board zoom
// (capped), so the text stays crisp. The viewer (and the pdf.js document behind it) unmounts when
// the card stops being live. No JS animation.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import { useTranslation } from "react-i18next";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { nr } from "@/lib/bridge";
import { logError } from "@/lib/appLog";
import { errorText } from "@/lib/errorText";
import { displaySrc, type BoardItem } from "./referenceShared";
import { useBoard } from "./useReferenceBoard";
import { loadPdf, pageAtOffset, pageCanvasSize, stepZoom } from "./boardPdf";
import { stepPage } from "./boardDocs";

const PAD = 8; // gutter around a page, in CSS px
const A4_RATIO = 1.4142;
const MAX_CANVAS_SIDE = 4096; // device pixels, per page canvas

type Observe = (el: Element, cb: (visible: boolean) => void) => () => void;

function PdfPage({
  doc, index, cssW, ratio, pxScale, observe, eager, onRatio,
}: {
  doc: PDFDocumentProxy;
  index: number;
  cssW: number;
  ratio: number;
  pxScale: number;
  observe: Observe | null;
  eager?: boolean;
  onRatio: (index: number, ratio: number) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const visible = eager || near;

  useEffect(() => {
    if (eager || !observe || !boxRef.current) return;
    return observe(boxRef.current, setNear);
  }, [observe, eager]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!visible || !canvas || cssW <= 0) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    (async () => {
      const page = await doc.getPage(index + 1);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      onRatio(index, base.height / base.width);
      const k = Math.min(pxScale, MAX_CANVAS_SIDE / Math.max(cssW, cssW * (base.height / base.width)));
      const size = pageCanvasSize(base.width, base.height, cssW, k);
      canvas.width = size.pxW;
      canvas.height = size.pxH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      task = page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: size.pxW / base.width }) });
      await task.promise;
      page.cleanup();
    })().catch((e) => {
      if (e && (e as { name?: string }).name === "RenderingCancelledException") return;
      logError("board:pdf", `page ${index + 1}: ${errorText(e)}`);
    });
    return () => {
      cancelled = true;
      task?.cancel();
      // A zero-sized canvas frees its backing store.
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [visible, doc, index, cssW, pxScale, onRatio]);

  return (
    <div
      ref={boxRef}
      data-pdf-page={index}
      className={eager ? "m-auto bg-white shadow" : "mx-auto mb-2 bg-white shadow"}
      style={{ width: cssW, height: cssW * ratio }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

function ToolButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label={label} disabled={disabled} onClick={onClick} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export default function PdfViewer({ item }: { item: BoardItem }) {
  const { t } = useTranslation("reference");
  const docFile = item.docFile!;
  const view = docFile.view ?? "scroll";
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [current, setCurrent] = useState(1);
  const [ratios, setRatios] = useState<Record<number, number>>({});
  const [io, setIo] = useState<IntersectionObserver | null>(null);
  const listeners = useRef(new Map<Element, (visible: boolean) => void>());
  // Sharpness follows the board zoom (a card zoomed 2x on screen needs 2x the pixels), capped.
  const [boardScale] = useState(() => useBoard.getState().view.scale || 1);
  const pxScale = (window.devicePixelRatio || 1) * Math.min(3, Math.max(1, boardScale));

  // Document: opened on mount, destroyed on unmount (the card is no longer live).
  useEffect(() => {
    let alive = true;
    let opened: PDFDocumentProxy | null = null;
    loadPdf({ url: displaySrc("image", docFile.ref) })
      .then((d) => {
        if (!alive) { void d.destroy(); return; }
        opened = d;
        setDoc(d);
      })
      .catch((e) => {
        logError("board:pdf", `open ${docFile.name}: ${errorText(e)}`);
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      setDoc(null);
      void opened?.destroy();
    };
  }, [docFile.ref, docFile.name]);

  // One observer for all pages, rooted on the scroller.
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const listening = listeners.current;
    const obs = new IntersectionObserver(
      (entries) => { for (const e of entries) listening.get(e.target)?.(e.isIntersecting); },
      { root, rootMargin: "100% 0px" },
    );
    setIo(obs);
    return () => { obs.disconnect(); listening.clear(); setIo(null); };
  }, []);
  const observe = useMemo<Observe | null>(() => io && ((el, cb) => {
    listeners.current.set(el, cb);
    io.observe(el);
    return () => { listeners.current.delete(el); io.unobserve(el); };
  }), [io]);

  // Card size, quantised so a resize does not re-render every page on each pixel.
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const q = (n: number) => Math.max(0, Math.floor((n - PAD * 2) / 16) * 16);
    const ro = new ResizeObserver(() => setBox({ w: q(root.clientWidth), h: q(root.clientHeight) }));
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  const onRatio = useCallback((i: number, r: number) => {
    setRatios((prev) => (Math.abs((prev[i] ?? 0) - r) < 0.001 ? prev : { ...prev, [i]: r }));
  }, []);

  const pages = doc?.numPages ?? docFile.pages ?? 0;
  const firstRatio = ratios[0] ?? (item.natW && item.natH ? item.natH / item.natW : A4_RATIO);
  const ratioOf = (i: number) => ratios[i] ?? firstRatio;
  // Scroll: the page is as wide as the card. Pages: the whole page fits the card (zoom 1).
  const fitW = view === "pages" ? Math.min(box.w, box.h / ratioOf(current - 1)) : box.w;
  const cssW = Math.max(0, Math.floor(fitW * zoom));

  const setView = (next: "scroll" | "pages") =>
    useBoard.getState().patchItem(item.id, { docFile: { ...docFile, view: next } }, false);

  const onScroll = useCallback(() => {
    if (view !== "scroll") return;
    const root = scrollerRef.current;
    if (!root) return;
    const tops = Array.from(root.querySelectorAll<HTMLElement>("[data-pdf-page]"), (el) => el.offsetTop);
    setCurrent(pageAtOffset(tops, root.scrollTop + root.clientHeight / 3 + (tops[0] ?? 0)) + 1);
  }, [view]);

  // Back to the stacked pages: land on the page that was showing.
  const ready = !!doc && box.w > 0;
  useEffect(() => {
    if (view !== "scroll" || !ready) return;
    scrollerRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${current - 1}"]`)?.scrollIntoView({ block: "start" });
    // Only when the mode (or readiness) changes: scrolling itself updates `current`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, ready]);

  const go = useCallback((dir: 1 | -1) => setCurrent((c) => stepPage(c, dir, pages)), [pages]);

  // Carousel keys. Captured on the window so the board's arrow-key nudge never moves the card.
  useEffect(() => {
    if (view !== "pages") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) return;
      const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      go(dir);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [view, go]);

  const extract = (mode: "sequence" | "separate") =>
    void import("./boardDocExtract").then((m) => m.extractPdfPages(item.id, mode));

  return (
    <div
      className="flex h-full w-full cursor-default flex-col bg-neutral-700 text-white"
      // The card owns its pointer and wheel while live: neither moves nor zooms the board.
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="flex h-7 shrink-0 items-center gap-0.5 bg-black/60 px-1.5 text-[11px]">
        <span className="min-w-0 flex-1 truncate">{docFile.name}</span>
        {view === "pages" && (
          <>
            <ToolButton label={t("pdf.prevPage")} onClick={() => go(-1)} disabled={current <= 1}><NetsuIcon name="prev" /></ToolButton>
            <ToolButton label={t("pdf.nextPage")} onClick={() => go(1)} disabled={current >= pages}><NetsuIcon name="next" /></ToolButton>
          </>
        )}
        {pages > 0 && <span className="px-1 tabular-nums">{t("pdf.page", { page: current, total: pages })}</span>}
        <ToolButton
          label={t(view === "pages" ? "pdf.viewScroll" : "pdf.viewPages")}
          onClick={() => setView(view === "pages" ? "scroll" : "pages")}
        >
          <NetsuIcon name={view === "pages" ? "layout-rows" : "layout-carousel"} />
        </ToolButton>
        <ToolButton label={t("actions.zoomOut")} onClick={() => setZoom((z) => stepZoom(z, -1))}><NetsuIcon name="zoom-out" /></ToolButton>
        <ToolButton label={t("actions.zoomIn")} onClick={() => setZoom((z) => stepZoom(z, 1))}><NetsuIcon name="zoom-in" /></ToolButton>
        <ToolButton label={t("pdf.extractPages")} onClick={() => extract("sequence")}><NetsuIcon name="extract-pages" /></ToolButton>
        <ToolButton label={t("pdf.extractSeparate")} onClick={() => extract("separate")}><NetsuIcon name="extract-separate" /></ToolButton>
        <ToolButton label={t("pdf.openInApp")} onClick={() => void nr.openPath(docFile.ref)}><NetsuIcon name="open-external" /></ToolButton>
      </div>
      <div
        ref={scrollerRef}
        className={view === "pages" ? "flex min-h-0 flex-1 overflow-auto overscroll-contain" : "min-h-0 flex-1 overflow-auto overscroll-contain"}
        style={{ padding: PAD }}
        onScroll={onScroll}
      >
        {failed && <div className="p-4 text-center text-xs text-white/70">{t("pdf.loadFailed")}</div>}
        {doc && cssW > 0 && view === "scroll" && Array.from({ length: pages }, (_, i) => (
          <PdfPage
            key={i}
            doc={doc}
            index={i}
            cssW={cssW}
            ratio={ratioOf(i)}
            pxScale={pxScale}
            observe={observe}
            onRatio={onRatio}
          />
        ))}
        {doc && cssW > 0 && view === "pages" && (
          <PdfPage
            key={current}
            doc={doc}
            index={current - 1}
            cssW={cssW}
            ratio={ratioOf(current - 1)}
            pxScale={pxScale}
            observe={null}
            eager
            onRatio={onRatio}
          />
        )}
      </div>
    </div>
  );
}

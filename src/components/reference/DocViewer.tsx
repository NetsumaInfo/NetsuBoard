// Live reader of a non-PDF document card (Word, text, Markdown, CSV): the document on a paper-like
// page inside the board card. The card owns its pointer and wheel while live. Read once on mount,
// released on unmount. No JS animation.

import { useEffect, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { nr } from "@/lib/bridge";
import { logError } from "@/lib/appLog";
import { errorText } from "@/lib/errorText";
import { displaySrc, type BoardItem } from "./referenceShared";
import { stepZoom } from "./boardPdf";
import { NetsuIcon } from "@/components/ui/netsu-icon";

const BASE_PX = 14;

export default function DocViewer({ item }: { item: BoardItem }) {
  const { t } = useTranslation("reference");
  const docFile = item.docFile!;
  const [state, setState] = useState<{ html: string; plain: boolean } | "failed" | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let alive = true;
    (async () => {
      const render = await import("./boardDocRender");
      const buf = await render.fetchDocBytes(displaySrc("image", docFile.ref));
      const built = await render.buildDocHtml(docFile.type, buf, docFile.name);
      if (alive) setState(built);
    })().catch((e) => {
      logError("board:doc", `open ${docFile.name}: ${errorText(e)}`);
      if (alive) setState("failed");
    });
    return () => { alive = false; };
  }, [docFile.ref, docFile.name, docFile.type]);

  // Links open in the system browser, never inside the board.
  const onClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") || "";
    if (/^https?:\/\//i.test(href)) void nr.openExternal(href);
  };

  return (
    <div
      className="flex h-full w-full cursor-default flex-col bg-neutral-700 text-white"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="flex h-7 shrink-0 items-center gap-1 bg-black/60 px-1.5 text-[11px]">
        <span className="min-w-0 flex-1 truncate">{docFile.name}</span>
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-xs" aria-label={t("actions.zoomOut")} onClick={() => setZoom((z) => stepZoom(z, -1))} />}
          >
            <NetsuIcon name="zoom-out" />
          </TooltipTrigger>
          <TooltipContent>{t("actions.zoomOut")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-xs" aria-label={t("actions.zoomIn")} onClick={() => setZoom((z) => stepZoom(z, 1))} />}
          >
            <NetsuIcon name="zoom-in" />
          </TooltipTrigger>
          <TooltipContent>{t("actions.zoomIn")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-xs" aria-label={t("pdf.openInApp")} onClick={() => void nr.openPath(docFile.ref)} />}
          >
            <NetsuIcon name="open-external" />
          </TooltipTrigger>
          <TooltipContent>{t("pdf.openInApp")}</TooltipContent>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
        {state === "failed" && <div className="p-4 text-center text-xs text-white/70">{t("pdf.docLoadFailed")}</div>}
        {state && state !== "failed" && (
          <div
            className={state.plain ? "doc-paper doc-plain min-h-full" : "doc-paper min-h-full"}
            style={{ fontSize: BASE_PX * zoom }}
            onClick={onClick}
            // Sanitised by boardDocRender (allowlist; no script, handler, style or external load).
            dangerouslySetInnerHTML={{ __html: state.html }}
          />
        )}
      </div>
    </div>
  );
}

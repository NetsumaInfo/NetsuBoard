// Console (terminal) : flux des logs de l'interface ET du service core. Filtre par niveau, copie de
// la vue courante, copie des seules erreurs, export .txt, vidage. C'est la surface de debug de
// NetsuBoard — celle qu'on ouvre pour dire ce qui a lâché.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Trash2, Download, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  subscribeConsole, clearConsole, serializeConsole, getConsoleSnapshot, type ConsoleEntry,
} from "@/lib/appConsole";
import { MachineCard } from "./MachineCard";

const LEVEL_CLASS: Record<ConsoleEntry["level"], string> = {
  log: "text-foreground/80",
  warn: "text-[var(--color-warn)]",
  error: "text-destructive",
};

type Filter = "all" | "warn" | "error";

export function ConsolePanel() {
  const { t } = useTranslation("settings");
  const [logs, setLogs] = useState<ConsoleEntry[]>(() => getConsoleSnapshot());
  const [filter, setFilter] = useState<Filter>("all");
  const [copied, setCopied] = useState<"view" | "errors" | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => subscribeConsole(setLogs), []);

  const errors = useMemo(() => logs.filter((e) => e.level === "error"), [logs]);
  const warnCount = useMemo(() => logs.filter((e) => e.level === "warn").length, [logs]);
  // Vue filtrée : "warn" inclut aussi les erreurs (tout ce qui n'est pas un log normal).
  const visible = useMemo(() => {
    if (filter === "error") return errors;
    if (filter === "warn") return logs.filter((e) => e.level !== "log");
    return logs;
  }, [logs, filter, errors]);

  const text = useMemo(() => serializeConsole(visible), [visible]);
  // Auto-défilement vers le bas à chaque nouveau log.
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: "end" }); }, [visible]);

  async function write(content: string, which: "view" | "errors") {
    try {
      await navigator.clipboard.writeText(content || t("console.emptyClipboard"));
      setCopied(which);
      setTimeout(() => setCopied(null), 1200);
    } catch { /* presse-papier indisponible */ }
  }

  function exportTxt() {
    const blob = new Blob([text || ""], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `netsuboard-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">{t("console.title")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("console.subtitle")}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => void write(text, "view")}>
            {copied === "view" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {t("console.copy")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void write(serializeConsole(errors), "errors")} disabled={!errors.length}>
            {copied === "errors" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {t("console.errors")}
            {errors.length > 0 && <span className="text-destructive">({errors.length})</span>}
          </Button>
          <Button variant="outline" size="sm" onClick={exportTxt}>
            <Download className="size-3.5" /> {t("console.export")}
          </Button>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={clearConsole} aria-label={t("console.clearAria")} />}>
              <Trash2 className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>{t("console.clearAria")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="mt-3">
        <ToggleGroup
          value={[filter]}
          onValueChange={(v) => { const f = v[0] as Filter | undefined; if (f) setFilter(f); }}
          spacing={0}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="all" className="px-2.5 text-xs text-muted-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary">{t("console.all", { count: logs.length })}</ToggleGroupItem>
          <ToggleGroupItem value="warn" className="px-2.5 text-xs text-muted-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary">{t("console.warnings", { count: warnCount + errors.length })}</ToggleGroupItem>
          <ToggleGroupItem value="error" className="px-2.5 text-xs text-muted-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary">{t("console.errorsCount", { count: errors.length })}</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Le terminal prend toute la hauteur restante : un journal utile se lit long, pas en hublot. */}
      <div className="mt-3 min-h-40 flex-1 overflow-y-auto rounded-lg border border-border bg-input/30">
        <div className="p-3 font-mono text-[11px] leading-relaxed">
          {visible.length === 0 ? (
            <p className="text-muted-foreground">{logs.length === 0 ? t("console.empty") : t("console.emptyFilter")}</p>
          ) : (
            visible.map((e) => (
              <div key={e.id} className={cn("flex gap-2 break-all whitespace-pre-wrap", LEVEL_CLASS[e.level])}>
                <span className="shrink-0 text-muted-foreground">{new Date(e.t).toLocaleTimeString()}</span>
                <span className="shrink-0 text-muted-foreground">{e.source}</span>
                <span className="min-w-0">{e.message}</span>
                {(e.repeat ?? 1) > 1 && (
                  <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">×{e.repeat}</span>
                )}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <MachineCard />
    </section>
  );
}

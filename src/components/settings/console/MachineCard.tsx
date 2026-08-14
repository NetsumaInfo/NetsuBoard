// Bloc « machine » sous le terminal : version, OS, CPU, GPU, ffmpeg, encodeurs, disque. Il vit ICI
// et pas dans « À propos » parce qu'il ne sert qu'à une chose — accompagner un journal qu'on copie
// pour signaler un bug. La première question posée est toujours « quelle version, quel GPU », et la
// réponse doit être copiable en un clic plutôt que reconstituée à la main.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { nr, type BugContext } from "@/lib/bridge";
import { APP_VERSION } from "@/lib/release";

/** Résumé machine de NetsuBoard : pas de backends IA ni de python — l'app n'en embarque aucun. */
function summarize(ctx: BugContext): string {
  const disk = ctx.storage?.disk;
  return [
    `NetsuBoard : v${ctx.app.version || APP_VERSION} · langue ${ctx.app.lang || "auto"}`,
    `OS         : ${ctx.os.label} (${ctx.os.arch})`,
    `CPU        : ${ctx.cpu.name} · ${ctx.cpu.threads} threads`,
    `RAM        : ${ctx.memory.totalMB} Mo total · ${ctx.memory.freeMB} Mo libres`,
    `GPU        : ${ctx.gpu.label ?? "aucun"}`,
    ...ctx.gpu.devices.map((d) => `             ↳ ${d.name} · pilote ${d.driverVersion ?? "?"} · ${d.vendor}/${d.role}`),
    ctx.gpu.vram ? `VRAM       : ${ctx.gpu.vram.freeMB} Mo libres / ${ctx.gpu.vram.totalMB} Mo` : "",
    `Node       : ${ctx.runtime.node}`,
    `ffmpeg     : ${ctx.runtime.ffmpeg ?? "introuvable"}`,
    ctx.encoding ? `Encodeurs  : h264 ${ctx.encoding.h264 ?? "aucun"} · h265 ${ctx.encoding.h265 ?? "aucun"} · av1 ${ctx.encoding.av1 ?? "aucun"}` : "",
    `Stockage   : ${disk ? `${disk.freeGB} Go libres / ${disk.totalGB} Go` : "inconnu"}`,
  ].filter(Boolean).join("\n");
}

/** Repli quand le core ne répond pas : le peu que le renderer connaît, sans champ inventé. */
function fallbackSpecs(): string {
  const nav = typeof navigator === "undefined" ? null : navigator;
  return [
    `NetsuBoard : v${APP_VERSION}`,
    `Plateforme : ${nav?.platform || "inconnue"}`,
    `Langue     : ${nav?.language || "inconnue"}`,
    "Service    : hors ligne — machine non lue",
  ].join("\n");
}

export function MachineCard() {
  const { t } = useTranslation("settings");
  const [specs, setSpecs] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const read = useCallback(async () => {
    setLoading(true);
    const raw = await nr.bugContext?.().catch(() => null);
    // Service hors ligne : plutôt qu'un « lecture en cours » qui ne finit jamais, on rend ce que le
    // renderer sait seul. Le bloc reste copiable — c'est déjà mieux que rien dans un rapport.
    setSpecs(raw && (raw as BugContext).ok ? summarize(raw as BugContext) : fallbackSpecs());
    setLoading(false);
  }, []);

  useEffect(() => { void read(); }, [read]);

  async function copy() {
    if (!specs) return;
    try {
      await navigator.clipboard.writeText(specs);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* presse-papier indisponible */ }
  }

  return (
    <section className="mt-5 flex shrink-0 flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{t("bugReport.specs.title")}</h3>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => void copy()} disabled={!specs}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {t("bugReport.specs.copy")}
          </Button>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={() => void read()} aria-label={t("bugReport.specs.refresh")} />}>
              <RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
            </TooltipTrigger>
            <TooltipContent>{t("bugReport.specs.refresh")}</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <pre className="overflow-x-auto rounded-lg border border-border bg-input/30 p-3 font-mono text-[11px] leading-relaxed text-foreground/80">
        {specs ?? t("bugReport.specs.loading")}
      </pre>
    </section>
  );
}

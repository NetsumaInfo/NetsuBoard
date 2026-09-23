// Bloc « machine » sous le terminal : version, OS, CPU, GPU, ffmpeg, encodeurs, disque. Il vit ICI
// et pas dans « À propos » parce qu'il ne sert qu'à une chose — accompagner un journal qu'on copie
// pour signaler un bug. La première question posée est toujours « quelle version, quel GPU », et la
// réponse doit être copiable en un clic plutôt que reconstituée à la main.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { TFunction } from "i18next";
import { nr, type BugContext } from "@/lib/bridge";
import { APP_VERSION } from "@/lib/release";
import { fmtBytes } from "@/lib/utils";

const MB = 1024 * 1024;
const GB = 1024 * MB;

// Labels are padded to one column so the block stays readable once pasted as plain text. The
// separator is the language's own ("Label : " in French, "Label: " in English, "Label：" in Japanese).
function table(rows: [string, string][], t: TFunction<"settings">): string {
  const width = Math.max(...rows.map(([label]) => label.length));
  const indent = " ".repeat(t("bugReport.specs.machine.row", { label: "".padEnd(width), value: "" }).length);
  return rows
    .map(([label, value]) => (label ? t("bugReport.specs.machine.row", { label: label.padEnd(width), value }) : `${indent}${value}`))
    .join("\n");
}

/** Résumé machine de NetsuBoard : pas de backends IA ni de python — l'app n'en embarque aucun. */
function summarize(ctx: BugContext, t: TFunction<"settings">): string {
  const disk = ctx.storage?.disk;
  const none = t("bugReport.specs.machine.none");
  const rows: [string, string][] = [
    ["NetsuBoard", `v${ctx.app.version || APP_VERSION}`],
    [t("bugReport.specs.machine.language"), ctx.app.lang || "auto"],
    ["OS", `${ctx.os.label} (${ctx.os.arch})`],
    ["CPU", `${ctx.cpu.name} · ${t("bugReport.specs.machine.threads", { count: ctx.cpu.threads })}`],
    ["RAM", t("bugReport.specs.machine.ram", { total: fmtBytes(ctx.memory.totalMB * MB), free: fmtBytes(ctx.memory.freeMB * MB) })],
    ["GPU", ctx.gpu.label ?? none],
    ...ctx.gpu.devices.map((d): [string, string] => [
      "",
      `↳ ${d.name} · ${t("bugReport.specs.machine.driver", { version: d.driverVersion ?? "?" })} · ${d.vendor}/${d.role}`,
    ]),
  ];
  if (ctx.gpu.vram) {
    rows.push(["VRAM", t("bugReport.specs.machine.freeOfTotal", {
      free: fmtBytes(ctx.gpu.vram.freeMB * MB),
      total: fmtBytes(ctx.gpu.vram.totalMB * MB),
    })]);
  }
  rows.push(["Node", ctx.runtime.node], ["ffmpeg", ctx.runtime.ffmpeg ?? t("bugReport.specs.machine.notFound")]);
  if (ctx.encoding) {
    rows.push([
      t("bugReport.specs.machine.encoders"),
      `h264 ${ctx.encoding.h264 ?? none} · h265 ${ctx.encoding.h265 ?? none} · av1 ${ctx.encoding.av1 ?? none}`,
    ]);
  }
  rows.push([
    t("bugReport.specs.machine.storage"),
    disk
      ? t("bugReport.specs.machine.freeOfTotal", { free: fmtBytes(disk.freeGB * GB), total: fmtBytes(disk.totalGB * GB) })
      : t("bugReport.specs.machine.unknown"),
  ]);
  return table(rows, t);
}

/** Repli quand le core ne répond pas : le peu que le renderer connaît, sans champ inventé. */
function fallbackSpecs(t: TFunction<"settings">): string {
  const nav = typeof navigator === "undefined" ? null : navigator;
  const unknown = t("bugReport.specs.machine.unknown");
  return table([
    ["NetsuBoard", `v${APP_VERSION}`],
    [t("bugReport.specs.machine.platform"), nav?.platform || unknown],
    [t("bugReport.specs.machine.language"), nav?.language || unknown],
    [t("bugReport.specs.machine.service"), t("bugReport.specs.machine.offline")],
  ], t);
}

export function MachineCard() {
  const { t } = useTranslation("settings");
  // `null` = not read yet, `false` = service offline. The text is built at render time, so it
  // follows a language switch without a new read.
  const [context, setContext] = useState<BugContext | false | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const specs = context === null ? null : context ? summarize(context, t) : fallbackSpecs(t);

  const read = useCallback(async () => {
    setLoading(true);
    const raw = await nr.bugContext?.().catch(() => null);
    // Service hors ligne : plutôt qu'un « lecture en cours » qui ne finit jamais, on rend ce que le
    // renderer sait seul. Le bloc reste copiable — c'est déjà mieux que rien dans un rapport.
    setContext(raw && (raw as BugContext).ok ? (raw as BugContext) : false);
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

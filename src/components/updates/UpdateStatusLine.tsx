import { CheckCircle2, Download, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UpdateInfo, UpdatePhase } from "@/store/updater";
import { cn } from "@/lib/utils";

// i18n key for the current phase. SINGLE source: the settings page shows it as text, the title bar
// puts it in a tooltip — two wordings would drift apart.
function updateStatusKey(phase: UpdatePhase) {
  if (phase === "checking") return "updates.checking";
  if (phase === "available") return "updates.available";
  if (phase === "downloading") return "updates.downloading";
  if (phase === "downloaded") return "updates.downloaded";
  if (phase === "installing") return "updates.installing";
  if (phase === "error") return "updates.failed";
  if (phase === "current") return "updates.current";
  return "updates.ready";
}

// Label + dot for the update state.
export function UpdateStatusLine({ phase, info, className }: { phase: UpdatePhase; info: UpdateInfo | null; className?: string }) {
  const { t } = useTranslation("settings");
  const pending = phase === "available" || phase === "downloading" || phase === "downloaded" || phase === "installing";
  const Icon = pending ? Download : phase === "error" ? TriangleAlert : CheckCircle2;
  const tone = pending ? "text-primary" : phase === "error" ? "text-destructive" : "text-[var(--color-ok)]";
  return (
    <div className={cn("flex min-w-0 items-center gap-2 text-sm", className)}>
      <Icon className={cn("size-4 shrink-0", tone)} />
      <span className="truncate">{t(updateStatusKey(phase), { version: info?.version })}</span>
    </div>
  );
}

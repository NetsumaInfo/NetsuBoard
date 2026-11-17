// Export of the open Animatic as an MP4: what Present shows, with the music. Size and frame rate
// are kept on this device for the next export.

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { nr } from "@/lib/bridge";
import { fmtBytes } from "@/lib/utils";
import { errorText } from "@/lib/errorText";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Progress } from "@/components/ui/progress";
import { useBoard } from "../useReferenceBoard";
import { clipDuration, type ClipData } from "./clipModel";
import { openClipCard } from "./clipSelectors";
import { exportAnimatic, type AnimaticExportProgress } from "./exportAnimatic";
import { EXPORT_FPS, EXPORT_SIZES, exportFileName, frameCount, type ExportFps, type ExportSizeId } from "./exportPlan";

const PREFS_KEY = "netsuboard.animatic.export";

function readPrefs(): { size: ExportSizeId; fps: ExportFps } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    return {
      size: EXPORT_SIZES.some((s) => s.id === p.size) ? p.size : "1080p",
      fps: EXPORT_FPS.includes(p.fps) ? p.fps : 30,
    };
  } catch {
    return { size: "1080p", fps: 30 };
  }
}

function savePrefs(p: { size: ExportSizeId; fps: ExportFps }) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private window: defaults next time */ }
}

// The board's own background when it is a plain colour, black otherwise (a video has no transparency).
function boardBackground(): string {
  const c = useBoard.getState().background?.color;
  return c && /^(#|rgb|hsl)/i.test(c) ? c : "#000";
}

const fmtTime = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

export function ClipExportDialog({ clip, open, onOpenChange }: { clip: ClipData; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation("reference");
  const setNotice = useBoard((s) => s.setNotice);
  const [prefs, setPrefs] = useState(readPrefs);
  const [progress, setProgress] = useState<AnimaticExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const busy = progress !== null;

  const size = EXPORT_SIZES.find((s) => s.id === prefs.size) ?? EXPORT_SIZES[1];
  const duration = clipDuration(clip);
  const pick = (p: Partial<typeof prefs>) => {
    const next = { ...prefs, ...p };
    setPrefs(next);
    savePrefs(next);
  };

  async function run() {
    setError(null);
    const out = await nr.saveFile(exportFileName(openClipCard(useBoard.getState())?.title));
    if (!out) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setProgress({ phase: "prepare", done: 0, total: 1 });
    try {
      const r = await exportAnimatic(
        clip,
        { out, width: size.w, height: size.h, fps: prefs.fps, background: boardBackground() },
        setProgress,
        ctl.signal,
      );
      if (r.ok) {
        setNotice({ kind: "ok", text: t("clip.export.done", { size: fmtBytes(r.bytes) }) });
        onOpenChange(false);
      } else if (!r.cancelled) setError(r.error || t("clip.export.failed"));
    } catch (e) {
      setError(errorText(e));
      void nr.reference?.animaticExportCancel();
    } finally {
      abort.current = null;
      setProgress(null);
    }
  }

  // Closing while an export runs stops it: nothing would be left to report its end to.
  function close() {
    abort.current?.abort();
    onOpenChange(false);
  }

  const pct = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;
  const status = !progress
    ? null
    : progress.phase === "prepare"
      ? t("clip.export.preparing")
      : progress.phase === "finish"
        ? t("clip.export.finishing")
        : t("clip.export.frames", { done: progress.done, total: progress.total });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <NetsuIcon name="render" busy={busy} /> {t("clip.export.title")}
          </DialogTitle>
          <DialogDescription>{t("clip.export.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className={`space-y-4 ${busy ? "pointer-events-none opacity-60" : ""}`}>
          <div className="space-y-1.5">
            <span className="text-xs text-muted-foreground">{t("clip.export.size")}</span>
            <ToggleGroup value={[prefs.size]} onValueChange={(v) => v[0] && pick({ size: v[0] as ExportSizeId })}>
              {EXPORT_SIZES.map((s) => (
                <ToggleGroupItem key={s.id} value={s.id} disabled={busy}>{s.id === "2160p" ? "4K" : s.id}</ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="space-y-1.5">
            <span className="text-xs text-muted-foreground">{t("clip.export.fps")}</span>
            <ToggleGroup value={[String(prefs.fps)]} onValueChange={(v) => v[0] && pick({ fps: Number(v[0]) as ExportFps })}>
              {EXPORT_FPS.map((f) => (
                <ToggleGroupItem key={f} value={String(f)} disabled={busy}>{f}</ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <p className="text-xs tabular-nums text-muted-foreground">
            {t("clip.export.summary", { time: fmtTime(duration), frames: frameCount(clip, prefs.fps) })}
          </p>
        </div>

        {busy && (
          <div className="space-y-1.5">
            <Progress value={pct} />
            <p className="text-xs tabular-nums text-muted-foreground">{status}</p>
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={close}>{t("common:action.cancel")}</Button>
          <Button onClick={() => void run()} disabled={busy}>
            {busy ? t("clip.export.exporting") : t("clip.export.export")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

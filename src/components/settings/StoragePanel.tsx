// Paramètres › Stockage. Le magasin de l'app grossit sans que rien ne le dise : image collée, média
// récupéré d'un lien, frames extraites, sortie d'upscale. Une partie de ces octets est un DOUBLE —
// l'enregistrement d'un projet .netsu les a rangés dans son dossier compagnon — et une autre partie
// est la SEULE copie qui existe.
//
// Le panneau ne mélange jamais les deux. Ce qui est libérable l'est parce que le core a trouvé les
// mêmes octets ailleurs, pas parce que l'âge du fichier le suggère ; ce qui n'existe qu'ici n'a
// pas de bouton « supprimer » du tout, seulement de quoi le mettre à l'abri d'abord.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, FolderInput, HardDrive, Loader2, Save, Sparkles, Users } from "lucide-react";
import { nr, type StorageAudit } from "@/lib/bridge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { logError } from "@/lib/appLog";
import { useBoard } from "@/components/reference/useReferenceBoard";
import { liveMediaRefs } from "@/components/reference/useScenePersistence";
import { errorText } from "@/lib/errorText";
import { fmtBytes } from "@/lib/utils";

const humanSize = (bytes: number): string => fmtBytes(bytes);

function fileLabel(filePath: string): string {
  return filePath.replace(/^.*[\\/]/, "").replace(/\.netsu$/i, "");
}

function Row({ label, hint, size, icon: Icon }: {
  label: string;
  hint: string;
  size: number;
  icon: typeof HardDrive;
}) {
  return (
    <div className="flex items-start gap-2.5 py-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{label}</p>
        <p className="text-xs leading-snug text-muted-foreground">{hint}</p>
      </div>
      <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{humanSize(size)}</span>
    </div>
  );
}

export function StoragePanel() {
  const { t } = useTranslation(["settings", "common"]);
  const [audit, setAudit] = useState<StorageAudit | null>(null);
  const [busy, setBusy] = useState<null | "scan" | "free" | "move" | "archive">("scan");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  // La scène ouverte a « Enregistrer sous » à portée dans le board : l'archiver dans son dos
  // remplacerait le document sous les pieds de la fenêtre qui l'affiche.
  const openSceneId = useBoard((state) => state.sceneId);

  const scan = useCallback(async (mode: "scan" | null = "scan") => {
    if (mode) setBusy(mode);
    try {
      const result = await nr.reference?.storageAudit({ liveRefs: liveMediaRefs() });
      setAudit(result ?? null);
      if (result && !result.ok && result.error) setNotice({ kind: "error", text: result.error });
    } catch (error) {
      logError("settings:storage", `audit échoué — ${String(error)}`);
      setNotice({ kind: "error", text: errorText(error) });
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => { void scan("scan"); }, [scan]);

  const assets = audit?.ok ? audit.assets : undefined;
  const caches = audit?.ok ? audit.caches ?? [] : [];
  const cacheBytes = caches.reduce((total, entry) => total + entry.bytes, 0);
  const freeableBytes = cacheBytes + (assets?.freeable.bytes ?? 0);
  const atRiskScenes = assets?.held.scenes ?? [];
  const orphans = assets?.orphans;

  async function free() {
    setBusy("free");
    setNotice(null);
    try {
      const result = await nr.reference?.storageFree({ caches: true, assets: true, liveRefs: liveMediaRefs() });
      setNotice(result?.ok
        ? { kind: "ok", text: t("settings:storage.freedNotice", { size: humanSize(result.bytes), count: result.files }) }
        : { kind: "error", text: result?.error ?? t("settings:storage.failed") });
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error) });
    }
    await scan(null);
  }

  async function moveOrphans() {
    const destDir = await nr.chooseDir();
    if (!destDir) return;
    setBusy("move");
    setNotice(null);
    try {
      const result = await nr.reference?.storageMoveOrphans({ destDir, liveRefs: liveMediaRefs() });
      if (result?.ok) {
        const failed = result.failed?.length ?? 0;
        setNotice({
          kind: failed ? "error" : "ok",
          text: failed
            ? t("settings:storage.movedPartly", { count: result.files, failed })
            : t("settings:storage.movedNotice", { size: humanSize(result.bytes), count: result.files }),
        });
      } else {
        setNotice({ kind: "error", text: result?.error ?? t("settings:storage.failed") });
      }
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error) });
    }
    await scan(null);
  }

  async function archive(scene: { id: string; name: string }) {
    const destPath = await nr.reference?.saveNetsuPath(`${scene.name || "board"}.netsu`);
    if (!destPath) return;
    setBusy("archive");
    setNotice(null);
    try {
      const result = await nr.reference?.storageArchiveScene({ sceneId: scene.id, destPath });
      setNotice(result?.ok
        ? { kind: "ok", text: t("settings:storage.archivedNotice", { name: fileLabel(destPath) }) }
        : { kind: "error", text: result?.error ?? t("settings:storage.failed") });
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error) });
    }
    await scan(null);
  }

  if (busy === "scan" && !audit) {
    return (
      <div className="grid flex-1 place-items-center gap-2 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        <p className="text-xs">{t("settings:storage.scanning")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-foreground">{t("settings:storage.title")}</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">{t("settings:storage.intro")}</p>
        {audit?.disk && (
          <p className="text-xs text-muted-foreground">
            {t("settings:storage.disk", { free: humanSize(audit.disk.free), total: humanSize(audit.disk.total) })}
          </p>
        )}
      </header>

      {notice && (
        <p className={notice.kind === "error" ? "text-xs text-destructive" : "text-xs text-[var(--color-ok)]"}>
          {notice.text}
        </p>
      )}

      {/* SECTION 1 — vérifié : ces octets existent ailleurs, ou se refabriquent. */}
      <section className="flex flex-col gap-1 rounded-lg border border-border p-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <h4 className="text-sm font-medium text-foreground">{t("settings:storage.safe.title")}</h4>
          <span className="text-sm font-medium tabular-nums text-foreground">{humanSize(freeableBytes)}</span>
        </div>
        <p className="mb-1 text-xs leading-snug text-muted-foreground">{t("settings:storage.safe.hint")}</p>

        <div className="divide-y divide-border">
          <Row
            icon={Sparkles}
            label={t("settings:storage.safe.caches")}
            hint={t("settings:storage.safe.cachesHint")}
            size={cacheBytes}
          />
          <Row
            icon={HardDrive}
            label={t("settings:storage.safe.duplicated", { count: assets?.freeable.files ?? 0 })}
            hint={assets?.freeable.entries.length
              ? t("settings:storage.safe.duplicatedHint", {
                project: fileLabel(assets.freeable.entries.find((entry) => entry.project)?.project ?? ""),
              })
              : t("settings:storage.safe.duplicatedNone")}
            size={assets?.freeable.bytes ?? 0}
          />
        </div>

        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" onClick={() => void free()} disabled={!!busy || freeableBytes === 0}>
            {busy === "free" ? <Loader2 className="animate-spin" /> : null}
            {t("settings:storage.safe.action")}
          </Button>
          {!!assets?.settling && (
            <Tooltip>
              <TooltipTrigger render={<span className="text-xs text-muted-foreground" />}>
                {t("settings:storage.settling", { count: assets.settling })}
              </TooltipTrigger>
              <TooltipContent>{t("settings:storage.settlingHint")}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </section>

      {/* SECTION 2 — copie unique : aucun bouton de suppression, seulement de quoi la mettre ailleurs. */}
      <section className="flex flex-col gap-2 rounded-lg border border-border p-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <h4 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <AlertTriangle className="size-3.5 text-[var(--color-warn,#d97706)]" />
            {t("settings:storage.sole.title")}
          </h4>
          <span className="text-sm font-medium tabular-nums text-foreground">
            {humanSize((orphans?.bytes ?? 0) + atRiskScenes.reduce((total, scene) => total + scene.soleBytes, 0))}
          </span>
        </div>
        <p className="text-xs leading-snug text-muted-foreground">{t("settings:storage.sole.hint")}</p>

        {!atRiskScenes.length && !orphans?.files && (
          <p className="py-1 text-xs text-muted-foreground">{t("settings:storage.sole.empty")}</p>
        )}

        {atRiskScenes.map((scene) => (
          <div key={scene.id} className="flex items-center gap-2.5 border-t border-border pt-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-foreground">
                {scene.name || t("settings:storage.sole.untitled")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("settings:storage.sole.sceneCount", { count: scene.soleFiles, size: humanSize(scene.soleBytes) })}
              </p>
            </div>
            {scene.collaborative ? (
              <Tooltip>
                <TooltipTrigger
                  render={<span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground" />}
                >
                  <Users className="size-3.5" /> {t("settings:storage.sole.shared")}
                </TooltipTrigger>
                <TooltipContent>{t("settings:storage.sole.sharedHint")}</TooltipContent>
              </Tooltip>
            ) : scene.id === openSceneId ? (
              <Tooltip>
                <TooltipTrigger render={<span className="shrink-0 text-xs text-muted-foreground" />}>
                  {t("settings:storage.sole.openBoard")}
                </TooltipTrigger>
                <TooltipContent>{t("settings:storage.sole.openBoardHint")}</TooltipContent>
              </Tooltip>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={!!busy}
                onClick={() => void archive(scene)}
              >
                <Save /> {t("settings:storage.sole.archive")}
              </Button>
            )}
          </div>
        ))}

        {!!orphans?.files && (
          <div className="flex items-center gap-2.5 border-t border-border pt-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground">{t("settings:storage.sole.orphans")}</p>
              <p className="text-xs leading-snug text-muted-foreground">
                {t("settings:storage.sole.orphansHint", { count: orphans.files, size: humanSize(orphans.bytes) })}
              </p>
            </div>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void moveOrphans()}>
              {busy === "move" ? <Loader2 className="animate-spin" /> : <FolderInput />}
              {t("settings:storage.sole.move")}
            </Button>
          </div>
        )}
      </section>

      <p className="text-[11px] leading-relaxed text-muted-foreground">{t("settings:storage.footnote")}</p>
    </div>
  );
}

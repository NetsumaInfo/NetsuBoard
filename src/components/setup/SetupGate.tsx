// Premier lancement : le socle (ffmpeg, shaders GLSL, yt-dlp) se provisionne SEUL.
//
// Il n'y a rien à choisir, donc rien n'est demandé. NetsuBoard n'exécute aucun modèle — l'upscale
// est du GLSL passé à libplacebo — si bien qu'un catalogue de poids à cocher n'avait aucun effet sur
// l'application : il faisait attendre l'utilisateur devant une décision sans conséquence.
//
// Le téléchargement démarre donc AVANT toute interaction, pendant que l'écran de langue est affiché.
// Sur une connexion correcte le socle est souvent posé quand la langue vient d'être choisie : l'écran
// suivant n'a plus qu'à annoncer le redémarrage. Langue déjà choisie (réparation, mise à jour) ⇒ plus
// aucun écran de configuration, seulement la progression.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  RotateCw,
  Terminal,
  TriangleAlert,
} from "lucide-react";
import { nr } from "@/lib/bridge";
import type { SetupDownload, SetupProgress } from "@/lib/bridge";
import { hasChosenLang, LANGUAGES, type LangCode } from "@/i18n";
import { useApp } from "@/store";
import { FlagIcon } from "@/components/language/FlagIcon";
import { GateFrame } from "@/components/auth/GateFrame";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { ErrorReportButton } from "@/components/common/ErrorReportButton";

type Phase = "checking" | "language" | "install" | "done";
// Résultat du provisionnement, indépendant de l'écran affiché : il tourne DERRIÈRE l'écran de langue.
type Install = "running" | "ok" | "error";
// La couleur distingue « terminé », « déjà présent » et « échoué » sans relire chaque ligne.
type LogTone = "plain" | "ok" | "warn" | "error" | "muted";
type LogEntry = { text: string; tone: LogTone };
// Téléchargement EN COURS : une ligne vivante qui se met à jour, retirée dès qu'elle se conclut.
type ActiveDownload = SetupDownload & { speed: number; at: number };

const TONE_CLASS: Record<LogTone, string> = {
  plain: "text-foreground/80",
  ok: "text-[var(--color-ok)]",
  warn: "text-[var(--color-warn)]",
  error: "text-destructive",
  muted: "text-muted-foreground",
};

// Un état = une couleur, la même dans la barre et dans la ligne de journal qui lui succède.
const DOWNLOAD_TONE: Record<SetupDownload["state"], LogTone> = {
  download: "ok",
  work: "plain",
  retry: "warn",
  error: "error",
  done: "ok",
  skip: "muted",
};
const BAR_COLOR: Record<SetupDownload["state"], string> = {
  download: "var(--color-ok)",
  work: "var(--primary)",
  retry: "var(--color-warn)",
  error: "var(--destructive)",
  done: "var(--color-ok)",
  skip: "var(--muted-foreground)",
};

// Verdict du dernier contrôle réussi. Ce gate protège une INSTALLATION incomplète — un état qui ne
// change pas d'un lancement à l'autre. Faire patienter tout le monde devant un écran de chargement
// pour un verdict qui est « prêt » à tous les démarrages sauf le premier revient à payer le cas rare
// avec le temps du cas normal. On rend donc l'application immédiatement et on revérifie EN FOND :
// si l'installation s'est cassée entre-temps, l'écran reprend la main dans la foulée.
const READY_KEY = "nr.setup.ready";
function rememberedReady() {
  try { return localStorage.getItem(READY_KEY) === "1"; } catch { return false; }
}
function rememberReady(ready: boolean) {
  try { localStorage.setItem(READY_KEY, ready ? "1" : "0"); } catch { /* stockage indisponible : contrôle bloquant, comme avant */ }
}

export function SetupGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation(["setup", "common", "language"]);
  const lang = useApp((state) => state.lang);
  const setLang = useApp((state) => state.setLang);
  const [phase, setPhase] = useState<Phase>(() => (rememberedReady() ? "done" : "checking"));
  // La langue est le SEUL choix du premier lancement, et il ne retarde pas le téléchargement.
  const [needLang] = useState(() => !hasChosenLang());
  const [install, setInstall] = useState<Install>("running");
  const [prog, setProg] = useState<SetupProgress>({});
  const [log, setLog] = useState<LogEntry[]>([]);
  const [downloads, setDownloads] = useState<ActiveDownload[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Incidents NON bloquants remontés par le core pendant le provisionnement (`stage: "error"`).
  // L'installation continue et peut se terminer « réussie », donc rien n'alerterait : sans ça, la
  // trace part avec le redémarrage.
  const [issues, setIssues] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  // Un provisionnement à la fois : l'effet de statut peut se rejouer (StrictMode, revérification).
  const runningRef = useRef(false);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log, downloads.length]);

  useEffect(() => {
    let alive = true;
    nr.setupStatus()
      .then((next) => {
        if (!alive) return;
        rememberReady(next.ready);
        // Le contrôle de fond ne reprend la main que s'il INFIRME le verdict mémorisé : une
        // installation cassée (runtime supprimé, mise à jour incomplète) ramène l'écran de
        // réparation, sinon l'utilisateur ne voit jamais ce gate.
        if (next.ready) {
          setPhase("done");
          return;
        }
        setPhase(needLang ? "language" : "install");
        void runInstall();
      })
      .catch((cause) => {
        if (!alive) return;
        // Service injoignable : ça ne dit RIEN de l'installation. Sur une application déjà validée,
        // on la laisse ouverte (elle signale elle-même son service hors ligne, qui se relance seul).
        // Au tout premier lancement en revanche, rien n'est vérifié : l'écran reste, avec Réessayer.
        if (rememberedReady()) {
          setPhase("done");
          return;
        }
        setError(String(cause));
        setInstall("error");
        setPhase(needLang ? "language" : "install");
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyDownload(next: SetupDownload) {
    const at = Date.now();
    setDownloads((current) => {
      const previous = current.find((entry) => entry.name === next.name);
      if (next.state === "done" || next.state === "error" || next.state === "skip") {
        setLog((entries) => [...entries.slice(-499), {
          text: `${next.state === "done" ? "✓" : next.state === "skip" ? "•" : "✕"} ${next.name}`,
          tone: DOWNLOAD_TONE[next.state],
        }]);
        return current.filter((entry) => entry.name !== next.name);
      }
      // Débit instantané : différence d'octets sur le temps écoulé depuis la dernière trame.
      const elapsed = previous ? (at - previous.at) / 1000 : 0;
      const speed = previous && elapsed > 0.2 ? Math.max(0, (next.done - previous.done) / elapsed) : previous?.speed ?? 0;
      const entry: ActiveDownload = { ...next, speed, at };
      return previous
        ? current.map((item) => (item.name === next.name ? entry : item))
        : [...current, entry];
    });
  }

  async function runInstall() {
    if (runningRef.current) return;
    runningRef.current = true;
    setInstall("running");
    setError(null);
    setProg({ pct: 0 });
    setLog([]);
    setDownloads([]);
    setIssues([]);
    const off = nr.onSetupProgress((progress) => {
      if (progress.dl) { applyDownload(progress.dl); return; }
      setProg((previous) => ({ ...previous, ...progress }));
      const entry: LogEntry | null = progress.stage === "error"
        ? { text: `✕ ${progress.label ?? ""}`, tone: "error" }
        : progress.line != null
          ? { text: progress.line, tone: "muted" }
          : progress.label
            ? { text: `▶ ${progress.label}`, tone: "plain" }
            : null;
      if (entry != null) setLog((previous) => [...previous.slice(-499), entry]);
      if (progress.stage === "error") setIssues((previous) => [...previous, progress.label ?? progress.line ?? "?"]);
    });
    try {
      const result = await nr.setupRun();
      if (result.ok) setInstall("ok");
      else {
        setError(result.error || t("setup:installFailed"));
        setInstall("error");
      }
    } catch (cause) {
      setError(String(cause));
      setInstall("error");
    } finally {
      off();
      runningRef.current = false;
      // Plus aucun octet n'arrivera : une barre laissée en place se figerait à mi-course.
      setDownloads([]);
    }
  }

  function pickLanguage(code: LangCode) {
    void setLang(code);
  }

  if (phase === "done") return <>{children}</>;
  if (phase === "checking") {
    return (
      <GateFrame contentClassName="max-w-md">
        <div className="grid min-h-48 place-items-center">
          <div className="space-y-3 text-center"><Spinner className="mx-auto size-6 text-muted-foreground" /><p className="text-sm text-muted-foreground">{t("setup:scan.running")}</p></div>
        </div>
      </GateFrame>
    );
  }

  const errorBlock = install === "error" && (
    <div className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
      <div className="flex items-start gap-2">
        <TriangleAlert className="size-4 shrink-0" /><span className="break-words">{error}</span>
      </div>
      {/* Une installation qui échoue laisse l'app inutilisable : le rapport doit partir d'ICI,
          les Paramètres étant derrière l'écran bloqué. */}
      <ErrorReportButton
        className="self-start"
        error={[error ?? "", ...issues, logText(log.slice(-20))].filter(Boolean).join("\n")}
        subject="Échec de l'installation (téléchargement des dépendances)"
        module="setup"
        moduleLabel="Installation"
      />
    </div>
  );

  return (
    <GateFrame contentClassName="max-w-4xl">
      <Card className="w-full max-w-3xl gap-6 p-7">
        <header>
          {/* Pas de sous-titre : il annonçait un « reste optionnel » qui n'existe plus, et l'écran
              n'a plus rien à expliquer — il installe, c'est tout. */}
          <h1 className="text-xl font-semibold tracking-tight">{t("setup:title")}</h1>
        </header>

        {phase === "language" && (
          <section className="flex flex-col gap-4">
            <div>
              <h2 className="text-sm font-medium">{t("language:gate.title")}</h2>
              {/* Sous-titre bilingue : l'écran s'affiche AVANT tout choix, donc dans une langue que
                  l'utilisateur ne parle peut-être pas. */}
              <p className="mt-1 text-xs text-muted-foreground">Choisis la langue de l'interface · Choose your language</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {LANGUAGES.map((entry) => (
                <button
                  key={entry.code}
                  type="button"
                  aria-pressed={entry.code === lang}
                  onClick={() => pickLanguage(entry.code)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    entry.code === lang ? "border-primary bg-accent" : "border-border hover:bg-accent/50",
                  )}
                >
                  <FlagIcon code={entry.code} className="h-4 w-[1.35rem] shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.label}</span>
                  {entry.code === lang && <Check className="size-4 shrink-0 text-primary" />}
                </button>
              ))}
            </div>
            {/* Le socle se télécharge PENDANT ce choix : une ligne discrète, pas un écran de plus. */}
            {install !== "error" && (
              <div className="flex items-center gap-3 rounded-md bg-muted/40 px-3 py-2">
                {install === "ok"
                  ? <CheckCircle2 className="size-4 shrink-0 text-[var(--color-ok)]" />
                  : <Spinner className="size-4 shrink-0 text-muted-foreground" />}
                <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {install === "ok" ? t("setup:auto.ready") : prog.label || t("setup:auto.running")}
                </p>
                {install === "running" && <Progress value={prog.pct ?? null} className="w-28 shrink-0" />}
              </div>
            )}
            {errorBlock}
          </section>
        )}

        {phase === "install" && (
          <section className="flex flex-col gap-4">
            {install === "ok" ? (
              <div className="flex flex-col items-center gap-3 py-5 text-center">
                <span className="grid size-12 place-items-center rounded-full bg-[var(--color-ok)]/15 text-[var(--color-ok)]"><CheckCircle2 className="size-6" /></span>
                <div><h2 className="text-base font-medium">{t("setup:done")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("setup:restartHint")}</p></div>
              </div>
            ) : (
              <>
                <Progress value={prog.pct ?? null} />
                <p className="truncate text-xs text-muted-foreground">{prog.label || prog.line || t("setup:running")}</p>
              </>
            )}
            {errorBlock}
            {/* Incident SANS arrêt de l'installation. Le bouton n'existe que dans ce cas : une
                installation propre n'a rien à signaler, et une aide au dépannage posée en
                permanence ferait douter avant même le début. */}
            {install !== "error" && issues.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/10 p-3">
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                  {t("setup:issues.detected", { count: issues.length })}
                </p>
                <ErrorReportButton
                  error={[...issues, logText(log.slice(-20))].join("\n")}
                  subject="Incident pendant l'installation (installation poursuivie)"
                  module="setup"
                  moduleLabel="Installation"
                  severity="major"
                />
              </div>
            )}
            {(log.length > 0 || downloads.length > 0) && install !== "ok" && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Terminal className="size-3.5" /> {t("setup:log")}</span>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => void navigator.clipboard?.writeText(logText(log))}>{t("common:action.copy")}</Button>
                </div>
                <div ref={logRef} className="h-44 overflow-auto rounded-md border border-border bg-black/40 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {log.map((entry, index) => <div key={index} className={cn("whitespace-pre-wrap break-all", TONE_CLASS[entry.tone])}>{entry.text}</div>)}
                  {/* Les téléchargements en cours vivent SOUS le journal, dans le même cadre : une
                      ligne par élément, remplacée par sa ligne de journal une fois conclue. */}
                  {downloads.map((dl) => <DownloadRow key={dl.name} dl={dl} />)}
                </div>
              </div>
            )}
          </section>
        )}

        <footer className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <div>
            {phase === "install" && needLang && install === "error" && (
              <Button variant="ghost" onClick={() => setPhase("language")}><ArrowLeft className="size-4" /> {t("common:action.back")}</Button>
            )}
          </div>
          <div className="flex gap-2">
            {phase === "language" && <Button onClick={() => setPhase("install")}>{t("common:action.continue")}</Button>}
            {phase === "install" && install === "running" && <Button disabled><RotateCw className="size-4 animate-spin" /> {t("setup:installing")}</Button>}
            {phase === "install" && install === "error" && <Button onClick={() => void runInstall()}><RotateCw className="size-4" /> {t("common:action.retry")}</Button>}
            {phase === "install" && install === "ok" && <Button onClick={() => void relaunchApp()}><RotateCw className="size-4" /> {t("setup:restartApp")}</Button>}
          </div>
        </footer>
      </Card>
    </GateFrame>
  );
}

function logText(entries: LogEntry[]) {
  return entries.map((entry) => entry.text).join("\n");
}

// Nom, chiffres, barre colorée par l'état. Sans total annoncé, la barre reste indéterminée.
function DownloadRow({ dl }: { dl: ActiveDownload }) {
  const { t } = useTranslation(["setup"]);
  const known = dl.total > 0 && dl.state === "download";
  const ratio = known ? Math.min(1, dl.done / dl.total) : 0;
  const figures = dl.state === "retry"
    ? t("setup:dl.retry")
    : dl.state === "work"
      ? t("setup:dl.working")
      : [
        known ? `${fmtSize(dl.done)} / ${fmtSize(dl.total)}` : dl.done > 0 ? fmtSize(dl.done) : t("setup:dl.working"),
        dl.speed > 0 ? `${fmtSize(dl.speed)}/s` : null,
      ].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-col gap-1 py-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className={cn("min-w-0 truncate", TONE_CLASS[DOWNLOAD_TONE[dl.state]])}>{dl.name}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{figures}</span>
      </div>
      <div className="h-[3px] overflow-hidden rounded-full bg-muted-foreground/20">
        <div
          className={cn("h-full rounded-full transition-[width] duration-300", !known && "animate-pulse")}
          style={{ width: known ? `${ratio * 100}%` : "100%", background: BAR_COLOR[dl.state], opacity: known ? 1 : 0.5 }}
        />
      </div>
    </div>
  );
}

// Octets → texte court. Vivait dans le registre de modèles, supprimé avec lui ; seul le journal
// d'installation en a encore besoin.
export function fmtSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 o";
  const units = ["o", "Ko", "Mo", "Go"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value >= 100 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

async function relaunchApp() {
  try {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch {
    // Hors Tauri : le bouton reste sans effet, l'application native n'existe pas.
  }
}

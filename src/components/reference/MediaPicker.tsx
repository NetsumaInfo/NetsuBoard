// Sélecteur « Depuis le projet » : panneau docké à droite, fond transparent SANS flou (board net
// derrière). Cartes = MÊME mécanisme que Derush (useSceneCardMedia + PreviewVideo : vignette lazy,
// aperçu animé au survol, content-visibility). Un seul mode : grille de rushs → clic ouvre la
// découpe régulière du rush.
// Glisser une carte → board (drop au curseur). Glisser des fichiers vidéo OS → ajoutés comme rushs.

import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Film, FolderOpen, Scissors } from "lucide-react";
import { SelectCheck } from "@/components/common/selectable";
import { useShallow } from "zustand/react/shallow";
import { nr, type Clip } from "@/lib/bridge";
import { useApp } from "@/store";
import { fmt, type Segment } from "@/components/rushes/cutStudioShared";
import { useSceneCardMedia } from "@/components/rushes/useSceneCardMedia";
import { warmResolveThumbs } from "@/lib/thumbCache";
import { PreviewVideo } from "@/components/player/PreviewVideo";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn, thumbTime } from "@/lib/utils";
import { previewSettingsFingerprint } from "@/lib/previewSettings";
import { NR_MEDIA_DND, type NrMediaDrag, kindFromPath } from "./referenceShared";
import type { BoardHandle } from "./ReferenceBoard";

function parseDur(d: string | null): number {
  if (!d) return 0;
  const parts = d.split(":").map(Number);
  if (parts.every((n) => !Number.isNaN(n))) {
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
  }
  const n = Number(d);
  return Number.isNaN(n) ? 0 : n;
}


// Glisser une carte vers le board (drop au curseur, cf. ReferenceBoard.onDrop).
function startDrag(e: React.DragEvent, m: NrMediaDrag) {
  e.dataTransfer.setData(NR_MEDIA_DND, JSON.stringify(m));
  e.dataTransfer.effectAllowed = "copy";
}

// Carte média = même rendu/comportement qu'une carte de plan Derush (SceneCard) : vignette lazy +
// aperçu animé au survol via useSceneCardMedia. Draggable vers le board (l'<img> est non-draggable
// sinon le navigateur drague l'image au lieu de notre payload).
function MediaCardImpl({
  clipPath, inSec, outSec, index, proxies, drag, selectable, selected, onActivate, badge, footer,
}: {
  clipPath: string; inSec: number; outSec: number; index: number;
  proxies: Map<string, string>; drag: NrMediaDrag;
  selectable?: boolean; selected?: boolean; onActivate: () => void; badge?: string; footer?: string;
}) {
  const seg: Segment = { id: index, in: inSec, out: outSec };
  const key = `${clipPath}@${inSec}-${outSec}|${previewSettingsFingerprint()}`;
  const getProxy = useCallback(
    (height?: number, token?: number, priority?: "high" | "low") => {
      const c = proxies.get(key);
      if (c) return Promise.resolve<string | null>(c);
      return nr.proxy({ input: clipPath, start: inSec, end: outSec, height, token, priority }).then((r) => {
        if (r.ok && r.path) { const u = nr.mediaUrl(r.path); proxies.set(key, u); return u; }
        return null;
      });
    },
    [clipPath, inSec, outSec, key, proxies],
  );
  const bustProxy = useCallback(() => { proxies.delete(key); }, [key, proxies]);
  const { rootRef, thumb, url, showVideo, videoPaused, hovered, onVideoError, enter, leave } =
    useSceneCardMedia({ seg, index, clipPath, play: false, getProxy, bustProxy });
  const shown = thumb;

  return (
    <div
      ref={rootRef}
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => startDrag(e, drag)}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onClick={onActivate}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onActivate(); } }}
      className={cn(
        "group relative aspect-video cursor-grab overflow-hidden rounded-xl border bg-muted transition-transform hover:-translate-y-0.5 active:cursor-grabbing [content-visibility:auto] [contain-intrinsic-size:auto_120px]",
        selected ? "border-primary ring-2 ring-inset ring-primary" : "border-border hover:border-primary/60",
      )}
    >
      {!shown && <Skeleton className="absolute inset-0 rounded-none" />}
      {shown && <img src={shown} alt="" draggable={false} decoding="async" className="absolute inset-0 h-full w-full object-cover" />}
      {showVideo && <PreviewVideo url={url!} label="" onError={onVideoError} audible={hovered} paused={videoPaused} />}
      {badge && <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white">{badge}</span>}
      {footer && <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] tabular-nums text-white">{footer}</span>}
      {selectable && selected && <SelectCheck />}
    </div>
  );
}

// Mémoïsé : la grille re-rend à chaque sélection/survol d'UNE carte (≥1000 plans sur gros rush).
// On compare les seules props qui changent le rendu ; les callbacks (recréés à chaque rendu, lus
// via ref dans useSceneCardMedia, ou fermeture stable sur index) sont ignorés → 1 seule carte re-rend.
const MediaCard = memo(MediaCardImpl, (a, b) =>
  a.clipPath === b.clipPath && a.inSec === b.inSec && a.outSec === b.outSec &&
  a.index === b.index && a.selected === b.selected &&
  a.selectable === b.selectable && a.badge === b.badge && a.footer === b.footer &&
  a.proxies === b.proxies,
);

// Sélection multi-cartes (cases) partagée par les grilles plans / résultats IA.
function useGridSelection() {
  const [sel, setSel] = useState<Set<number>>(new Set());
  const toggle = useCallback((i: number) => setSel((p) => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; }), []);
  const clear = useCallback(() => setSel(new Set()), []);
  return { sel, setSel, toggle, clear };
}

// Barre d'ajout (groupe les picks par fichier → addCuts, tuilage propre).
function AddBar({ picks, board, onDone }: {
  picks: { file: string; in: number; out: number; title: string }[];
  board: RefObject<BoardHandle | null>;
  onDone: () => void;
}) {
  const { t } = useTranslation("reference");
  function add() {
    const byFile = new Map<string, { in: number; out: number; title: string }[]>();
    for (const p of picks) {
      const arr = byFile.get(p.file) ?? [];
      arr.push({ in: p.in, out: p.out, title: p.title });
      byFile.set(p.file, arr);
    }
    for (const [file, cuts] of byFile) board.current?.addCuts(file, cuts);
    onDone();
  }
  return (
    <Button size="sm" onClick={add} disabled={picks.length === 0}>
      {picks.length > 0 ? t("media.addShots", { count: picks.length }) : t("media.dragOrSelect")}
    </Button>
  );
}

// Tranche de vidéo affichée par le picker. Type LOCAL et non le `Scene` du core : celui-ci porte des
// numéros d'image, que seule la détection savait produire — ici il n'y a que des secondes.
export type Slice = { start: number; end: number };

// Pas de temps proposés pour la découpe régulière d'une vidéo, en secondes.
const SLICE_INTERVALS = [2, 5, 10, 30];

// Durée d'une vidéo lue par la WebView elle-même : un élément <video> hors document charge ses
// métadonnées et rend la durée, sans ffprobe ni aller-retour avec le core. Rend 0 si la source est
// illisible, ce que l'appelant traduit en message plutôt qu'en découpe vide.
function videoDuration(src: string): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement("video");
    el.preload = "metadata";
    const done = (value: number) => { el.removeAttribute("src"); el.load(); resolve(value); };
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : 0);
    el.onerror = () => done(0);
    el.src = src;
  });
}

// Vue des découpes d'un rush : rush entier + multi-sélection des plans + découpe régulière si vide.
function CutsView({ clip, proxies, board, onClose }: {
  clip: Clip; proxies: Map<string, string>; board: RefObject<BoardHandle | null>; onClose: () => void;
}) {
  const { t } = useTranslation("reference");
  const [cuts, setCuts] = useState<Slice[] | null>(null);
  const { sel, setSel, toggle, clear } = useGridSelection();
  const [interval, setInterval] = useState(SLICE_INTERVALS[1]);
  const [slicing, setSlicing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Aucune découpe n'est persistée : elle se recalcule instantanément à partir de la durée, là où la
  // détection par réseau coûtait assez cher pour mériter un cache.
  useEffect(() => { setCuts([]); clear(); }, [clip.path]);

  // Amorce le cache de vignettes en UN RPC dès qu'une découpe existe → les cartes n'émettent pas
  // un RPC chacune (défilement fluide sur une longue vidéo).
  useEffect(() => {
    if (cuts?.length) void warmResolveThumbs(cuts.map((s) => ({ path: clip.path, time: thumbTime(s.start, s.end) })));
  }, [cuts, clip.path]);

  // Découpe RÉGULIÈRE, à la place de la détection de plans par réseau : celle-ci demandait un
  // environnement Python et un modèle de plusieurs centaines de mégaoctets, tout ce que NetsuBoard
  // refuse d'installer. Un pas de temps fixe donne des vignettes exploitables pour piocher dans une
  // vidéo, sans rien télécharger — et la durée se lit dans le renderer, donc sans même solliciter
  // le core.
  async function slice() {
    setSlicing(true); setErr(null);
    try {
      const duration = await videoDuration(nr.mediaUrl(clip.path));
      if (!duration) { setErr(t("media.durationUnknown")); return; }
      const got: Slice[] = [];
      for (let start = 0; start < duration; start += interval) {
        got.push({ start, end: Math.min(start + interval, duration) });
      }
      setCuts(got.filter((s) => s.end - s.start > 0.1));
    } catch (e) { setErr(String(e)); }
    finally { setSlicing(false); }
  }

  const allSel = !!cuts && cuts.length > 0 && sel.size === cuts.length;
  const picks = cuts ? [...sel].sort((a, b) => a - b).map((i) => ({
    file: clip.path, in: cuts[i].start, out: cuts[i].end, title: t("media.shotLabel", { name: clip.name, n: i + 1 }),
  })) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" onClick={onClose}><ArrowLeft className="size-4" /></Button>
        <Tooltip>
          <TooltipTrigger render={<span className="min-w-0 flex-1 truncate text-sm font-medium">{clip.name}</span>} />
          <TooltipContent>{clip.path}</TooltipContent>
        </Tooltip>
        <Button variant="outline" size="xs" onClick={() => board.current?.addPath(clip.path, clip.name)}>
          <Film className="size-3.5" /> {t("media.whole")}
        </Button>
      </div>

      {cuts === null ? (
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="aspect-video rounded-xl" />)}
        </div>
      ) : cuts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Scissors className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("media.noShots")}</p>
          <div className="flex items-center gap-1.5">
            {SLICE_INTERVALS.map((s) => (
              <Button
                key={s} size="xs" variant={interval === s ? "default" : "outline"}
                onClick={() => setInterval(s)} disabled={slicing}
              >
                {s}s
              </Button>
            ))}
          </div>
          <Button size="sm" onClick={slice} disabled={slicing}>
            {slicing ? <Spinner className="size-3.5" /> : <Scissors className="size-3.5" />}
            {t("media.slice")}
          </Button>
          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between px-0.5 text-xs text-muted-foreground">
            <span>{t("media.shotCount", { count: cuts.length })}{sel.size ? t("media.selectedSuffix", { count: sel.size }) : ""}</span>
            <button type="button" className="hover:text-foreground" onClick={() => setSel(allSel ? new Set() : new Set(cuts.map((_, i) => i)))}>
              {allSel ? t("media.none") : t("media.all")}
            </button>
          </div>
          {/* Le défilement vit sur un wrapper SÉPARÉ ; la grille reste auto-height. Une grille à la
              fois flex-1 ET scroller casse l'estimation content-visibility (rangées effondrées →
              cartes en lamelles). */}
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="grid grid-cols-3 gap-2">
              {cuts.map((c, i) => (
                <MediaCard
                  key={`${clip.path}@${c.start}-${c.end}`}
                  clipPath={clip.path} inSec={c.start} outSec={c.end} index={i} proxies={proxies}
                  drag={{ file: clip.path, in: c.start, out: c.end, title: t("media.shotLabel", { name: clip.name, n: i + 1 }) }}
                  selectable selected={sel.has(i)} onActivate={() => toggle(i)}
                  badge={String(i + 1)} footer={fmt(c.end - c.start)}
                />
              ))}
            </div>
          </div>
          <AddBar picks={picks} board={board} onDone={clear} />
        </>
      )}
    </div>
  );
}

export function MediaPicker({
  open, onOpenChange, board,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  board: RefObject<BoardHandle | null>;
}) {
  const { t } = useTranslation("reference");
  const { clips, localClips, loadClips, clipsLoading, addLocalClips } = useApp(
    useShallow((s) => ({ clips: s.clips, localClips: s.localClips, loadClips: s.loadClips, clipsLoading: s.clipsLoading, addLocalClips: s.addLocalClips })),
  );
  const [q, setQ] = useState("");
  const [drill, setDrill] = useState<Clip | null>(null);
  const [over, setOver] = useState(false);
  const proxies = useRef<Map<string, string>>(new Map()).current;

  const all = useMemo(() => [...clips, ...localClips], [clips, localClips]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? all.filter((c) => c.name.toLowerCase().includes(s)) : all;
  }, [all, q]);

  useEffect(() => { if (!open) setDrill(null); }, [open]);

  // Glisser-déposer de fichiers vidéo OS DANS le picker → rushs locaux sélectionnables.
  function onDropFiles(e: React.DragEvent) {
    if (!e.dataTransfer.files.length) return; // un drag interne (carte) ne porte pas de fichiers
    e.preventDefault();
    setOver(false);
    // Les File sont lus MAINTENANT (dataTransfer est vidé à la fin de l'événement) ; leur chemin
    // disque se résout côté host — Chromium ne l'expose pas.
    const files = Array.from(e.dataTransfer.files);
    void nr.pathsForFiles(files).then((all) => {
      const paths = all.filter((p) => p && kindFromPath(p) === "video");
      if (paths.length) { addLocalClips(paths); setDrill(null); }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent
        // Docké à droite, fond transparent SANS flou → board net derrière.
        overlayClassName="bg-transparent supports-backdrop-filter:backdrop-blur-none pointer-events-none"
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }}
        onDrop={onDropFiles}
        className={cn(
          "left-auto right-4 top-1/2 flex h-[88vh] max-h-[88vh] w-[26rem] max-w-[calc(100%-2rem)] -translate-x-0 -translate-y-1/2 flex-col gap-3 p-4 shadow-2xl sm:max-w-md",
          over && "ring-2 ring-primary",
        )}
      >
        {over && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-xl bg-primary/10 text-sm font-medium">
            {t("media.dropVideos")}
          </div>
        )}

        <DialogHeader className="flex-row items-center gap-2 space-y-0">
          <Tooltip>
            <TooltipTrigger render={<span className="grid size-8 place-items-center rounded-md border border-border" />}>
              <FolderOpen className="size-4" />
            </TooltipTrigger>
            <TooltipContent>{t("media.browse")}</TooltipContent>
          </Tooltip>
          <DialogTitle className="flex-1 text-sm">
            {drill ? t("media.cuts") : t("media.projectRushes")}
          </DialogTitle>
        </DialogHeader>

        {drill ? (
          <CutsView clip={drill} proxies={proxies} board={board} onClose={() => setDrill(null)} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex items-center gap-2">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("media.filter")} className="h-8 flex-1" />
              <Button variant="outline" size="sm" onClick={loadClips} disabled={clipsLoading}>
                {clipsLoading ? <Spinner className="size-3.5" /> : t("media.reload")}
              </Button>
            </div>

            {filtered.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">{t("media.noRushes")}</p>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <div className="grid grid-cols-2 gap-2">
                  {filtered.map((c, i) => {
                    const dur = parseDur(c.duration);
                    return (
                      <div key={c.path} className="flex flex-col gap-1">
                        <MediaCard
                          clipPath={c.path} inSec={0} outSec={dur ? Math.min(dur, 8) : 8} index={i} proxies={proxies}
                          drag={{ file: c.path, title: c.name }}
                          onActivate={() => setDrill(c)}
                          footer={c.source === "local" ? t("media.local") : undefined}
                        />
                        <Tooltip>
                          <TooltipTrigger render={<p className="truncate px-0.5 text-[11px] text-muted-foreground">{c.name}</p>} />
                          <TooltipContent>{c.name}</TooltipContent>
                        </Tooltip>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Level of detail of the board's IMAGES.
//
// The webview decodes an <img> at its SOURCE resolution, whatever size it is drawn at: an 8K
// wallpaper is a 133 MB bitmap even when it covers a quarter of the screen. A few dozen of those
// overflow Chromium's decoded-image cache, which evicts, and the board blanks and repaints while it is
// navigated — the "everything reloads" of a zoom out.
//
// Each still local image therefore has a PYRAMID of reduced copies made by the core in one ffmpeg
// pass (long sides 512, 1024 and 2048, cf. core/thumbs.js `imageTiers`). The image shows the
// smallest level that is still sharper than its size on screen, and its source only once no level is.
// The decoded memory of a board is then bounded by what the screen can show, not by the files.
//
// The criterion is in SCREEN pixels (device pixels included), not board units: the displayed size
// decides whether a level would show. The zoom it reads is quantised to the octave (`zoomCeil`), so
// an item re-renders once per doubling of the zoom, never per wheel notch.
//
// Three rules keep the swaps invisible:
//  1. The `src` of an <img> on screen is NEVER set to an undecoded source. Chromium empties the
//     element at the assignment and repaints only after decoding: the box is blank in between. The
//     target is loaded AND decoded off-screen, then swapped in one go.
//  2. A sharper level already on screen is kept while it is at most one step above the wanted one.
//     Without that dead band, a wheel back-and-forth around a threshold swapped at every notch.
//  3. A large source is never decoded just to be replaced: while its levels are unknown, the box
//     stays an empty placeholder instead of decoding the full file for a few frames.

import { useCallback, useEffect, useState } from "react";
import { nr } from "@/lib/bridge";
import { onThumbsCleared } from "@/lib/thumbCache";
import { useBoard } from "./useReferenceBoard";
import { displaySrc, isCoreFileRef, type BoardItem } from "./referenceShared";

// Un média animé garde sa source : une vignette n'est qu'une image fixe, l'animation serait perdue.
const ANIMATED_RE = /\.(gif|webp|avif|apng)(?:$|[?#])/i;

// Above this many source pixels, decoding the file "while waiting" costs more than the empty frame
// it avoids (a 4K picture is 33 MB of bitmap): the box waits for its level instead.
const BIG_SOURCE_PIXELS = 6_000_000;
// A level is only asked for when it would replace a source clearly larger than the screen needs.
const TIER_MIN_RATIO = 1.5;

// ref disque → source d'affichage réduite (frames d'affiche des vidéos). Seuls les SUCCÈS y entrent :
// un échec ponctuel (timeout pendant la tempête d'un premier dézoom) mémorisé désactiverait le LOD de
// ce média à vie.
const resolved = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

// ref disque → levels of the image pyramid, as display URLs keyed by long side. Same rule: only
// successes are kept.
type Tiers = Record<number, string>;
const tierMaps = new Map<string, Tiers>();
const tierInflight = new Map<string, Promise<Tiers | null>>();

// Une purge du cache de vignettes (Paramètres) supprime les fichiers sur disque : sans invalidation,
// les caches continueraient de servir des URL mortes — cases cassées jusqu'au redémarrage.
onThumbsCleared(() => { resolved.clear(); tierMaps.clear(); decoded.clear(); });

/** Can this item be drawn from the pyramid at all? Pure and exported for tests. */
export function tierEligible(item: BoardItem): boolean {
  return item.kind === "image"
    && !!item.ref
    // The levels are made by the core from a FILE: a shared board's media is not one.
    && isCoreFileRef(item.ref)
    && !ANIMATED_RE.test(item.ref)
    && !item.loading
    && !item.missing;
}

/**
 * Long side, in device pixels, of the SOURCE as drawn on screen. A crop draws the source larger than
 * the item box (the box shows only part of it), so its scale counts too.
 */
export function screenLongSide(item: BoardItem, zoom: number, dpr = 1): number {
  const cw = item.crop?.w || 1;
  const ch = item.crop?.h || 1;
  return Math.max(item.w / cw, item.h / ch) * zoom * dpr;
}

/**
 * Level to show: a long side from `sides`, or 0 for the full source. `current` is the level on
 * screen now (null when nothing from this source is shown yet). Pure and exported for tests.
 */
export function pickLevel(need: number, sides: number[], current: number | null): number {
  const ladder = [...sides].sort((a, b) => a - b);
  const want = ladder.find((s) => s >= need) ?? 0;
  if (current == null) return want;
  const rank = (level: number) => (level === 0 ? ladder.length : ladder.indexOf(level));
  const have = rank(current);
  const wanted = rank(want);
  if (have >= wanted && have - wanted <= 1) return current;
  return want;
}

/**
 * Is the source worth replacing at this size? Without a known source size the answer is yes: only
 * the core can tell, and it answers with an empty pyramid for a small file.
 */
export function wantsTiers(item: BoardItem, need: number): boolean {
  const natLong = Math.max(item.natW ?? 0, item.natH ?? 0);
  return !natLong || natLong >= need * TIER_MIN_RATIO;
}

/** Big enough, or unmeasured, that decoding the source while its levels come would be a waste. */
export function heavySource(item: BoardItem): boolean {
  const px = (item.natW ?? 0) * (item.natH ?? 0);
  return !px || px > BIG_SOURCE_PIXELS;
}

/**
 * Zoom arrondi à l'OCTAVE supérieure (puissance de 2 ≥ scale). La taille écran entre dans la décision,
 * donc chaque item doit suivre le zoom — et s'abonner à sa valeur exacte re-rendrait toute la planche
 * à chaque cran de molette. L'octave est un entier qui ne change qu'une fois par doublement.
 */
export function zoomCeil(scale: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(scale, 1e-6)));
}

// Plafond des demandes en vol. Chaque RPC est un fetch sur l'origine du core, que Chromium borne à
// ~6 connexions : sans plafond, le premier dézoom d'une grosse planche empile des centaines de
// fetches et TOUT autre RPC (autosave, proxy, annulation d'encodage) attend derrière.
const THUMB_INFLIGHT_MAX = 4;
let thumbRunning = 0;
const thumbWaiting: (() => void)[] = [];
function thumbGate<T>(job: () => Promise<T>): Promise<T> {
  const run = (): Promise<T> => {
    thumbRunning++;
    return job().finally(() => {
      thumbRunning--;
      thumbWaiting.shift()?.();
    });
  };
  if (thumbRunning < THUMB_INFLIGHT_MAX) return run();
  return new Promise<T>((res, rej) => { thumbWaiting.push(() => run().then(res, rej)); });
}

// Clé de cache : les images n'ont qu'une frame (time 0 → la ref nue), les vidéos une frame
// d'affiche à un instant donné (même arrondi que le cache disque du core).
function thumbKey(ref: string, time: number): string {
  return time ? `${ref}@${time.toFixed(2)}` : ref;
}

/** URL de vignette déjà RÉSOLUE cette session, sans RPC ni promesse. null = pas encore connue. */
export function knownThumb(ref: string, time = 0): string | null {
  return resolved.get(thumbKey(ref, time)) ?? null;
}

/**
 * Vignette d'une source disque, mise en cache. Les demandes simultanées partagent le même appel.
 * `time` : frame d'affiche pour une vidéo (0 = image fixe).
 */
export function thumbFor(ref: string, time = 0): Promise<string | null> {
  const key = thumbKey(ref, time);
  const known = resolved.get(key);
  if (known !== undefined) return Promise.resolve(known);
  const running = inflight.get(key);
  if (running) return running;
  // Priorité basse : la planche est déjà lisible pendant que la vignette se génère.
  const job = thumbGate(() => Promise.resolve(nr.thumbnail?.(ref, time, "low")))
    .then((r) => (typeof r === "string" && r ? displaySrc("image", r) : null))
    .catch(() => null)
    .then((src) => {
      if (src) resolved.set(key, src);
      inflight.delete(key);
      return src;
    });
  inflight.set(key, job);
  return job;
}

function toTiers(files: Record<number, string> | null | undefined): Tiers | null {
  if (!files) return null;
  const out: Tiers = {};
  for (const [side, file] of Object.entries(files)) if (file) out[Number(side)] = displaySrc("image", file);
  return out;
}

/** Pyramid of a local still image, generated by the core on first request and cached. */
export function tiersFor(ref: string): Promise<Tiers | null> {
  const known = tierMaps.get(ref);
  if (known) return Promise.resolve(known);
  const running = tierInflight.get(ref);
  if (running) return running;
  // High priority: only a mounted item asks, and it waits on the answer to show anything sharp.
  const job = thumbGate(() => Promise.resolve(nr.imageTiers?.(ref, "high")))
    .then((r) => (r && "tiers" in r ? toTiers(r.tiers) : null))
    .catch(() => null)
    .then((tiers) => {
      if (tiers) tierMaps.set(ref, tiers);
      tierInflight.delete(ref);
      return tiers;
    });
  tierInflight.set(ref, job);
  return job;
}

/**
 * Amorce les caches en DEUX RPC pour toute une scène : la pyramide des images, la frame d'affiche des
 * vidéos. Sans lui, chaque session repart de zéro et chaque image attend son propre aller-retour
 * avant de se peindre.
 */
export function primeBoardThumbs(entries: { ref: string; time?: number; video?: boolean }[]): void {
  const images = new Set<string>();
  const posters: { path: string; time: number }[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (!e.ref || !isCoreFileRef(e.ref) || ANIMATED_RE.test(e.ref)) continue;
    if (!e.video) {
      if (!tierMaps.has(e.ref) && !tierInflight.has(e.ref)) images.add(e.ref);
      continue;
    }
    const time = e.time ?? 0;
    const key = thumbKey(e.ref, time);
    if (seen.has(key) || resolved.has(key) || inflight.has(key)) continue;
    seen.add(key);
    posters.push({ path: e.ref, time });
  }
  if (images.size) {
    void Promise.resolve(nr.imageTiersResolve?.([...images]))
      .then((res) => {
        const small: string[] = [];
        for (const r of res ?? []) {
          const tiers = toTiers(r?.tiers);
          if (!r?.path || !tiers) continue;
          tierMaps.set(r.path, tiers);
          const least = Math.min(...Object.keys(tiers).map(Number));
          if (Number.isFinite(least)) small.push(tiers[least]);
        }
        warmDecode(small);
      })
      .catch(() => { /* amorçage best-effort : repli sur le chemin paresseux par item */ });
  }
  if (posters.length) {
    void Promise.resolve(nr.thumbsResolve?.(posters))
      .then((res) => {
        const urls: string[] = [];
        for (const r of res ?? []) {
          if (!r?.file) continue;
          const url = displaySrc("image", r.file);
          resolved.set(thumbKey(r.path, r.time ?? 0), url);
          urls.push(url);
        }
        warmDecode(urls);
      })
      .catch(() => { /* amorçage best-effort */ });
  }
}

// Réchauffe en tâche de fond les plus petites sources résolues : octets lus du disque ET bitmap
// décodé une première fois. Sans ça, un item qui entre dans la zone au dézoom monte avec une source
// encore froide — une case vide de quelques frames, multipliée par la planche. Trois à la fois :
// jamais de rafale qui gênerait le geste en cours.
function warmDecode(urls: string[]): void {
  const queue = urls.filter((u) => !decoded.has(u));
  let idx = 0;
  const next = (): void => {
    if (idx >= queue.length) return;
    const u = queue[idx++];
    void preload(u).then(next, next);
  };
  for (let i = 0; i < 3; i++) next();
}

/**
 * Charge et DÉCODE une source hors écran. Résout `true` quand elle est prête à être peinte, donc
 * échangeable sans frame blanche. `decode()` couvre le chargement ET le décodage.
 */
export function preload(src: string): Promise<boolean> {
  if (decoded.has(src)) return Promise.resolve(true);
  const img = new Image();
  img.src = src;
  return (img.decode?.() ?? Promise.resolve()).then(() => { decoded.add(src); return true; }, () => false);
}

// Sources dont le décodage a RÉUSSI dans cette session : leur préchargement est gratuit, donc les
// échanges vers elles sont immédiats (un aller-retour de zoom ne redécode pas ce qu'il vient de voir).
const decoded = new Set<string>();

/** Already decoded once this session: painting it again is cheap enough to do synchronously. */
export function isDecoded(src: string): boolean {
  return decoded.has(src);
}

function dpr(): number {
  return typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
}

function levelOf(src: string, item: BoardItem, tiers: Tiers | null): number | null {
  if (!src) return null;
  if (src === item.src) return 0;
  if (tiers) for (const [side, url] of Object.entries(tiers)) if (url === src) return Number(side);
  return null;
}

/** Source for a pyramid at this zoom, from scratch or keeping `shown` inside the dead band. */
function tierSrc(item: BoardItem, tiers: Tiers, zoom: number, shown: string): string {
  const sides = Object.keys(tiers).map(Number);
  const level = pickLevel(screenLongSide(item, zoom, dpr()), sides, levelOf(shown, item, tiers));
  return level ? tiers[level] : item.src;
}

/**
 * Source de DÉPART, au montage. Rien n'est encore à l'écran, donc rien à préserver : on prend
 * directement la bonne — et le culling remonte les items en plein pan/zoom, donc démarrer plein
 * ferait décoder le gros bitmap pour une seule frame à chaque remontage. "" = placeholder.
 */
function firstSrc(item: BoardItem): string {
  if (!tierEligible(item)) return item.src;
  const zoom = zoomCeil(useBoard.getState().view.scale);
  const tiers = tierMaps.get(item.ref);
  if (tiers) return tierSrc(item, tiers, zoom, "");
  if (!wantsTiers(item, screenLongSide(item, zoom, dpr()))) return item.src;
  return heavySource(item) ? "" : item.src;
}

/**
 * Source à afficher pour cette image, et si c'est la source PLEINE (l'appelant s'en sert pour ne pas
 * confondre l'échec d'un niveau réduit avec un média disparu). `src` vide = placeholder, le temps que
 * la pyramide arrive. `onError` : à brancher sur l'erreur du <img> — un niveau mort (fichier purgé sur
 * disque) retombe sur la source pleine et sort des caches ; renvoie false quand l'échec concerne la
 * source pleine, que l'appelant doit traiter (récupération de média).
 */
export function useImageLod(item: BoardItem): { src: string; full: boolean; onError: () => boolean } {
  // Sélecteur quantifié : la valeur ne change qu'une fois par doublement de zoom, donc la planche ne
  // se re-rend pas à chaque cran de molette (plusieurs centaines d'items n'y survivraient pas).
  const zoom = useBoard((s) => zoomCeil(s.view.scale));
  // Source AFFICHÉE, distincte de la source VOULUE : elle ne change qu'une fois la cible décodée.
  const [shown, setShown] = useState(() => firstSrc(item));
  const [tiers, setTiers] = useState<Tiers | null>(() => tierMaps.get(item.ref) ?? null);
  // The pyramid could not be made (no ffmpeg, unreadable file): the source is all there is.
  const [failed, setFailed] = useState(false);

  // L'item a changé de fichier (récupération d'un média, remplacement) : il n'y a plus rien à
  // préserver, et garder l'ancienne image afficherait un AUTRE fichier. Réinitialisation pendant le
  // rendu — React relance aussitôt, sans peindre l'état intermédiaire.
  const [base, setBase] = useState(item.src);
  if (base !== item.src) {
    setBase(item.src);
    setShown(firstSrc(item));
    setTiers(tierMaps.get(item.ref) ?? null);
    setFailed(false);
  }

  const eligible = tierEligible(item) && !failed;
  const need = screenLongSide(item, zoom, dpr());
  const asks = eligible && !tiers && wantsTiers(item, need);

  useEffect(() => {
    if (!asks) return;
    let alive = true;
    void tiersFor(item.ref).then((t) => {
      if (!alive) return;
      if (t) setTiers(t);
      else setFailed(true);
    });
    return () => { alive = false; };
  }, [asks, item.ref]);

  let target: string;
  if (!eligible) target = item.src;
  else if (tiers) target = tierSrc(item, tiers, zoom, shown);
  // Levels on their way: whatever is shown stays. A placeholder only lasts for a heavy source — once
  // the import probe has measured a light one, decoding it is cheaper than waiting.
  else if (asks) target = shown || (heavySource(item) ? "" : item.src);
  else target = item.src;

  useEffect(() => {
    if (!target || target === shown) return;
    let alive = true;
    void preload(target).then((ok) => {
      // Une source pleine en échec doit tout de même être affichée : c'est l'`onError` du <img> qui
      // déclenche la récupération du média. Un niveau réduit en échec, lui, est simplement ignoré.
      if (alive && (ok || target === item.src)) setShown(target);
    });
    return () => { alive = false; };
  }, [target, shown, item.src]);

  // Niveau en erreur au chargement (cache disque purgé entre-temps) : repli immédiat sur la source
  // pleine et oubli de l'entrée morte — jamais de case cassée qui attend un rezoom.
  const onError = useCallback(() => {
    if (shown === item.src) return false;
    tierMaps.delete(item.ref);
    decoded.delete(shown);
    setTiers(null);
    setFailed(true);
    setShown(item.src);
    return true;
  }, [shown, item.src, item.ref]);

  return { src: shown, full: shown === item.src, onError };
}

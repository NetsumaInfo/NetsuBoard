// src/lib/coreClient.ts
// Implémente NrApi en parlant au service Node "core" (HTTP POST /rpc + SSE /events) pour l'app
// Tauri standalone. Même interface que le bridge Electron (window.nr) → composants inchangés.
// Dialogs / openExternal passent par les plugins Tauri (chargés à la demande, seulement sous Tauri).

import { convertFileSrc } from "@tauri-apps/api/core";
import type { NrApi, RefApi, PowerApi } from "./bridge";
import i18n from "@/i18n";
import { logError } from "@/lib/appLog";
import { readPreviewSettings } from "@/lib/previewSettings";
import { beginHeavyCall, isHeavyChannel } from "@/lib/busyBus";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// URL d'un fichier local servie par la coquille Rust (protocole `asset`), ou null hors Tauri.
// Import STATIQUE volontaire : la fonction est synchrone (elle alimente un `src=` en plein rendu),
// un import à la demande imposerait une promesse à chaque vignette. Le module ne touche à rien à
// l'évaluation — il lit `__TAURI_INTERNALS__` seulement à l'appel — donc il reste inerte en CEP.
//
// `convertFileSrc` fabrique l'URL côté JS : elle réussit MÊME si la coquille ne sert pas le
// protocole (binaire compilé avant l'activation d'`assetProtocol`). On sonde donc une fois : un
// protocole absent échoue au niveau réseau (fetch rejeté), un protocole présent répond — 404 ou 403
// pour un chemin bidon, mais la réponse existe. `no-cors` rend le verdict indépendant des en-têtes
// CORS : seule l'existence du protocole est testée. Tant que la sonde n'a pas répondu, on reste sur
// le serveur HTTP : une grille qui charge trop tôt est plus lente, jamais vide.
let assetProtocolOk = false;
if (isTauri) {
  void fetch(convertFileSrc("nr-asset-probe"), { mode: "no-cors" })
    .then(() => { assetProtocolOk = true; })
    .catch(() => { assetProtocolOk = false; });
}

function assetSrc(filePath: string): string | null {
  if (!isTauri || !assetProtocolOk || !filePath) return null;
  try {
    return convertFileSrc(filePath);
  } catch {
    return null;   // coquille sans protocole asset → l'appelant retombe sur le serveur HTTP
  }
}

// ---- Adresse du core ----
// Le port n'est plus figé : la coquille Tauri en choisit un LIBRE au lancement (un port occupé par
// une autre instance, une session de dev ou un logiciel tiers ne doit pas laisser l'app sans
// backend). Elle seule connaît le sien → on le lui demande. Hors Tauri (navigateur), on balaie la
// plage jusqu'à trouver un /healthz qui se déclare NetsuBoard.
// Plage 8760-8779, la même que `core/server.js` et DISJOINTE de celle de NetsuRush (8730-8749) :
// les deux applications tournent côte à côte.
const CORE_PORT_FIRST = 8760;
const CORE_PORT_SPAN = 20;
const FIXED_BASE: string | null =
  (typeof window !== "undefined" && (window as unknown as { __NR_CORE__?: string }).__NR_CORE__) || null;
let BASE: string = FIXED_BASE || `http://127.0.0.1:${CORE_PORT_FIRST}`;

async function probePort(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    if (!response.ok) return false;
    return (await response.json())?.app === "netsuboard";
  } catch {
    return false;
  }
}

async function discoverBase(): Promise<void> {
  if (isTauri) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const port = await invoke<number>("nr_core_port");
      if (port) {
        BASE = `http://127.0.0.1:${port}`;
        return;
      }
    } catch {
      // Coquille antérieure à la commande : on retombe sur le balayage.
    }
  }
  for (let port = CORE_PORT_FIRST; port < CORE_PORT_FIRST + CORE_PORT_SPAN; port++) {
    if (await probePort(port)) {
      BASE = `http://127.0.0.1:${port}`;
      return;
    }
  }
}

let discovery: Promise<void> | null = null;
function ensureBase(): Promise<void> {
  if (FIXED_BASE) return Promise.resolve();
  discovery ??= discoverBase();
  return discovery;
}
// Le core a pu redémarrer sur un autre port (le watchdog en reprend un libre) : après une série
// d'échecs réseau, on refait la recherche au lieu de marteler une adresse morte.
function forgetBase() {
  discovery = null;
}

// Token partagé optionnel : si la coquille Tauri l'injecte (window.__NR_TOKEN__), on l'envoie au core
// (header /rpc + query `tk` sur /media et /stream) pour qu'il authentifie nos requêtes. Absent (dev,
// avant câblage) → chaîne vide, le core n'exige rien (cf. media-server.js NR_CORE_TOKEN).
const TOKEN: string =
  (typeof window !== "undefined" && (window as unknown as { __NR_TOKEN__?: string }).__NR_TOKEN__) || "";
const tkParam = TOKEN ? `&tk=${encodeURIComponent(TOKEN)}` : "";

// ---- Chemins disque des fichiers lâchés depuis l'Explorateur ----
// Chromium masque le chemin des objets `File` (pas de `File.path`). Activer `dragDropEnabled`
// donnerait les chemins via l'événement DnD natif de Tauri, mais le flag est EXCLUSIF : wry révoque
// alors les cibles OLE de WebView2 et TOUT le DnD HTML5 interne meurt (blocs BlockNote/ProseMirror,
// cartes du tiroir Footages). On passe donc par la voie WebView2 : `postMessageWithAdditionalObjects`
// remet les objets File au host Rust, qui lit `ICoreWebView2File::Path` et répond en événement
// `nr://file-paths`. Détail complet dans `nr_attach_file_paths` (src-tauri/src/lib.rs).

type WebView2 = { postMessageWithAdditionalObjects?: (msg: unknown, objects: unknown[]) => void };
const webview2 = (): WebView2 | null =>
  (typeof window !== "undefined" && (window as unknown as { chrome?: { webview?: WebView2 } }).chrome?.webview) || null;

const pathWaiters = new Map<number, (paths: string[]) => void>();
let pathSeq = 0;
let pathBridge: Promise<boolean> | null = null;

// Attache paresseuse (une fois par fenêtre) : les fenêtres board/carnet détachées naissent côté JS,
// bien après le `setup` Rust — c'est le renderer qui sait quand sa webview existe.
async function ensurePathBridge(): Promise<boolean> {
  if (!pathBridge) {
    pathBridge = (async () => {
      if (!isTauri || !webview2()?.postMessageWithAdditionalObjects) return false;
      const [{ listen }, { invoke }, { getCurrentWindow }] = await Promise.all([
        import("@tauri-apps/api/event"),
        import("@tauri-apps/api/core"),
        import("@tauri-apps/api/window"),
      ]);
      await listen<{ id: number; paths: string[] }>("nr://file-paths", (e) => {
        const done = pathWaiters.get(e.payload.id);
        if (done) { pathWaiters.delete(e.payload.id); done(e.payload.paths || []); }
      });
      return (await invoke<boolean>("nr_attach_file_paths", { label: getCurrentWindow().label })) === true;
    })().then((ok) => {
      if (!ok) pathBridge = null;
      return ok;
    }).catch(() => {
      pathBridge = null;
      return false;
    });
  }
  return pathBridge;
}

async function resolveFilePaths(files: File[]): Promise<string[]> {
  const blank = files.map(() => "");
  if (!files.length || !(await ensurePathBridge())) return blank;
  const wv = webview2();
  if (!wv?.postMessageWithAdditionalObjects) return blank;
  const id = ++pathSeq;
  return new Promise<string[]>((resolve) => {
    // Runtime WebView2 trop ancien (< 1.0.1587) ou objet refusé : on rend des chemins vides plutôt
    // que de laisser l'appelant suspendu — l'import par sélecteur natif reste la voie de repli.
    const timer = setTimeout(() => { pathWaiters.delete(id); resolve(blank); }, 4000);
    pathWaiters.set(id, (paths) => { clearTimeout(timer); resolve(paths.length === files.length ? paths : blank); });
    try {
      wv.postMessageWithAdditionalObjects!({ __nrFiles: id }, files);
    } catch {
      clearTimeout(timer);
      pathWaiters.delete(id);
      resolve(blank);
    }
  });
}

// ---- Invocation RPC : POST /rpc { channel, args } -> result | throw ----
/** Journalise l'échec puis rend l'erreur à lancer — l'appelant garde son `throw` explicite. */
function fail(channel: string, message: string): Error {
  logError("core:rpc", `${channel} — ${message}`);
  return new Error(message);
}

// Le core est spawné en parallèle de la WebView : les premiers appels partent forcément avant qu'il
// n'écoute. Tant qu'il n'a JAMAIS répondu, on lui laisse largement le temps de démarrer — un
// démarrage à froid (antivirus qui inspecte node.exe et 300 Mo de ressources, disque lent) dépasse
// facilement quelques secondes, et la page d'installation, elle, affiche son erreur DÉFINITIVEMENT.
// Une fois le contact établi, une panne est une vraie panne : fenêtre courte, échec rapide.
const BOOT_GRACE_MS = 45_000;
const RETRY_GRACE_MS = 6_000;
const RETRY_STEP_MS = 250;
// Toutes les 2 s d'échecs, on rouvre la question de l'adresse : le core a pu renaître ailleurs.
const REDISCOVER_EVERY = 8;
let coreReached = false;

// Retour `any` : chaque méthode NrApi impose son propre type de retour (le cast est local au client).
async function call(channel: string, args: unknown[] = []): Promise<any> {
  // Un travail lourd se déclare AVANT de partir : ce qui allège l'app (fond animé figé) doit l'être
  // pendant le démarrage du job — chargement de modèle, spawn ffmpeg — pas seulement une fois que la
  // première progression est revenue.
  const releaseBusy = isHeavyChannel(channel) ? beginHeavyCall() : null;
  try {
    return await callInner(channel, args);
  } finally {
    releaseBusy?.();
  }
}

async function callInner(channel: string, args: unknown[] = []): Promise<any> {
  await ensureBase();
  const deadline = Date.now() + (coreReached ? RETRY_GRACE_MS : BOOT_GRACE_MS);
  let r: Response | null = null;
  let networkError: unknown = null;
  for (let attempt = 0; ; attempt++) {
    try {
      r = await fetch(`${BASE}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(TOKEN ? { "x-nr-token": TOKEN } : {}) },
        body: JSON.stringify({ channel, args }),
      });
      // Toute réponse HTTP prouve que le service écoute, même un 500 : la fenêtre longue de
      // démarrage n'a plus lieu d'être.
      coreReached = true;
      networkError = null;
      break;
    } catch (error) {
      networkError = error;
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, RETRY_STEP_MS));
      if (attempt % REDISCOVER_EVERY === REDISCOVER_EVERY - 1) {
        forgetBase();
        await ensureBase();
      }
    }
  }
  // Tout échec est JOURNALISÉ ici, au seul endroit que traversent les ~200 canaux : la plupart des
  // appelants attrapent et n'affichent qu'une notice, la console ne voyait donc jamais la cause.
  // Le service tourne hors de la webview : sa cause d'arrêt n'est QUE dans son journal (la coquille
  // Tauri release n'a pas de console). Sans ce pointeur, « Failed to fetch » n'était pas actionnable.
  if (!r) throw fail(channel, `core indisponible (${BASE}) : ${String(networkError || "Failed to fetch")}${isTauri ? " — journal : %LOCALAPPDATA%\\NetsuRush\\logs\\core.log" : ""}`);
  if (!r.ok) throw fail(channel, `core rpc HTTP ${r.status}: ${r.statusText || "request failed"}`);
  const j = await r.json();
  if (!j || !j.ok) throw fail(channel, (j && j.error) || `core rpc error: ${channel}`);
  return j.result;
}

// ---- Événements (progression) : SSE /events { channel, payload } ----
const listeners = new Map<string, Set<(p: unknown) => void>>();
let es: EventSource | null = null;
let sseOpening = false;
function ensureSse() {
  if (es || sseOpening || typeof EventSource === "undefined") return;
  // L'adresse n'est peut-être pas encore connue (recherche du port en cours) : ouvrir maintenant
  // brancherait le flux sur un port au hasard. Le garde `sseOpening` évite d'en ouvrir plusieurs
  // pendant l'attente, chaque abonnement passant par ici.
  sseOpening = true;
  void ensureBase().then(() => {
    sseOpening = false;
    if (es || !listeners.size) return;
    es = new EventSource(`${BASE}/events`);
    es.onmessage = (e) => {
      try {
        const { channel, payload } = JSON.parse(e.data);
        const set = listeners.get(channel);
        if (set) for (const cb of set) cb(payload);
      } catch {
        /* ignore */
      }
    };
  });
}
function on(channel: string, cb: (p: unknown) => void): () => void {
  ensureSse();
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (!set!.size) listeners.delete(channel);
    if (!listeners.size && es) {
      es.close();
      es = null;
    }
  };
}

// ---- Plugins Tauri (chargés paresseusement, no-op hors Tauri) ----
const VIDEO_EXT = ["mp4", "mov", "mkv", "avi", "m4v", "mxf", "webm", "wmv", "flv", "ts", "m2ts", "mpg", "mpeg"];
const IMAGE_EXT = ["jpg", "jpeg", "png", "tif", "tiff", "bmp", "webp", "gif", "dpx", "exr"];

async function dlgOpen(opts: Record<string, unknown>): Promise<string | string[] | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  return (await open(opts)) as string | string[] | null;
}
async function dlgSave(defaultPath?: string): Promise<string | null> {
  if (!isTauri) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  return await save({ defaultPath, filters: [{ name: i18n.t("common:fileType.video"), extensions: ["mp4", "mov", "mkv"] }] });
}

// Rendu « en remote » (iframe dans le panneau CEP Adobe) : pas de dialogue Tauri. On demande au
// panneau PARENT d'ouvrir le sélecteur de fichiers NATIF de CEP (chemins disque réels) via postMessage.
const isRemote = typeof window !== "undefined" && !!(window as unknown as { __NR_REMOTE__?: boolean }).__NR_REMOTE__;

// `maybe` signifie seulement que le conteneur semble plausible, pas que le codec sera décodé.
// Règle retenue : accepter `probably`, ou la confirmation MediaSource.
function browserSupportsMime(video: HTMLVideoElement, mime: string): boolean {
  const direct = video.canPlayType(mime) === "probably";
  const mse = typeof MediaSource !== "undefined" && typeof MediaSource.isTypeSupported === "function"
    && MediaSource.isTypeSupported(mime);
  return direct || mse;
}

// Le panneau distant demande toujours le MP4 H.264, format vidéo le plus compatible de ce flux.
let _remoteCodec: "h264" | null = null;
function remoteProxyCodec(): "h264" {
  if (_remoteCodec) return _remoteCodec;
  let c: "h264" = "h264";
  try {
    const v = document.createElement("video");
    if (browserSupportsMime(v, 'video/mp4; codecs="avc1.42E01E"')) c = "h264";
  } catch { /* garde H.264 */ }
  _remoteCodec = c;
  try { console.info("[NetsuRush] codec aperçu (remote) :", c); } catch { /* noop */ }
  return c;
}

// Le standalone Tauri utilise le WebView2 installé sur le PC, dont la disponibilité HEVC varie
// selon Windows/runtime/codec système. Garder H.265 dès qu'il est réellement annoncé ; sinon,
// négocier H.264 au lieu de servir un MP4 dont seul l'AAC serait lu (son + image noire).
let _standaloneCodec: "hevc" | "h264" | null = null;
function standaloneProxyCodec(): "hevc" | "h264" {
  if (_standaloneCodec) return _standaloneCodec;
  let c: "hevc" | "h264" = "h264";
  try {
    const v = document.createElement("video");
    const hevcMimes = [
      'video/mp4; codecs="hvc1"',
      'video/mp4; codecs="hev1"',
      'video/mp4; codecs="hvc1.1.6.L93.B0"',
      'video/mp4; codecs="hev1.1.6.L93.B0"',
    ];
    if (hevcMimes.some((mime) => browserSupportsMime(v, mime))) c = "hevc";
  } catch { /* garde H.264 */ }
  _standaloneCodec = c;
  try { console.info("[NetsuRush] codec aperçu (WebView2) :", c); } catch { /* noop */ }
  return c;
}
function requestParentFiles(multiple: boolean, exts: string[]): Promise<string[] | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || window.parent === window) return resolve(null);
    const id = `nrfiles-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; id?: string; paths?: string[] } | null;
      if (!d || d.type !== "nr:files:result" || d.id !== id) return;
      window.removeEventListener("message", onMsg);
      resolve(Array.isArray(d.paths) && d.paths.length ? d.paths : null);
    };
    window.addEventListener("message", onMsg);
    window.parent.postMessage({ type: "nr:files", id, multiple, exts }, "*");
    setTimeout(() => { window.removeEventListener("message", onMsg); resolve(null); }, 120000);
  });
}

async function openUrl(url: string): Promise<boolean> {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    if (isTauri) {
      const { openUrl: open } = await import("@tauri-apps/plugin-opener");
      await open(url);
    } else {
      window.open(url, "_blank", "noopener");
    }
    return true;
  } catch {
    return false;
  }
}
// Ouvre un FICHIER/dossier local dans l'app système par défaut (lien de note → fichier).
async function openPath(path: string): Promise<boolean> {
  if (!path) return false;
  try {
    if (isTauri) {
      const { openPath: open } = await import("@tauri-apps/plugin-opener");
      await open(path);
    } else {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Ouvre l'Explorateur sur le dossier contenant le chemin et sélectionne l'élément exact.
async function revealPath(path: string): Promise<boolean> {
  if (!path || !isTauri) return false;
  try {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(path);
    return true;
  } catch {
    return false;
  }
}

function abToB64(ab: ArrayBuffer): string {
  const bytes = new Uint8Array(ab);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ---- Fenêtre détachée du board (Tauri v2) ----
// Le board sync déjà entre fenêtres via le core (push/onPush en SSE). Ici : créer/fermer la 2e
// fenêtre (label "reference", même renderer au hash #reference) + épingler always-on-top.
// Pas de confirmation de fermeture : l'autosave (scène __autosave__ restaurée au démarrage) garantit
// qu'aucun travail n'est perdu en quittant → un dialogue « enregistrer ? » serait une fausse alerte.
const REF_LABEL = "reference";

const reference: RefApi = {
  listScenes: () => call("reference:listScenes"),
  storagePath: () => call("reference:storagePath"),
  loadScene: (id) => call("reference:loadScene", [id]),
  saveScene: (scene) => call("reference:saveScene", [scene]),
  deleteScene: (id) => call("reference:deleteScene", [id]),
  saveAsset: (bytes, ext) => call("reference:saveAsset", [{ __b64: abToB64(bytes) }, ext]),
  fetchAsset: (url, options) => call("reference:fetchAsset", [url, options || {}]),
  resolveMedia: (url, options) => call("reference:resolveMedia", [url, options || {}]),
  upscaleItem: (opts) => call("reference:upscaleItem", [opts]),
  dropAsset: (p) => call("reference:dropAsset", [p]),
  sweepAssets: (opts) => call("reference:sweepAssets", [opts || {}]),
  scanFolder: (dir, opts) => call("reference:scanFolder", [dir, opts || {}]),
  writeFile: (p, data, encoding) => call("reference:writeFile", [p, data, encoding]),
  sampleFrame: (p, opts) => call("reference:sampleFrame", [p, opts || {}]),
  extractMedia: (url, options) => call("reference:extractMedia", [url, options || {}]),
  extractFrames: (opts) => call("reference:extractFrames", [opts]),
  exportBoard: (scene, destPath, opts) => call("netsu:export", [scene, destPath, opts]),
  importBoard: (srcPath) => call("netsu:import", [srcPath]),
  onShareProgress: (cb) => on("netsu:progress", cb as (p: unknown) => void),
  relocateFrom: (dirPath, wanted) => call("netsu:relocateFrom", [dirPath, wanted]),
  weigh: (scene, opts) => call("netsu:weigh", [scene, opts]),
  chooseNetsu: () =>
    dlgOpen({ multiple: false, filters: [{ name: "Board NetsuRush", extensions: ["netsu"] }] }) as Promise<string | null>,
  saveNetsuPath: async (defaultName) => {
    if (!isTauri) return null;
    const { save } = await import("@tauri-apps/plugin-dialog");
    return await save({ defaultPath: defaultName, filters: [{ name: "Board NetsuRush", extensions: ["netsu"] }] });
  },
  openProject: (srcPath) => call("netsu:openProject", [srcPath]),
  previewProject: (srcPath) => call("netsu:previewProject", [srcPath]),
  saveProject: (filePath, scene) => call("netsu:saveProject", [filePath, scene]),
  saveProjectAs: (opts) => call("netsu:saveProjectAs", [opts]),
  closeProject: (filePath) => call("netsu:closeProject", [filePath]),
  recentProjects: (type) => call("netsu:recents", [type]),
  forgetProject: (filePath) => call("netsu:forget", [filePath]),
  deleteProject: (filePath) => call("netsu:deleteProject", [filePath]),
  // No-op : aucune garde de fermeture (l'autosave protège déjà le board). Conservé pour l'API.
  setDirty: () => {},
  // Depuis la fenêtre principale : ouvre (ou refocus) la fenêtre détachée flottante.
  detach: () => {
    void (async () => {
      if (!isTauri) return;
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const existing = await WebviewWindow.getByLabel(REF_LABEL);
      if (existing) {
        await existing.setFocus().catch(() => {});
        return;
      }
      const win = new WebviewWindow(REF_LABEL, {
        url: "index.html#reference",
        title: i18n.t("common:window.reference"),
        decorations: false,
        alwaysOnTop: true,
        width: 720,
        height: 560,
        minWidth: 360,
        minHeight: 320,
        // false → la WebView gère le DnD HTML5 (glisser une carte vers le board + déposer des
        // fichiers OS arrivent via dataTransfer). true (défaut) le confie à l'OS et BLOQUE le DnD HTML5.
        dragDropEnabled: false,
      });
      win.once("tauri://error", (e) => console.error("[reference] échec ouverture fenêtre détachée", e));
    })();
  },
  // Depuis la fenêtre détachée : la ferme et redonne le focus à la principale. Le focus est
  // best-effort (try/catch) pour ne JAMAIS empêcher la fermeture si setFocus échoue.
  attach: () => {
    void (async () => {
      if (!isTauri) return;
      const { getCurrentWindow, Window } = await import("@tauri-apps/api/window");
      try {
        const main = await Window.getByLabel("main");
        await main?.setFocus();
      } catch {
        /* focus best-effort */
      }
      await getCurrentWindow().close();
    })();
  },
  setAlwaysOnTop: (on) => {
    void (async () => {
      if (!isTauri) return;
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setAlwaysOnTop(on).catch(() => {});
    })();
  },
  push: (payload) => { void call("reference:push", [payload]); },
  onPush: (cb) => on("reference:push", cb),
};

const power: PowerApi = {
  state: () => call("power:state"),
  reconcile: () => call("power:reconcile"),
  close: (host) => call("power:close", [host]),
  reopen: () => call("power:reopen"),
  restart: (host) => call("power:restart", [host]),
  onChanged: (cb) => on("power:changed", cb as (p: unknown) => void),
  onProgress: (cb) => on("power:progress", cb as (p: unknown) => void),
};

// --- Changement de format de la fenêtre (bascule épinglé ↔ normal) -----------------------------
// La fenêtre passe d'un format à l'autre en interpolant sa géométrie sur quelques frames. Posée
// d'un coup, la nouvelle taille se lit comme un à-coup ; étalée sur deux dixièmes de seconde, elle
// se lit comme un changement de format. Rien de tout cela ne touche le board : c'est la coquille.
type Rect = { x: number; y: number; w: number; h: number };
let resizeToken = 0;
const RESIZE_MS = 200;
const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
// « Réduire les animations » (WCAG 2.3.3) : la fenêtre saute directement au format visé.
const reduceMotion = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Zone utile de l'écran courant (barre des tâches exclue), en pixels logiques, ou null. */
async function workArea(currentMonitor: typeof import("@tauri-apps/api/window").currentMonitor): Promise<Rect | null> {
  try {
    const mon = await currentMonitor();
    if (!mon) return null;
    const p = mon.workArea.position.toLogical(mon.scaleFactor);
    const s = mon.workArea.size.toLogical(mon.scaleFactor);
    return { x: p.x, y: p.y, w: s.width, h: s.height };
  } catch {
    return null;
  }
}

/** Ramène un rectangle dans la zone utile. Sans recentrage, une fenêtre posée près d'un bord
 *  déborderait en grandissant — et une fenêtre à moitié hors écran ne se rattrape pas à la souris. */
function clampToArea(rect: Rect, area: Rect | null): Rect {
  if (!area) return rect;
  const x = Math.min(Math.max(rect.x, area.x), Math.max(area.x, area.x + area.w - rect.w));
  const y = Math.min(Math.max(rect.y, area.y), Math.max(area.y, area.y + area.h - rect.h));
  return { ...rect, x, y };
}

export function makeCoreClient(): NrApi {
  const client: NrApi = {
    configGet: () => call("config:get"),
    configSetLang: (lang) => call("config:setLang", [lang]),
    setupStatus: () => call("setup:status"),
    setupRun: () => call("setup:run"),
    compatibilityStatus: (opts) => call("compat:status", [opts ?? {}]),
    onSetupProgress: (cb) => on("setup:progress", cb as (p: unknown) => void),
    consoleLogs: () => call("console:logs").then((logs) => ({ ok: true, logs: logs || [] })),
    consoleClear: () => call("console:clear"),
    onConsoleLog: (cb) => on("console:log", cb as (p: unknown) => void),
    bugReport: (request) => call("bug:report", [request]),
    bugStatus: () => call("bug:status"),
    bugContext: () => call("bug:context"),
    status: () => call("resolve:status"),
    importToMediaPool: (paths) => call("resolve:import", [paths]),
    refreshNow: () => { void call("resolve:refreshNow").catch(() => {}); },
    playInfo: (p) => call("player:info", [p]),
    streamUrl: (p, t, mode) => `${BASE}/stream?p=${encodeURIComponent(p)}&t=${t || 0}&mode=${mode}${tkParam}`,
    audioTracks: (p) => call("ffmpeg:audioTracks", [p]),
    detectScenes: (p, threshold, model, options) => call("ffmpeg:detectScenes", [p, threshold, model, options]),
    cachedScenes: (p, model, threshold, options) => call("ffmpeg:cachedScenes", [p, model, threshold, options]),
    // En remote (panneau CEP) → codec que le moteur SAIT lire : H.264 si dispo, sinon WebM/VP8
    // (garanti dans tout Chromium, même un CEF sans codecs propriétaires). Sondé une fois.
    proxy: (opts) => {
      const request = { ...opts, settings: opts.settings ?? readPreviewSettings().proxy };
      const automaticCodec = isRemote ? remoteProxyCodec() : isTauri ? standaloneProxyCodec() : undefined;
      const codec = request.codec ?? (request.settings.format === "hevc" ? automaticCodec : undefined);
      return call("ffmpeg:proxy", [{ ...request, ...(codec ? { codec } : {}) }]);
    },
    proxyCancel: (token) => { call("ffmpeg:proxyCancel", [token]).catch(() => {}); },
    thumbnail: (p, t, priority) => call("ffmpeg:thumbnail", [{ path: p, time: t, priority, settings: readPreviewSettings().thumbnail }]),
    thumbsBatch: (p, items) => call("ffmpeg:thumbsBatch", [{ path: p, items, settings: readPreviewSettings().thumbnail }]),
    thumbsResolve: (items) => call("ffmpeg:thumbsResolve", [{ items, settings: readPreviewSettings().thumbnail }]),
    exportCapabilities: (opts) => call("export:capabilities", [opts ?? {}]),
    adobeStatus: () => call("adobe:status"),
    adobeSnapshot: (app) => call("adobe:snapshot", [app]),
    adobeLaunch: (app) => call("adobe:launch", [app]),
    adobeScan: (app) => call("adobe:cmd", [app, { cmd: "scan" }]),
    adobeImport: (app, paths) => call("adobe:import", [{ app, paths }]),
    adobeInstallPanel: () => call("adobe:installPanel"),
    adobeSetPanelAutoUpdate: (on) => call("adobe:setPanelAutoUpdate", [on]),
    upscaleRun: (opts) => call("upscale:run", [opts]),
    upscaleShaderRun: (opts) => call("upscale:shaderRun", [opts]),
    upscaleTestFrame: (opts) => call("upscale:testFrame", [opts]),
    onUpscaleProgress: (cb) => on("upscale:progress", cb as (p: unknown) => void),
    chooseDir: () => dlgOpen({ directory: true }) as Promise<string | null>,
    chooseFiles: () =>
      isRemote
        ? requestParentFiles(true, VIDEO_EXT)
        : (dlgOpen({ multiple: true, filters: [{ name: i18n.t("common:fileType.video"), extensions: VIDEO_EXT }] }) as Promise<string[] | null>),
    chooseImages: () =>
      isRemote
        ? requestParentFiles(true, IMAGE_EXT)
        : (dlgOpen({ multiple: true, filters: [{ name: i18n.t("common:fileType.image"), extensions: IMAGE_EXT }] }) as Promise<string[] | null>),
    chooseAnyFile: () =>
      isRemote
        ? requestParentFiles(false, []).then((a) => (a && a[0]) || null)
        : (dlgOpen({ multiple: false }) as Promise<string | null>),
    pathsForFiles: (files) => resolveFilePaths(files),
    warmFilePaths: () => { void ensurePathBridge(); },
    saveFile: (defaultName) => dlgSave(defaultName),
    mediaUrl: (p) => `${BASE}/media?p=${encodeURIComponent(p)}${tkParam}`,
    assetUrl: (p) => assetSrc(p) ?? `${BASE}/media?p=${encodeURIComponent(p)}${tkParam}`,
    ytStreamUrl: (id) => `${BASE}/ytstream?id=${encodeURIComponent(id)}${tkParam}`,
    openExternal: (url) => openUrl(url),
    openPath: (p) => openPath(p),
    revealPath: (p) => revealPath(p),
    setAlwaysOnTop: (on) => {
      void (async () => {
        if (!isTauri) return;
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().setAlwaysOnTop(on).catch(() => {});
      })();
    },
    setWindowSize: (w, h) => {
      const token = ++resizeToken;
      void (async () => {
        if (!isTauri) return;
        const [{ getCurrentWindow, currentMonitor }, { LogicalSize, LogicalPosition }] = await Promise.all([
          import("@tauri-apps/api/window"),
          import("@tauri-apps/api/dpi"),
        ]);
        const win = getCurrentWindow();
        // Une fenêtre maximisée/plein écran/snappée IGNORE setSize (garde l'état → « plein écran »).
        // On retire ces états INCONDITIONNELLEMENT (isMaximized rate l'état sur fenêtre frameless/snap)
        // AVANT de redimensionner.
        try { await win.setFullscreen(false); } catch { /* noop */ }
        try { await win.unmaximize(); } catch { /* noop */ }

        const scale = await win.scaleFactor().catch(() => 1);
        let from = { x: 0, y: 0, w, h };
        try {
          const pos = (await win.outerPosition()).toLogical(scale);
          const size = (await win.innerSize()).toLogical(scale);
          from = { x: pos.x, y: pos.y, w: size.width, h: size.height };
        } catch { /* géométrie illisible → on pose la taille cible sans interpoler */ }

        // ANCRAGE SUR LE CENTRE COURANT, pas sur celui de l'écran : la fenêtre change de format sans
        // quitter l'endroit où l'utilisateur l'a posée. Recentrer la faisait traverser le bureau à
        // chaque bascule, ce qui se lit comme un saut et non comme un changement de format.
        const target = clampToArea(
          { x: from.x + (from.w - w) / 2, y: from.y + (from.h - h) / 2, w, h },
          await workArea(currentMonitor),
        );

        const apply = async (r: Rect) => {
          await win.setPosition(new LogicalPosition(Math.round(r.x), Math.round(r.y))).catch(() => {});
          await win.setSize(new LogicalSize(Math.round(r.w), Math.round(r.h))).catch(() => {});
        };
        if (reduceMotion() || (Math.abs(target.w - from.w) < 2 && Math.abs(target.h - from.h) < 2)) {
          await apply(target);
          return;
        }
        const start = performance.now();
        for (;;) {
          await nextFrame();
          // Une seconde bascule a pris la main : deux boucles écrivant la même fenêtre la font vibrer.
          if (token !== resizeToken) return;
          const p = Math.min(1, (performance.now() - start) / RESIZE_MS);
          const e = easeOut(p);
          await apply({
            x: from.x + (target.x - from.x) * e,
            y: from.y + (target.y - from.y) * e,
            w: from.w + (target.w - from.w) * e,
            h: from.h + (target.h - from.h) * e,
          });
          if (p >= 1) return;
        }
      })();
    },
    reference,
    power,
  };
  return client;
}

// True si un core standalone est l'environnement cible (Tauri, ou flag dev forcé).
export const coreAvailable: boolean =
  isTauri || (typeof window !== "undefined" && !!(window as unknown as { __NR_CORE__?: string }).__NR_CORE__);

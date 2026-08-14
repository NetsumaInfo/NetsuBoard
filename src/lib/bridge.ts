// Typed bridge. Trois transports possibles, même interface NrApi :
//  1. window.nr  — preload Electron (plugin historique dans Resolve)
//  2. core HTTP/SSE — app Tauri standalone (service Node "core"), cf. coreClient.ts
//  3. mock no-op  — vite dev dans un navigateur nu (l'UI rend quand même)

import { makeCoreClient, coreAvailable } from "./coreClient";
import i18n from "@/i18n";
import type { AudioSelect } from "@/features/export/profiles";

export interface ResolveInfo {
  connected: boolean;
  project?: string | null;
  timeline?: string | null;
  version?: string | null;
  error?: string | null;
}

export interface Scene {
  start: number;
  end: number;
  startFrame: number;
  endFrame: number;
  intraLabel?: OmniIntraLabel | null;
  interLabel?: OmniInterLabel | null;
}

export type DetectModel = "transnetv2" | "omnishotcut" | "autoshot";
export type OmniShotMode = "clean_shot" | "default";
export type OmniIntraLabel = "General" | "Dissolve" | "Wipes" | "Push" | "Slide" | "Zoom" | "Fade" | "Doorway";
export type OmniInterLabel = "New_Start" | "Hard_Cut" | "Transition_Source" | "Transition" | "Sudden_Jump";

export interface DetectOptions {
  minSceneFrames?: number;
  omnishotcut?: {
    mode?: OmniShotMode;
    overlapWindowLength?: number;
    intraLabels?: OmniIntraLabel[];
    interLabels?: OmniInterLabel[];
  };
  autoshot?: {
    threshold?: number;
  };
}

export interface SceneResult {
  scenes: Scene[];
  duration?: number | null;
  fps?: number | null;
  frames?: number | null;
  threshold?: number | null;
  model?: DetectModel | string | null;
  optionsKey?: string | null;
  cached?: boolean;
  error?: string | null;
}
// Capacités d'encodage RÉELLES de la machine (sonde ffmpeg côté core). `codecs` = ids d'ExportCodec
// qui encodent vraiment ici ; `ok:false` = sonde indisponible → le renderer ne filtre rien.
export interface ExportCapabilitiesResult {
  ok: boolean;
  codecs: string[];
  cpuCodecs: string[];
  hasGpuEncoder: boolean;
  hwEncoders: string[];
  codecEncoderOptions: Record<string, string[]>;
  error?: string;
}

export type UpscaleModel =
  | "anime" | "general" | "light"
  | "fallin" | "fallin_strong" | "adore" | "shufflecugan" | "cugan" | "ld_anime"
  | "aniscale2" | "open-proteus" | "span" | "rtmosr" | "smosr" | "figsr" | "saryn" | "shufflespan" | "animesr"
  | "tas-scunet" | "tas-nafnet" | "tas-dpir" | "tas-real-plksr" | "tas-anime1080fixer"
  | "tas-deh264-real" | "tas-deh264-span" | "tas-hurrdeblur" | "tas-dehalo"
  | "artcnn_r16f96" | "artcnn_r8f64"
  | "ntire-span" | "ntire-pds" | "ntire-zenosr" | "ntire-haesr" | "ntire-rfdn-span"
  | "ntire-hfenet" | "ntire-vscinet" | "ntire-dscf" | "ntire-pkdsr" | "ntire-amcanet"
  | "ntire-disp" | "ntire-bviesr" | "ntire-errn2" | "ntire-safmn";
export type UpscaleCodec =
  | "x264" | "x265"
  | "h264_gpu" | "hevc_gpu"
  | "h264_nvenc" | "h264_amf" | "h264_qsv"
  | "hevc_nvenc" | "hevc_amf" | "hevc_qsv"
  | "prores_proxy" | "prores_lt" | "prores_422" | "prores_hq" | "prores_4444" | "prores_4444xq"
  | "dnxhr_lb" | "dnxhr_sq" | "dnxhr_hq" | "dnxhr_hqx" | "dnxhr_444";
export type AudioMode = "copy" | "aac" | "ac3" | "flac" | "pcm" | "none";

export interface AudioTrack {
  index: number;           // index relatif parmi les pistes audio (a:N)
  codec: string;
  channels: number;
  lang?: string | null;
  title?: string | null;   // titre libre de piste (« Japanese », « VF »…) — 2e signal de langue
  langCode?: string | null; // langue normalisée depuis lang/title (core/audioLang) ; null = non étiquetée
}

// Réglages d'encodage NetsuLab alignés sur les profils d'export généraux.
export interface ProcessExportOpts {
  exportCodec?: string;
  encoderMode?: "gpu" | "nvenc" | "amf" | "qsv" | "cpu";
  speed?: "fast" | "balanced" | "quality" | "max";
  audioMode?: string;
  container?: "mp4" | "mkv" | "mov" | "webm";
}

export interface UpscaleOpts extends ProcessExportOpts {
  input: string;
  model: UpscaleModel;
  scale: 1 | 2 | 4;        // 1 = restauration taille d'origine ; 2/4 = agrandissement
  codec: UpscaleCodec;
  denoise?: number;        // 0..1, modèle léger uniquement (DNI avec la variante débruitée)
  tile?: number;           // 0 = auto ; 256/512/1024 anti-OOM en 4K
  tilePad?: number;        // recouvrement entre tuiles (tile_pad RealESRGAN, défaut 10)
  prePad?: number;         // padding de bord (pre_pad RealESRGAN, défaut 0)
  fp32?: boolean;          // true = précision (plus lent), false = fp16 GPU (défaut)
  cleanupNoise?: number;   // 0..1, nettoyage post-upscale du bruit fin
  cleanupEdges?: number;   // 0..1, réduction post-upscale des halos/contours durs
  quality?: number;        // CRF x264/x265 (bas = meilleure qualité), ignoré ProRes/DNxHR
  preset?: string;         // preset x264/x265 (veryfast..slow)
  bitDepth?: 8 | 10;       // profondeur (dérivée du profil, compat legacy)
  profile?: string;        // profil codec réel (-profile:v) : main/high/high10/high422…
  audio?: AudioMode;       // copier / réencoder (aac, ac3, flac, pcm) / aucune
  abr?: number;            // débit audio kbps (aac/ac3)
  audioTrack?: number;     // piste audio à conserver (index relatif)
  outDir: string;
  whole?: boolean;         // rush entier
  segments?: { in: number; out: number }[];   // plage (1) ou plans sélectionnés (N)
  importBack?: boolean;    // AddItemListToMediaPool des sorties
  baseName?: string;       // nom de base du fichier (sinon dérivé de input)
  outputName?: string;     // nom final choisi par l'utilisateur, sans extension ni suffixe automatique
}

export interface UpscaleResult {
  ok: boolean;
  outputs?: string[];
  imported?: number;
  total?: number;
  failed?: number;
  error?: string | null;
}

// Moteur Turbo : upscale par shader GLSL (ffmpeg libplacebo, GPU temps réel) — pas d'IA.
export type ShaderModel =
  | "artcnn_r16f96" | "artcnn_r8f64"
  | "artcnn_c4f32" | "artcnn_c4f32_ds" | "artcnn_c4f32_dn"
  | "artcnn_c4f16" | "artcnn_c4f16_ds" | "artcnn_c4f16_dn"
  | "anime4k_aa_hq" | "anime4k_bb_hq" | "rtx_vsr" | "lanczos"
  // Valeurs persistées historiques : toujours acceptées par le core, mais retirées du sélecteur.
  | "artcnn_quality" | "anime4k";

export interface UpscaleShaderOpts extends ProcessExportOpts {
  input: string;
  shader: ShaderModel;
  scale: 1 | 2 | 4;
  codec: UpscaleCodec;
  deband?: "none" | "light" | "medium" | "strong";  // anti-aplats (libplacebo deband)
  grain?: number;                                     // grain de débanding (masque les bandes résiduelles)
  sharp?: "soft" | "sharp";                          // noyau de redimensionnement (spline36 / lanczossharp)
  sigmoid?: boolean;                                  // anti-ringing/halos sur agrandissement
  dither?: boolean;                                   // tramage (réduit le banding 8-bit)
  // RTX Video SDK (shader `rtx_vsr`) — ignorés par les shaders libplacebo.
  vsrQuality?: 1 | 2 | 3 | 4;
  hdr?: boolean;                                      // TrueHDR : conversion SDR → HDR10
  hdrContrast?: number;
  hdrSaturation?: number;
  hdrMidGray?: number;
  hdrNits?: number;                                   // luminance crête du master HDR
  quality?: number;
  preset?: string;
  bitDepth?: 8 | 10;                                  // profondeur (dérivée du profil, compat legacy)
  profile?: string;                                   // profil codec réel (-profile:v)
  audio?: AudioMode;
  abr?: number;
  audioTrack?: number;
  outDir: string;
  whole?: boolean;
  segments?: { in: number; out: number }[];
  importBack?: boolean;
  baseName?: string;
  outputName?: string;
  parallel?: boolean;
  concurrency?: 2 | 3 | 4;
}

export interface UpscaleProgress {
  file: string;
  pct: number | null;
  done: number;
  total: number;
  phase: string;
}

// Test d'upscale sur UNE frame : compare avant/après sans encoder tout le clip.
export interface UpscaleFrameOpts {
  input: string;
  time: number;            // seconde de la frame à tester
  // Même aiguillage que l'encodage : sans ces deux champs l'aperçu montrerait le rendu du moteur IA
  // pendant que le fichier final sortirait d'un shader Turbo.
  engine?: "ia" | "turbo";
  shader?: ShaderModel;
  model: UpscaleModel;
  scale: 1 | 2 | 4;
  denoise?: number;
  tile?: number;
  tilePad?: number;
  prePad?: number;
  fp32?: boolean;
  cleanupNoise?: number;
  cleanupEdges?: number;
}

export interface UpscaleFrameResult {
  ok: boolean;
  orig?: string;           // PNG frame source (chemin disque)
  out?: string;            // PNG frame upscalée
  width?: number;
  height?: number;
  black?: boolean;         // frame quasi noire (fondu) → l'UI invite à déplacer la tête
  error?: string | null;
}

// ---- Hub Traitements vidéo (interpolation / depth / removeBG) ---------------
// Modes du hub : upscale (existant) + 3 nouveaux moteurs ; sortie = fichier importé au Media Pool.
export type ProcMode = "upscale" | "interpolate" | "depth" | "removebg";

// ---- Gestionnaire de modèles app-wide --------------------------------------
// Statut d'installation d'un modèle (id aligné sur src/lib/modelRegistry.ts + core/models.js).
export interface ModelStatus {
  id: string;
  installed: boolean;
  available?: boolean;
  sizeBytes?: number;
  partial?: boolean;
  downloading?: boolean;
  progress?: number | null;
}
export interface ModelListResult { ok: boolean; models: ModelStatus[]; error?: string; }
// Progression de téléchargement (SSE models:progress). done/total en octets si connus.
export interface ModelProgress { id: string; pct: number | null; done?: number; total?: number; stage?: string; error?: string; }

// ---- Pipeline ordonné (chaîne de transforms) -------------------------------
// Ops chaînables (vidéo→vidéo). Depth/matte sont DÉRIVÉS → hors chaîne.
export type PipelineOpKind = "upscale" | "interpolate";

// --- Pont Adobe (panneau CEP Premiere/AE ↔ core) — temps en SECONDES ---
export type AdobeApp = "ppro" | "aeft";

export interface AdobeClip {
  name: string;
  path: string | null;          // null = item synthétique (titre, solide…)
  tlStart: number | null;       // position timeline (s)
  tlEnd: number | null;
  srcIn: number | null;         // trim source (s)
  srcOut: number | null;
  // ---- Vérité en FRAMES (Timeline Live). Optionnels : un panneau CEP plus ancien que ces champs
  // envoie encore un snapshot valide, et le mapping retombe alors sur les secondes × fps.
  srcFps?: number | null;       // fps de la SOURCE (≠ fps séquence/comp) — base des frames ci-dessous
  direct?: boolean;             // false = bornes reportées en secondes depuis une séquence imbriquée
  srcInFrame?: number | null;   // frames source INCLUSIVES (même convention que Resolve)
  srcOutFrame?: number | null;
  srcFrames?: number | null;    // longueur totale de la source ; null = inconnue (Premiere ne l'expose pas)
  tlStartFrame?: number | null; // position timeline en frames de la séquence/comp
}

export interface AdobeSequence {
  name: string;
  fps: number | null;
  w: number | null;
  h: number | null;
  // `name` = nom BRUT de la piste côté hôte (`Track.name`, lecture seule). Optionnel : un panneau
  // CEP antérieur à ce champ envoie encore un snapshot valide, la piste garde alors son numéro.
  tracks: { kind: "video" | "audio"; index: number; name?: string; clips: AdobeClip[] }[];
}

export interface AdobeSnapshot {
  ok: boolean;
  app: AdobeApp;
  appVersion: string;
  project: string;
  projectPath: string | null;
  // Séquence Premiere / comp AE OUVERTE au moment du scan : l'équivalent Adobe de la « timeline
  // ouverte » de Resolve. Optionnel (panneau antérieur à ce champ → aucune destination par défaut).
  activeSequence?: string | null;
  at: number;
  rushes: { path: string; name: string; fps: number | null; dur: number | null; w: number | null; h: number | null }[];
  sequences: AdobeSequence[];
}

export interface AdobeAppStatus {
  installed: boolean;
  exe: string | null;
  running: boolean;
  panelConnected: boolean;      // heartbeat du panneau < 12 s
  lastSnapshotAt: number | null;
}

export interface AdobeBridgeStatus {
  ok: boolean;
  ppro: AdobeAppStatus;
  aeft: AdobeAppStatus;
  panelInstalled: boolean;      // manifest présent dans %APPDATA%\Adobe\CEP\extensions
  panelDir?: string;            // chemin d'installation du panneau (dossier extensions CEP)
  panelVersion?: string | null;          // version livrée avec cette version de NetsuRush
  panelInstalledVersion?: string | null; // version réellement posée dans Adobe
  panelBuild?: string | null;            // empreinte COURTE du contenu livré : identifie le build
  panelAutoUpdate?: boolean;             // réinstallation auto quand le panneau livré change
  panelOutdated?: boolean;               // copie installée ≠ copie livrée (auto-update coupé)
  panelUpdatedAt?: number | null;        // dernière mise à jour automatique
  panelRestartApps?: AdobeApp[];         // apps ouvertes pendant l'installation → à redémarrer
}

// ---- Provisionnement 1er lancement (app packagée) -------------------------
export interface SetupItem {
  id: string;        // "ffmpeg" | "venv" | "transnet"
  label: string;
  done: boolean;
}
export interface SetupStatus {
  ready: boolean;    // ffmpeg + venv présents → fonctions cœur opérationnelles
  venv: boolean;
  transnet?: boolean;
  ffmpeg: boolean;
  weights: boolean;
  hardware?: {
    gpus: Array<{ name: string; vendor: "nvidia" | "amd" | "intel" | "other"; driverVersion: string | null; pnpDeviceId?: string | null; role?: "igpu" | "dgpu" | "unknown" }>;
    cpus: string[];
    vendors: Array<"nvidia" | "amd" | "intel" | "other">;
    primaryVendor: "nvidia" | "amd" | "intel" | "other" | "cpu";
    initialMlBackend: "cuda" | "rocm" | "xpu" | "cpu";
    initialOnnxBackend: "cuda" | "directml" | "cpu";
    windowsBuild: number;
    label: string;
  };
  mlBackend?: string;
  onnxBackend?: string;
  installedModules?: string[];
  installedModels?: string[];
  runtime?: { ok?: boolean; actual?: string; gpu?: boolean; omnishotcut?: boolean; siglip?: boolean; error?: string | null } | true;
  home: string;      // dossier de données écrivable (NR_HOME)
  items: SetupItem[];
}
// Suivi d'UN élément téléchargé (archive, roue pip, modèle). `total: 0` = taille inconnue :
// l'interface montre alors une barre indéterminée plutôt qu'un pourcentage inventé.
export interface SetupDownload {
  name: string;
  state: "download" | "work" | "retry" | "error" | "done" | "skip";
  done: number;   // octets reçus
  total: number;  // octets attendus, 0 si le serveur ne l'annonce pas
}

export interface SetupProgress {
  pct?: number;      // 0..100
  stage?: string;    // python | venv | torch | deps | ffmpeg | weights | config | done | error
  label?: string;    // libellé lisible de l'étape
  line?: string;     // ligne brute (sortie pip/ffmpeg) hors marqueurs
  dl?: SetupDownload; // état vivant d'un téléchargement, hors journal
}

export interface CompatibilityStatus {
  ok: boolean;
  hardware: NonNullable<SetupStatus["hardware"]>;
  configured: { torch: string; onnx: string; transcribe: string };
  runtime: {
    torch: null | { configured: string; actual: string; device: string; deviceName: string | null; version: string; accelerated: boolean };
    onnx: null | { configured: string; availableProviders: string[]; selectedProviders: string[]; version: string; accelerated: boolean };
    errors: string[];
  };
  encoding: { h264: string | null; h265: string | null; av1: string | null; webp: boolean; hardwareEncoders: string[]; codecEncoders: Record<string, string | null>; codecEncoderOptions: Record<string, string[]>; upscaleProfileEncoderOptions: Record<string, string[]>; codecs: string[]; error: string | null };
}

export type PreviewProxyFormat = "hevc" | "h264" | "webm";
export type PreviewProxyEngine = "auto" | "nvenc" | "amf" | "qsv" | "cpu";
export type PreviewProxyPreset = "level1" | "level2" | "level3";
export type PreviewHeight = 360 | 480 | 520 | 720;
// Cran de qualité des miniatures. Un cran pilote hauteur ET compression : la table numérique vit
// côté core (`core/thumbPresets.js`), seule source de vérité — le renderer n'en connaît que les ids.
export type ThumbPreset = "light" | "balanced" | "sharp";
export interface PreviewGenerationSettings {
  proxy: {
    format: PreviewProxyFormat;
    engine: PreviewProxyEngine;
    preset: PreviewProxyPreset;
    height: PreviewHeight;
    audio: boolean;
  };
  thumbnail: {
    format: "jpeg" | "webp";
    preset: ThumbPreset;
  };
}
export interface SetupRunResult {
  ok: boolean;
  error?: string;
  needsRestart?: boolean;   // redémarrer l'app pour recharger les chemins (config figée au boot)
  verified?: boolean;
}
export interface SetupRunOptions {
  modules: string[];
  models: string[];
  adobePanel?: boolean;   // poser l'extension CEP Premiere/After Effects (et la garder à jour)
}

export interface PlayInfo {
  duration: number;
  codec: string;
  pix: string;
  fps: number;       // images/s exact (avg_frame_rate) → plage frame-accurate
  native: boolean;   // décodable nativement par <video> → lecture remux copie
  error?: string;
}

// ---- Board de référence (mood-board) -------------------------------------
// Les items/vue transitent en `unknown` (frontière IPC) ; le module renderer les re-type.
export interface RefSceneMeta {
  id: string;
  name: string;
  updatedAt: number;
}
export interface RefSceneIn {
  id?: string;
  name: string;
  items: unknown[];
  view?: unknown;
}
export interface RefSceneOut {
  id: string;
  name: string;
  items: unknown[];
  view: unknown | null;
  updatedAt: number;
}
// ---- Partage « .netsu » (board → conteneur SQLite type-routé) ----
// Le NIVEAU dit ce qu'on garde du média, du plus léger au plus lourd. La qualité et la marge sont
// des réglages du niveau, pas des niveaux : voir core/netsu/levels.js, source unique des règles.
export type NetsuLevel =
  | "link"      // rien du média : chemin/lien + bornes + une image de poster
  | "preview"   // la plage jouée, réencodée petit (défaut)
  | "margin"    // la plage jouée ÉLARGIE : bornes réajustables plus tard sans l'original
  | "full";     // le fichier source entier
export type NetsuQuality = "eco" | "standard" | "high";
/** Modes de l'archive v1, encore acceptés en entrée et ramenés à un niveau côté core. */
export type NetsuMode = "full" | "light" | "links";
export interface NetsuEmbed {
  level: NetsuLevel;
  quality?: NetsuQuality;
  marginSec?: number;
}
export interface NetsuExportOpts extends Partial<NetsuEmbed> {
  mode?: NetsuMode;         // rétrocompat : full→level "full", light→"preview", links→"link"
  freezeLinks?: boolean;    // télécharge les liens distants (image/gif) en assets → board pérenne
}
export interface NetsuCounts { items: number; bundled: number; referenced: number; bytes?: number }
export interface NetsuExportResult {
  ok: boolean;
  path?: string;
  bytes?: number;           // taille du fichier produit
  counts?: NetsuCounts;
  mode?: string;
  level?: NetsuLevel;
  error?: string;
}
/** Estimation de poids AVANT export — ordre de grandeur, jamais une promesse (débits moyens). */
export interface NetsuWeight {
  ok: boolean;
  level?: NetsuLevel;
  total?: number;                             // poids au niveau demandé
  perLevel?: Record<NetsuLevel, number>;      // poids du board à chacun des 4 niveaux
  items?: { id: string; kind: string; bytes: number; long: boolean }[];
  error?: string;
}
// `retain` = localisateurs que le board peut encore réclamer sans qu'ils soient posés : médias
// retenus par l'historique d'annulation. Le core les met à l'abri de son ménage de fin
// d'enregistrement — sans quoi supprimer un item effacerait ses octets avant le Ctrl+Z suivant.
export interface NetsuScene { name: string; items: unknown[]; view?: unknown; retain?: string[] }
export interface NetsuImportResult {
  ok: boolean;
  scene?: { name: string; items: unknown[]; view: unknown | null };
  counts?: NetsuCounts | null;
  type?: string;            // type du conteneur si non pris en charge
  error?: string;
}

// ---- Projet .netsu : le fichier comme document de travail ----------------------------------------
/** Lecture d'un projet. `readonly` = archive v1 (lisible, pas modifiable en place). */
export interface NetsuProjectRead extends NetsuImportResult {
  path?: string;
  rev?: number;
  readonly?: boolean;
}
/** Compteurs d'un enregistrement : `changed` dit combien de lignes ont VRAIMENT bougé. */
export interface NetsuProjectSave {
  ok: boolean;
  path?: string;
  rev?: number;
  bytes?: number;
  sidecarDir?: string;      // dossier compagnon des médias, à côté du fichier
  counts?: { items: number; changed: number; removed: number; adopted: number; missing: number; freed: number };
  sourceSceneId?: string;
  sourceCleanup?: { ok: boolean; error?: string };
  error?: string;
}
/** Un projet récemment ouvert. `missing` = le fichier n'est plus à ce chemin (disque débranché…). */
export interface NetsuRecent {
  path: string;
  title: string;
  type: string;
  openedAt: number;
  modifiedAt?: number;
  missing: boolean;
  sourceSceneId?: string;
}

export interface ResolvedOnlineMedia {
  ok: boolean;
  path?: string;
  url?: string;
  kind?: "image" | "video";
  error?: string;
}

export interface RefApi {
  listScenes(): Promise<RefSceneMeta[]>;
  storagePath(): Promise<string>;
  loadScene(id: string): Promise<RefSceneOut | null>;
  saveScene(scene: RefSceneIn): Promise<{ ok: boolean; id?: string; updatedAt?: number; error?: string }>;
  deleteScene(id: string): Promise<{ ok: boolean; error?: string }>;
  saveAsset(bytes: ArrayBuffer, ext: string): Promise<{ ok: boolean; path?: string; error?: string }>;
  fetchAsset(url: string, options?: { projectPath?: string; title?: string }): Promise<{ ok: boolean; path?: string; kind?: "image" | "video"; error?: string }>;
  // Résout le vrai média de N'IMPORTE quel lien (fichier direct, ou page web via OpenGraph) → asset
  // disque. Catch-all générique : GIF (giphy/tenor), imgur, articles, CDN sans extension propre.
  resolveMedia(url: string, options?: { download?: boolean; projectPath?: string; title?: string }): Promise<ResolvedOnlineMedia>;
  // Upscale un item média (image/vidéo locale) → nouveau fichier asset. NON destructif : ne supprime
  // jamais l'ancien fichier (le board garde de quoi revenir en arrière).
  upscaleItem(opts: { path: string; kind: "image" | "video"; in?: number; out?: number; engine?: "ia" | "turbo"; model: UpscaleModel; shader?: ShaderModel; scale: 1 | 2 | 4; denoise?: number }): Promise<{ ok: boolean; path?: string; width?: number; height?: number; error?: string }>;
  // Supprime un fichier UNIQUEMENT s'il est un asset de l'app (cleanup d'un upscale annulé). Sûr.
  dropAsset(path: string): Promise<{ ok: boolean; removed?: boolean; error?: string }>;
  // Ménage du magasin d'assets : ce que plus aucune scène ne réclame et qui a passé le délai de
  // grâce s'en va. `graceMs` n'est là que pour les tests — l'app utilise le défaut du core.
  sweepAssets(opts?: { graceMs?: number }): Promise<{ ok: boolean; removed: number; bytes: number; kept: number; error?: string }>;
  // Dossier déposé sur le board : médias trouvés récursivement, avec leur sous-dossier RELATIF pour
  // que l'import reconstruise un cadre par dossier. `truncated` quand le plafond a coupé la liste.
  scanFolder(dir: string, opts?: { cap?: number }): Promise<{ ok: boolean; root: string; name: string; files: { path: string; rel: string; name: string; kind: "image" | "video" }[]; truncated: boolean; count: number }>;
  // Écrit un export du board (PNG/JPG en base64, SVG en texte) vers un chemin choisi par l'utilisateur.
  writeFile(path: string, data: string, encoding: "base64" | "utf8"): Promise<{ ok: boolean; path?: string; bytes?: number; error?: string }>;
  // Un cadre d'un média (image, GIF, vidéo) rendu par le core en PNG base64, lu SUR LE DISQUE.
  // Seule source de pixels relisible par le renderer : le protocole d'asset teinte le canvas.
  sampleFrame(path: string, opts?: { at?: number; side?: number }): Promise<{ ok: boolean; png?: string; error?: string }>;
  extractMedia(url: string, options?: { projectPath?: string; title?: string }): Promise<{ ok: boolean; items?: { path: string; kind: "image" | "video" }[]; error?: string }>;
  // Décompose une vidéo locale en frames image (assets disque) pour bâtir une séquence d'images.
  // `in/out` = plage de boucle (s), `fps` = cadence d'échantillonnage, `max` = plafond de frames.
  // `fps` omis ou ≤ 0 = cadence de la source ; la réponse renvoie celle réellement employée.
  extractFrames(opts: { path: string; fps?: number; max?: number; height?: number; in?: number; out?: number; projectPath?: string; title?: string }): Promise<{ ok: boolean; frames?: string[]; fps?: number; error?: string }>;
  // Partage « .netsu » : exporte la scène (items + vue) dans une archive à `destPath` selon `opts`
  // (mode complet / léger / liens, seuil d'embarquement, gel des liens distants). Importe une archive
  // → scène reconstruite (tokens d'assets → chemins locaux ; gros médias non retrouvés = placeholders).
  exportBoard(scene: NetsuScene, destPath: string, opts: NetsuExportOpts): Promise<NetsuExportResult>;
  importBoard(srcPath: string): Promise<NetsuImportResult>;
  // Avancement d'un partage, item par item : un board fourni encode ses clips pendant des minutes.
  onShareProgress(cb: (p: { done: number; total: number; title: string }) => void): () => void;
  // Relocalisation EN LOT : un dossier, et tous les médias manquants qu'on y reconnaît sans
  // ambiguïté (même nom, même taille). Les homonymes de même taille ne sont jamais devinés.
  relocateFrom(dirPath: string, wanted: { id: string; name: string; size?: number }[]): Promise<{ ok: boolean; found: { id: string; path: string }[]; scanned: number; error?: string }>;
  // Poids estimé du board à chaque niveau, sans rien encoder → l'utilisateur voit ce qu'il fabrique
  // avant de lancer l'export.
  weigh(scene: NetsuScene, opts: NetsuExportOpts): Promise<NetsuWeight>;
  // Dialogues fichier dédiés au format .netsu (filtre d'extension) : choisir une archive à importer,
  // choisir une destination d'export. null = annulé / hors application.
  chooseNetsu(): Promise<string | null>;
  saveNetsuPath(defaultName: string): Promise<string | null>;
  // Projet .netsu : le fichier EST le document. `openProject` le tient ouvert côté core et rend la
  // scène ; `saveProject` réécrit CE fichier de façon incrémentale (aucun réencodage) ; `saveProjectAs`
  // le fait déménager. `readonly` = archive v1, lisible mais pas modifiable en place.
  openProject(srcPath: string): Promise<NetsuProjectRead>;
  previewProject(srcPath: string): Promise<NetsuImportResult>;
  saveProject(filePath: string, scene: NetsuScene): Promise<NetsuProjectSave>;
  saveProjectAs(opts: { scene: NetsuScene; destPath: string; fromPath?: string | null; sourceSceneId?: string | null }): Promise<NetsuProjectSave>;
  closeProject(filePath: string): Promise<{ ok: boolean; closed?: boolean }>;
  recentProjects(type?: string): Promise<NetsuRecent[]>;
  forgetProject(filePath: string): Promise<NetsuRecent[]>;
  deleteProject(filePath: string): Promise<{ ok: boolean; projectRemoved?: boolean; mediaRemoved?: boolean; recents: NetsuRecent[]; error?: string }>;
  setDirty(unsaved: boolean): void;
  detach(): void;
  attach(): void;
  setAlwaysOnTop(on: boolean): void;
  push(payload: unknown): void;
  onPush(cb: (payload: unknown) => void): () => void;
}

// ---- Collections (bibliothèque de plans gardés) --------------------------
// Icône de dossier : emoji natif, pictogramme lucide (nom), OU petite image uploadée (chemin disque).
export type CollectionIcon =
  | { kind: "emoji"; ch: string }
  | { kind: "lucide"; name: string }
  | { kind: "image"; path: string };

// Plan rangé : référence LÉGÈRE (chemin + in/out secondes ET frames). Vignette/proxy régénérés à la
// demande par le cache déterministe du derush — rien de dupliqué sur disque.
export interface CollectionShot {
  id?: string;           // généré côté core au rangement ; toujours présent en lecture
  path: string;
  name: string;
  in: number;            // secondes (lecture proxy / vignette)
  out: number;
  inFrame?: number;      // frames source inclusives (re-montage frame-accurate)
  outFrame?: number;
  srcFrames?: number;    // total de frames source (remap d'espace-frames au build)
  fps?: number;
  addedAt?: number;
  // Organisation (édition dans la vue détail) : étiquettes libres, label couleur, note 0-5, annotation.
  tags?: string[];
  label?: string | null; // nom d'une couleur de la palette (voir collectionShared.LABELS) ou null
  rating?: number;       // 0-5 (étoiles)
  note?: string;
}
// Réglages d'archivage (export indépendant de la source → garder pour toujours).
export interface CollectionArchive {
  dir?: string;         // dossier de stockage
  // Format d'enregistrement (choix complet des codecs, comme l'export) : remux (copie) ou ré-encodage.
  workflow?: "video_remux" | "video_encode";
  codec?: string;       // codec de ré-encodage (ExportCodec)
  encoderMode?: string; // moteur d'encodage (ExportEncoderMode : gpu/nvenc/amf/qsv/cpu)
  speed?: string;       // compromis vitesse/compression (ExportSpeed)
  container?: string;   // conteneur (mp4/mkv/mov)
  audioMode?: string;   // codec audio (ExportAudioMode)
  audioSelect?: AudioSelect; // sélection de piste par langue (multi-pistes) ; absent = "auto"
  profileId?: string;   // legacy (ancien : id d'un profil d'export) — ignoré
  autoSync?: boolean;   // ré-exporter à chaque ajout
  upscale?: CollectionArchiveUpscale; // agrandir les plans au passage (impose le ré-encodage)
  lastAt?: number;      // dernier archivage réussi
  // Fichiers écrits, ALIGNÉS sur `shots` (null = plan en échec) → sait quoi déplacer, et où, quand on
  // change de dossier de stockage. Écrit par le core, jamais par le renderer.
  files?: (string | null)[];
  // Vérité par PLAN (identité stable, pas l'index) : fichier produit + empreinte de son contenu.
  // C'est elle qui permet de ne rien refaire quand rien n'a changé. Écrite par le core.
  entries?: Record<string, { file: string; key: string | null; at?: number }>;
}
// Upscale à l'archivage = EXACTEMENT les réglages de modèle de NetsuLab (`UpSettings`), pour que les
// deux écrans se comportent pareil ; seul `when` est propre à l'archivage (tout de suite, ou quand la
// machine ne fait plus d'encodage). Import de TYPE seulement : rien de `upscaleShared` n'atterrit
// dans le bundle du bridge.
export interface CollectionArchiveUpscale extends Partial<import("@/components/upscale/upscaleShared").UpSettings> {
  enabled?: boolean;
  when?: "now" | "idle";
}
// Collection COMPLÈTE (load) : méta d'organisation + shots. `tags` = tags de la collection.
export interface Collection {
  id: string;
  name: string;
  color: string | null;
  icon: CollectionIcon | null;
  description?: string;
  tags?: string[];
  folderId?: string | null;
  archive?: CollectionArchive | null;
  shots: CollectionShot[];
  updatedAt: number;
}

// ---- Découpe de timeline : structure éditable (éditeur de coupes in-app) -------------------
// Un plan de montage = { startFrame, frames } en frames SOURCE du rush (source-contigus dans un CutClip).
// Fusionner deux plans adjacents = un seul { startFrame du 1er, frames cumulés }. Supprimer un plan =
// le retirer de la liste. Le build (buildCutTimeline) régénère le FCPXML depuis la liste éditée.
export interface CutShot {
  startFrame: number;
  frames: number;
}
export interface CutClip {
  src: string;                 // file:// URL (media-rep FCPXML)
  path: string;                // chemin disque (vignettes)
  name: string;
  fps: { num: number; den: number };
  fpsNum?: number;             // fps décimal (affichage)
  totalFrames: number;
  w: number;
  h: number;
  shots: CutShot[];
}

// Console / journal (debug + bêta-test). Une entrée du flux SSE `console:log` (core + sidecars python).
export interface ConsoleLogEntry {
  id: number;
  t: number;                                  // epoch ms
  source: string;                             // frontend | core | python:<name> | system
  level: "log" | "warn" | "error";
  message: string;
  repeat?: number;                            // occurrences consécutives repliées en une entrée
}
// Instantané machine collecté par le core (specs auto d'un rapport de bug). Champs volontairement
// larges : le formulaire les AFFICHE, il ne les saisit pas.
export interface BugContext {
  ok: boolean;
  collectedAt: number;
  app: { version: string; home: string; lang: string | null };
  os: { label: string; platform: string; arch: string; release: string };
  cpu: { name: string; threads: number };
  memory: { totalMB: number; freeMB: number };
  gpu: {
    devices: { name: string; vendor: string; driverVersion: string | null; role: string }[];
    label: string | null;
    vram: { name: string; totalMB: number; freeMB: number } | null;
  };
  runtime: {
    node: string;
    python: string;
    backends: { ml: string; onnx: string; transcribe: string };
    ffmpeg: string | null;
  };
  encoding: { h264: string | null; h265: string | null; av1: string | null; hardware: string[] } | null;
  storage: { home: string; disk: { totalGB: number; freeGB: number } | null };
  setup: { completedAt: number | null; modules: string[]; models: string[]; pythonFound: boolean; ffmpegFound: boolean };
}
// Rapport de bug envoyé au webhook Discord (via le core). Screenshots en base64, logs déjà sérialisés.
// Les libellés (`*Label`) accompagnent les identifiants : le rapport reste lisible dans la langue du
// testeur sans que le core ait à dupliquer la taxinomie du renderer.
export interface BugReportRequest {
  category: string;
  categoryLabel?: string;
  /** Sujet nommé par le testeur quand la catégorie ne le dit pas (« Autre », « Question »). */
  categoryDetail?: string | null;
  severity: string;
  severityLabel?: string;
  frequency: string;
  frequencyLabel?: string;
  module?: string | null;
  moduleLabel?: string | null;
  issueText: string;
  stepsText?: string | null;
  expectedText?: string | null;
  videoReference?: string | null;
  /** Specs tapées à la main quand le service n'a pas pu les lire. */
  manualSpecs?: string | null;
  contact?: { discordId?: string | null; discordName?: string | null; text?: string | null } | null;
  locale?: string | null;
  activeHost?: string | null;
  hostConnected?: boolean;
  /** Pièces jointes : captures, vidéos, fichiers. */
  attachments: { name: string; mimeType: string; sizeBytes: number; dataBase64: string }[];
  consoleLogs: string;
  consoleLogCount: number;
  errorCount?: number;
  warnCount?: number;
  redactionApplied: boolean;
  /** Relais Convex (site + session) quand l'app n'a pas de webhook direct. Le core valide le site. */
  relay?: { site: string; cookie: string } | null;
}
export interface BugReportResponse { ok: boolean; message: string; reportId?: string }

export interface NrApi {
  // Langue de l'UI : lecture/écriture durable dans nr.config.json (le renderer applique via localStorage).
  configGet(): Promise<{ lang: string | null }>;
  configSetLang(lang: string): Promise<{ ok: boolean; error?: string }>;
  // Provisionnement sélectif (socle + packs des pages + modèles choisis) — app packagée.
  setupStatus(): Promise<SetupStatus>;
  setupRun(options: SetupRunOptions): Promise<SetupRunResult>;
  compatibilityStatus(opts?: { force?: boolean }): Promise<CompatibilityStatus>;
  onSetupProgress(cb: (p: SetupProgress) => void): () => void;
  // Console / journal (Paramètres › Console) : historique des logs core+python, vidage, flux temps réel.
  consoleLogs(): Promise<{ ok: boolean; logs: ConsoleLogEntry[] }>;
  consoleClear(): Promise<{ ok: boolean }>;
  onConsoleLog(cb: (e: ConsoleLogEntry) => void): () => void;
  // Rapport de bug → webhook Discord (configuré hors dépôt). `configured` = webhook présent côté core.
  bugReport(request: BugReportRequest): Promise<BugReportResponse>;
  // État du canal d'envoi + plafonds de pièces jointes, lus AVANT que le testeur rédige.
  bugStatus(): Promise<{ ok: boolean; configured: boolean; maxAttachments?: number; maxAttachmentMB?: number }>;
  // Specs de la machine, lues par le core (jamais saisies par le testeur).
  bugContext(): Promise<BugContext | { ok: false }>;
  status(): Promise<ResolveInfo>;
  importToMediaPool(paths: string[]): Promise<{ ok: boolean; count?: number; error?: string }>;
  // Poll immédiat côté core (déclenché au focus fenêtre).
  refreshNow(): void;
  playInfo(filePath: string): Promise<PlayInfo>;
  streamUrl(filePath: string, t: number, mode: "copy" | "enc"): string;
  audioTracks(filePath: string): Promise<{ tracks: AudioTrack[]; error?: string }>;
  detectScenes(filePath: string, threshold?: number, model?: DetectModel, options?: DetectOptions): Promise<SceneResult>;
  cachedScenes(filePath: string, model?: DetectModel, threshold?: number, options?: DetectOptions): Promise<SceneResult>;
  proxy(opts: { input: string; start: number; end: number; priority?: "high" | "low"; height?: number; token?: number; codec?: "h264" | "hevc"; requireVideo?: boolean; requireAudio?: boolean; settings?: PreviewGenerationSettings["proxy"] }): Promise<{ ok: boolean; path?: string; error?: string; cancelled?: boolean }>;
  proxyCancel(token: number): void;
  // Renvoie le CHEMIN du jpeg en cache (à passer à mediaUrl() pour l'affichage), pas un data URI.
  // `priority` : "high" (défaut) pour une carte à l'écran, "low" pour une carte encore hors champ —
  // le core réserve ses derniers ouvriers aux demandes "high", donc une bande d'anticipation large
  // ne doit surtout pas y entrer en concurrence.
  thumbnail(filePath: string, time?: number, priority?: "high" | "low"): Promise<string | { error: string }>;
  thumbsBatch(filePath: string, items: { time: number; frame: number }[]): Promise<{ ok: boolean; made?: number; error?: string }>;
  // Résout en UN appel les chemins des vignettes DÉJÀ en cache (sans rien générer) → le renderer
  // amorce son cache d'un coup et n'émet plus 1 RPC par carte (scroll fluide même cache plein).
  thumbsResolve(items: { path: string; time: number }[]): Promise<{ path: string; time: number; file: string | null }[]>;
  // Codecs réellement encodables sur cette machine (sonde ffmpeg cachée côté core) → l'UI masque le
  // reste. `force` relance la sonde en ignorant le cache.
  exportCapabilities(opts?: { force?: boolean }): Promise<ExportCapabilitiesResult>;
  // Pont Adobe : statut apps/panneau, snapshot projet lu par le panneau CEP, lancement, scan à distance.
  adobeStatus(): Promise<AdobeBridgeStatus>;
  adobeSnapshot(app: AdobeApp): Promise<AdobeSnapshot | null>;
  adobeLaunch(app: AdobeApp): Promise<{ ok: boolean; already?: boolean; error?: string }>;
  adobeScan(app: AdobeApp): Promise<{ ok: boolean }>;
  adobeImport(app: AdobeApp, paths: string[]): Promise<{ ok: boolean; count?: number; error?: string }>;
  adobeInstallPanel(): Promise<{ ok: boolean; dir?: string; debugSet?: string[]; restart?: AdobeApp[]; version?: string | null; error?: string }>;
  adobeSetPanelAutoUpdate(on: boolean): Promise<{ ok: boolean; autoUpdate?: boolean; error?: string }>;
  upscaleRun(opts: UpscaleOpts): Promise<UpscaleResult>;
  upscaleShaderRun(opts: UpscaleShaderOpts): Promise<UpscaleResult>;
  upscaleTestFrame(opts: UpscaleFrameOpts): Promise<UpscaleFrameResult>;
  onUpscaleProgress(cb: (p: UpscaleProgress) => void): () => void;
  // Gestionnaire de modèles app-wide : liste + statut, téléchargement à la demande, suppression, disque.
  modelsList(): Promise<ModelListResult>;
  onModelsProgress(cb: (p: ModelProgress) => void): () => void;
  chooseDir(): Promise<string | null>;
  chooseFiles(): Promise<string[] | null>;
  chooseImages(): Promise<string[] | null>;
  chooseAnyFile(): Promise<string | null>;
  // Chemins disque d'objets File lâchés depuis l'Explorateur (Chromium masque `File.path`). Index
  // aligné sur `files` ; chaîne vide quand le chemin est irrésoluble (navigateur, WebView2 ancien).
  pathsForFiles(files: File[]): Promise<string[]>;
  saveFile(defaultName?: string): Promise<string | null>;
  mediaUrl(filePath: string): string;
  // URL d'un fichier local pour les GRILLES d'aperçus (vignettes + proxys de lecture).
  //
  // `mediaUrl` sort du serveur HTTP du core, qui porte AUSSI /rpc et le flux SSE. Chromium n'ouvre
  // que 6 connexions HTTP/1.1 par origine : une prise par /events, quelques-unes par les RPC en vol,
  // et il reste ~4 créneaux pour des dizaines de <video>. C'est ce qui laisse la moitié d'une grille
  // figée sur sa vignette même quand TOUS les proxys sont déjà encodés — le fichier existe, il
  // attend juste un créneau de connexion.
  //
  // Sous Tauri on passe donc par le protocole ASSET (`convertFileSrc`) : la requête est interceptée
  // dans le processus par la coquille Rust, sans socket ni pool de connexions. Hors Tauri (panneau
  // CEP, navigateur) il n'existe pas → repli sur `mediaUrl`.
  assetUrl(filePath: string): string;
  // Flux d'une vidéo YouTube relayé par le core (yt-dlp résout, le core relaie) : source d'un
  // `<video>` ordinaire, donc AUCUN habillage YouTube — cf. core/ytstream.js.
  ytStreamUrl(videoId: string): string;
  openExternal(url: string): Promise<boolean>;
  openPath(path: string): Promise<boolean>;
  revealPath(path: string): Promise<boolean>;
  // Épingle la fenêtre principale au-dessus des autres (always-on-top), pour la garder visible
  // dans un coin de l'écran tout en travaillant dans Resolve. No-op hors Tauri.
  setAlwaysOnTop(on: boolean): void;
  // Redimensionne la fenêtre principale (taille logique). Sert à passer en petit format « coin »
  // quand on épingle, et à réagrandir au dépinglage (le responsif est inconfortable en très étroit).
  setWindowSize(w: number, h: number): void;
  reference?: RefApi;
  power?: PowerApi;
}

// --- Cache médias (Paramètres › Stockage) ------------------------------------------------------
/** Types de cache gérables. Miroir de CACHE_KINDS (core/config.js) — source unique côté core.
 *  L'ordre est celui d'AFFICHAGE, groupé par famille : les deux caches de vignettes se suivent,
 *  qu'ils vivent en fichiers ou en base — c'est le même contenu, le lieu de stockage n'intéresse
 *  personne. Le core rend ses types dans l'ordre de ses racines, donc l'UI retrie sur cette liste. */
export const CACHE_KIND_LIST = ["thumb", "indexThumbs", "proxy", "voice", "upscaleTest", "roto", "scenes", "transcripts", "embeddings", "faces"] as const;

// ---- Fermer / rouvrir le logiciel de montage (libérer RAM/GPU pendant une tâche lourde) --------
export type PowerHost = "resolve" | "ppro" | "aeft";
export interface PowerClosed { host: PowerHost; project: string | null; projectPath?: string | null; page?: string | null; folder?: string[]; database?: Record<string, unknown> | null; at: number; }
export interface PowerState { closed: PowerClosed | null; busy: boolean; }
export interface PowerProgress { msg: string; pct: number | null; }
export interface PowerApi {
  state(): Promise<PowerState>;
  // Efface un état « fermé » périmé si le logiciel est en réalité détecté ouvert (réouverture externe).
  reconcile(): Promise<PowerState>;
  close(host: PowerHost): Promise<{ ok: boolean; project?: string | null; already?: boolean; error?: string }>;
  reopen(): Promise<{ ok: boolean; host?: PowerHost; project?: string | null; error?: string }>;
  // Fermer + rouvrir d'un geste, sur le même projet et la même page.
  restart(host: PowerHost): Promise<{ ok: boolean; host?: PowerHost; project?: string | null; error?: string }>;
  onChanged(cb: (s: PowerState) => void): () => void;
  onProgress(cb: (p: PowerProgress) => void): () => void;
}

declare global {
  interface Window {
    nr?: NrApi;
  }
}
function readMockStorage(key: string, legacyKey: string): string | null {
  if (typeof localStorage === "undefined") return null;
  const current = localStorage.getItem(key);
  if (current !== null) return current;
  const legacy = localStorage.getItem(legacyKey);
  if (legacy !== null) localStorage.setItem(key, legacy);
  return legacy;
}

const mock: NrApi = {
  // Console / bug-report : inertes hors application (l'UI rend, aucun flux backend).
  consoleLogs: async () => ({ ok: true, logs: [] }),
  consoleClear: async () => ({ ok: true }),
  onConsoleLog: () => () => {},
  bugReport: async () => ({ ok: false, message: i18n.t("common:mock.outsideApp") }),
  bugStatus: async () => ({ ok: true, configured: false, maxAttachments: 8, maxAttachmentMB: 10 }),
  bugContext: async () => ({ ok: false as const }),
  // Langue : hors app, la persistance durable vit dans localStorage (le renderer y écrit déjà).
  configGet: async () => ({ lang: typeof localStorage !== "undefined" ? localStorage.getItem("nr-lang") : null }),
  configSetLang: async (lang) => {
    if (typeof localStorage !== "undefined") localStorage.setItem("nr-lang", lang);
    return { ok: true };
  },
  // Mock navigateur : tout est « prêt » → l'UI ne montre jamais l'écran d'installation hors app.
  setupStatus: async () => ({ ready: true, venv: true, ffmpeg: true, weights: true, home: "", items: [] }),
  setupRun: async () => ({ ok: true }),
  compatibilityStatus: async () => ({
    ok: true,
    hardware: { gpus: [], cpus: [], vendors: [], primaryVendor: "cpu", initialMlBackend: "cpu", initialOnnxBackend: "cpu", windowsBuild: 0, label: "CPU" },
    configured: { torch: "cpu", onnx: "cpu", transcribe: "cpu" },
    runtime: { torch: null, onnx: null, errors: [] },
    encoding: { h264: "h264_nvenc", h265: "hevc_nvenc", av1: null, webp: true, hardwareEncoders: ["h264_nvenc", "hevc_nvenc"], codecEncoders: { h264_main: "h264_nvenc", h264_high: "h264_nvenc", h265_main: "hevc_nvenc", h265_main10: "hevc_nvenc" }, codecEncoderOptions: { h264_main: ["h264_nvenc"], h265_main: ["hevc_nvenc"] }, upscaleProfileEncoderOptions: { h264_baseline: ["h264_nvenc"], h264_main: ["h264_nvenc"], h264_high: ["h264_nvenc"], h265_main: ["hevc_nvenc"], h265_main10: ["hevc_nvenc"], h265_rext444_8: ["hevc_nvenc"], h265_rext444_10: ["hevc_nvenc"] }, codecs: [], error: null },
  }),
  onSetupProgress: () => () => {},
  status: async () => ({ connected: false, error: i18n.t("common:mock.resolveUnavailable") }),
  importToMediaPool: async () => ({ ok: false, error: "mock" }),
  refreshNow: () => {},
  playInfo: async () => ({ duration: 0, codec: "", pix: "", fps: 0, native: false }),
  streamUrl: (p, t, mode) => "nrstream://play?p=" + encodeURIComponent(p) + "&t=" + (t || 0) + "&mode=" + mode,
  audioTracks: async () => ({ tracks: [] }),
  detectScenes: async () => ({ scenes: [], duration: 0 }),
  cachedScenes: async () => ({ scenes: [], cached: false }),
  proxy: async () => ({ ok: false, error: "mock" }),
  proxyCancel: () => {},
  thumbnail: async () => ({ error: "mock" }),
  thumbsBatch: async () => ({ ok: true, made: 0 }),
  thumbsResolve: async (items) => items.map((i) => ({ path: i.path, time: i.time, file: null })),
  // Hors app : aucune sonde possible → ok:false, donc le renderer ne masque AUCUN codec (l'UI se rend
  // entière dans un navigateur au lieu d'un menu de codecs vide).
  exportCapabilities: async () => ({ ok: false, codecs: [], cpuCodecs: [], hasGpuEncoder: false, hwEncoders: [], codecEncoderOptions: {}, error: "mock" }),
  adobeStatus: async () => ({
    ok: false,
    ppro: { installed: false, exe: null, running: false, panelConnected: false, lastSnapshotAt: null },
    aeft: { installed: false, exe: null, running: false, panelConnected: false, lastSnapshotAt: null },
    panelInstalled: false,
  }),
  adobeSnapshot: async () => null,
  adobeLaunch: async () => ({ ok: false, error: i18n.t("common:mock.appUnavailable") }),
  adobeScan: async () => ({ ok: false }),
  adobeImport: async () => ({ ok: false, error: i18n.t("common:mock.appUnavailable") }),
  adobeInstallPanel: async () => ({ ok: false, error: i18n.t("common:mock.appUnavailable") }),
  adobeSetPanelAutoUpdate: async () => ({ ok: false, error: i18n.t("common:mock.appUnavailable") }),
  upscaleRun: async () => ({ ok: false, error: i18n.t("common:mock.resolveUnavailable") }),
  upscaleShaderRun: async () => ({ ok: false, error: i18n.t("common:mock.resolveUnavailable") }),
  upscaleTestFrame: async () => ({ ok: false, error: i18n.t("common:mock.resolveUnavailable") }),
  onUpscaleProgress: () => () => {},
  modelsList: async () => ({ ok: true, models: [] }),
  onModelsProgress: () => () => {},
  chooseDir: async () => null,
  chooseFiles: async () => null,
  chooseImages: async () => null,
  chooseAnyFile: async () => null,
  pathsForFiles: async (files) => files.map(() => ""),
  saveFile: async () => null,
  mediaUrl: (p) => "nrmedia://media?p=" + encodeURIComponent(p),
  assetUrl: (p) => "nrmedia://media?p=" + encodeURIComponent(p),
  ytStreamUrl: (id) => "nrmedia://ytstream?id=" + encodeURIComponent(id),
  openExternal: async (url) => { try { window.open(url, "_blank", "noopener"); } catch { /* noop */ } return true; },
  openPath: async () => false,
  revealPath: async () => false,
  setAlwaysOnTop: () => {},
  setWindowSize: () => {},
  // Mock navigateur : persistance en mémoire (localStorage) pour tester l'UI hors Resolve.
  reference: (() => {
    const KEY = "nr-ref-scenes:v1";
    const read = (): Record<string, RefSceneOut> => {
      try { return JSON.parse(readMockStorage(KEY, "nr-ref-scenes") || "{}"); } catch { return {}; }
    };
    const write = (o: Record<string, RefSceneOut>) => localStorage.setItem(KEY, JSON.stringify(o));
    return {
      listScenes: async () =>
        Object.values(read()).map((s) => ({ id: s.id, name: s.name, updatedAt: s.updatedAt }))
          .sort((a, b) => b.updatedAt - a.updatedAt),
      storagePath: async () => "",
      loadScene: async (id: string) => read()[id] ?? null,
      saveScene: async (scene: RefSceneIn) => {
        const o = read();
        const id = scene.id || Math.random().toString(36).slice(2, 10);
        const updatedAt = Date.now();
        o[id] = { id, name: scene.name, items: scene.items, view: scene.view ?? null, updatedAt };
        write(o);
        return { ok: true, id, updatedAt };
      },
      deleteScene: async (id: string) => { const o = read(); delete o[id]; write(o); return { ok: true }; },
      saveAsset: async () => ({ ok: false, error: "mock" }),
      fetchAsset: async () => ({ ok: false, error: "mock" }),
      resolveMedia: async (_url, _options) => ({ ok: false, error: "mock" }),
      upscaleItem: async () => ({ ok: false, error: "mock" }),
      dropAsset: async () => ({ ok: true, removed: false }),
      sweepAssets: async () => ({ ok: true, removed: 0, bytes: 0, kept: 0 }),
      scanFolder: async (dir: string) => ({ ok: false, root: dir, name: "", files: [], truncated: false, count: 0 }),
      writeFile: async () => ({ ok: false, error: i18n.t("common:mock.appUnavailable") }),
      sampleFrame: async () => ({ ok: false, error: i18n.t("common:mock.appUnavailable") }),
      extractMedia: async () => ({ ok: false, error: "mock" }),
      extractFrames: async () => ({ ok: false, error: "mock" }),
      exportBoard: async () => ({ ok: false, error: i18n.t("common:mock.appUnavailable") }),
      importBoard: async () => ({ ok: false, error: i18n.t("common:mock.appUnavailable") }),
      onShareProgress: () => () => {},
      relocateFrom: async () => ({ ok: false, found: [], scanned: 0, error: i18n.t("common:mock.appUnavailable") }),
      // Forme COMPLÈTE mais vide : le dialogue d'export rend ses quatre niveaux à 0 o au lieu de
      // tomber sur des `undefined` dans le navigateur.
      weigh: async () => ({ ok: true, level: "preview" as const, total: 0, perLevel: { link: 0, preview: 0, margin: 0, full: 0 }, items: [] }),
      chooseNetsu: async () => null,
      saveNetsuPath: async () => null,
      // Un projet est un FICHIER : dans le navigateur il n'y en a pas. On répond « indisponible »
      // plutôt que de simuler un enregistrement qui ne laisserait rien sur le disque.
      openProject: async () => ({ ok: false, error: i18n.t("common:mock.appUnavailable") }),
      previewProject: async () => ({ ok: false, error: i18n.t("common:mock.appUnavailable") }),
      saveProject: async () => ({ ok: false, error: i18n.t("common:mock.appUnavailable") }),
      saveProjectAs: async () => ({ ok: false, error: i18n.t("common:mock.appUnavailable") }),
      closeProject: async () => ({ ok: true, closed: false }),
      recentProjects: async () => [],
      forgetProject: async () => [],
      deleteProject: async () => ({ ok: false, recents: [], error: i18n.t("common:mock.appUnavailable") }),
      setDirty: () => {},
      detach: () => {},
      attach: () => {},
      setAlwaysOnTop: () => {},
      push: () => {},
      onPush: () => () => {},
    } satisfies RefApi;
  })(),
  // Mock navigateur : rien à fermer/rouvrir hors app.
  power: {
    state: async () => ({ closed: null, busy: false }),
    reconcile: async () => ({ closed: null, busy: false }),
    close: async () => ({ ok: false, error: i18n.t("common:mock.appUnavailable") }),
    reopen: async () => ({ ok: false, error: i18n.t("common:mock.appUnavailable") }),
    restart: async () => ({ ok: false, error: i18n.t("common:mock.appUnavailable") }),
    onChanged: () => () => {},
    onProgress: () => () => {},
  } satisfies PowerApi,
};

// coreClient (Tauri) et mock (navigateur) exposent tous deux `reference` → sélection directe.
export const nr: NrApi =
  typeof window !== "undefined" && window.nr
    ? window.nr
    : coreAvailable
      ? makeCoreClient()
      : mock;

// Token monotone par demande de proxy : identifie un job pour pouvoir l'annuler (carte hors écran).
let _proxyTok = 1;
export const nextProxyToken = (): number => _proxyTok++;

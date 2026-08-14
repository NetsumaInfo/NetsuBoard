// @ts-check
// core/rpc.js
// Câblage des canaux métier en HTTP (ex-ipcMain.handle). Expose :
//   POST /rpc   { channel, args:[...] } -> { ok, result } | { ok:false, error }
//   GET  /events  (SSE)                 -> push { channel, payload } (barres de progression)
// Les modules métier sont des modules core/ (electron-free). L'argument Electron `e`
// (utilisé pour e.sender.send des progressions) est remplacé par un shim qui diffuse en SSE.
//
// Les canaux resolve:* exigent le pont Python externe actif (Resolve + scripting externe = Local).
// Ils se limitent au statut du pont et à l'import Media Pool : NetsuBoard ne monte aucune timeline.

const path = require("path");
const { CONFIG, DATA_DIR, saveConfig } = require("./config");
const { t } = require("./i18n");
const ffmpeg = require("./ffmpeg");
const thumbs = require("./thumbs");
const proxy = require("./proxy");
const resolveMod = require("./resolve"); // pont Python externe à resolve-proxy
const { beginResolveOp, endResolveOp, bridge } = require("./resolve-proxy"); // bracket d'op (reset sûr du registre) + pont brut (arrêt/reconnexion)
const timeline = require("./timeline"); // frame-math identique, Resolve via le pont
const sidecars = require("./sidecars");
const turbo = require("./turbo"); // panier temps réel : shader GLSL libplacebo, RTX VSR ou ArtCNN R ONNX
const shaderUpscale = require("./shaderUpscale"); // moteur d'upscale unique de NetsuBoard (GPU, sans IA)
const models = require("./models"); // gestionnaire de modèles app-wide (download à la demande / delete / statut)
const exportMod = require("./export"); // export fichier piloté par profil (remux/encode, GPU/CPU, merge)
const audioLang = require("./audioLang"); // normalisation des étiquettes de langue des pistes audio
const { createReferenceStore, scanFolder, writeExportFile } = require("./reference");
const { createUpscaleLedger } = require("./upscaleLedger"); // registre des sorties d'upscale (anti double production)
const netsu = require("./netsu"); // format de partage « .netsu » (board → conteneur SQLite type-routé)
const extract = require("./extract"); // yt-dlp / gallery-dl : extraction du vrai média d'un lien
const netsuSidecar = require("./netsu/sidecar");
const { createAdobeBridge } = require("./adobe"); // pont Adobe : panneau CEP Premiere/AE ↔ core
const { createResolveWatch } = require("./resolve-watch");
const { createHostPower } = require("./hostPower"); // fermer/rouvrir le logiciel de montage (libérer RAM/GPU)
const { createProjectSnapshot } = require("./projectSnapshot"); // photo des lectures Resolve servie offline (hôte fermé)
const setup = require("./setup"); // provisionnement 1er lancement (venv/ffmpeg/poids)
const compatibility = require('./compatibility'); // matériel + runtimes IA/encodage réellement actifs
const { cacheIndex } = require("./cacheIndex"); // index latéral fichier de cache → rush source
const { createCacheAdmin } = require("./cacheAdmin"); // Paramètres › Stockage : mesure + purge ciblée
const { createCachePolicy } = require("./cachePolicy"); // auto-purge par type (quota LRU + âge)
const logbus = require("./logbus"); // journal centralisé (core + sidecars python) → SSE `console:log`
const bugreport = require("./bugreport"); // envoi d'un rapport de bug → webhook Discord (Console)
const bugContext = require("./bugContext"); // instantané machine joint au rapport (specs auto)

const JSONH = { "Content-Type": "application/json" };

function createRpc() {
  const clients = new Set(); // flux SSE ouverts

  const broadcast = (channel, payload) => {
    const line = `data: ${JSON.stringify({ channel, payload })}\n\n`;
    for (const res of clients) {
      try {
        res.write(line);
      } catch {}
    }
  };
  // Shim de l'event Electron : les modules appellent e.sender.send(channel, payload).
  const ev = { sender: { send: (ch, p) => broadcast(ch, p) } };
  // Branche le journal sur la diffusion SSE et capte les console.* du core (démarrage, erreurs RPC).
  logbus.attach(broadcast);

  const refStore = createReferenceStore(DATA_DIR);
  const adobeBridge = createAdobeBridge({ CONFIG, broadcast });
  // Le panneau CEP est une COPIE dans %APPDATA% : une mise à jour de NetsuRush ne la touche pas.
  // On la resynchronise au démarrage (différé, jamais bloquant) quand elle est en retard.
  setTimeout(() => { adobeBridge.syncPanel().catch(() => {}); }, 1500);

  // Paramètres › Stockage. L'index est un singleton (thumbs/proxy/ffmpeg y écrivent sans injection) ;
  // on réutilise la même instance ici pour que lectures et écritures partagent le tampon.
  const cacheIdx = cacheIndex();
  cacheIdx.pruneMissing(); // le boot vient de vider le cache de session : retire ses lignes fantômes
  const cacheAdmin = createCacheAdmin({ cacheIndex: cacheIdx, broadcast });
  const cachePolicy = createCachePolicy({ cacheIndex: cacheIdx, admin: cacheAdmin, broadcast });
  cachePolicy.boot();   // auto-purge + contrôle des seuils, différés et non bloquants
  let lastTestFrameKey = null;

  /** Applique un déclencheur de cache de session. Le renderer signale uniquement un événement
   * métier (« page quittée ») ; la décision reste dans la config du core, donc elle fonctionne aussi
   * avec un renderer rechargé ou une fenêtre distante. */
  async function sessionCleanup(trigger, kinds) {
    const selected = (Array.isArray(kinds) ? kinds : [])
      .filter((kind) => cachePolicy.shouldClearSession(kind, trigger));
    if (!selected.length) return { ok: true, freed: 0, files: 0, skipped: true };
    if (selected.includes('upscaleTest')) lastTestFrameKey = null;
    return cacheAdmin.clear({ kinds: selected });
  }

  async function prepareTestFrame(opts) {
    // Comparer plusieurs modèles sur la MÊME source/config est un cas central de NetsuLab : le modèle
    // ne fait donc PAS partie de la clé. On purge seulement quand la source, le temps ou un réglage
    // partagé change, puis on conserve les variantes A/B jusqu'à cette frontière.
    const { model: _model, ...shared } = opts || {};
    void _model;
    const key = JSON.stringify(shared);
    if (lastTestFrameKey && lastTestFrameKey !== key) {
      await sessionCleanup('operation', ['upscaleTest']);
    }
    lastTestFrameKey = key;
  }


  // « Snapshot projet » : photo des lectures Resolve prise à la fermeture, servie offline pour que
  // rushes/timelines restent visibles pendant que l'hôte est fermé (effacée à la réouverture).
  const projectSnapshot = createProjectSnapshot({ dataDir: DATA_DIR, broadcast });
  // Lectures passées à snapshot.capture() : rOp-wrappées (protège le registre de handles). rOp est
  // défini plus bas mais ces closures ne sont invoquées qu'à la fermeture → référence résolue au call.
  const captureReaders = {
    // Une seule lecture complète : projectSnapshot conserve la liste entière pour NetsuDraft et en
    // dérive sa tranche vidéo historique pour NetsuCut/les autres consommateurs hors ligne.
    listMediaPool: () => rOp(() => resolveMod.listMediaPool({ includeAudio: true }))(),
    listTimelines: () => rOp(() => timeline.listTimelines())(),
    timelineTree: () => rOp(() => timeline.timelineTree())(),
    timelineThumbs: () => rOp(() => timeline.timelineThumbs(null, {}))(),
    readTimelineCutsByName: (name) => rOp(() => timeline.readTimelineCuts({ timelineName: name }))(), // plans d'une timeline
  };

  // Fermer / rouvrir le logiciel de montage pour libérer RAM/GPU pendant une tâche lourde, puis
  // reprendre le projet. La réouverture réamorce le flush du « cache projet » (envois différés).
  const hostPower = createHostPower({
    CONFIG, resolveMod, bridge, adobeBridge, broadcast, dataDir: DATA_DIR,
    projectSnapshot, captureReaders,
  });



  // Poller de synchro Resolve→renderer (diff de signature légère → SSE `resolve:changed`).
  // onReconnect : Resolve vient de rouvrir → flush de la file « cache projet » + efface l'état « fermé »
  // de l'énergie hôte (si Resolve a été relancé à la main, l'offre « Rouvrir » ne doit plus traîner).
  const watch = createResolveWatch({
    broadcast,
    getSignature: () => resolveMod.resolveSignature(),
    onReconnect: () => hostPower.markOnline('resolve'),
  });
  watch.start();
  // Suspend le poll pendant une op lourde (occupe le pont Python) puis le reprend. Bracket aussi
  // l'opération (beginResolveOp/endResolveOp) → getResolve ne purge le registre de handles QUE si elle
  // est seule en vol (sinon « handle invalide » quand 2 ops Resolve se chevauchent).
  const guarded = (fn) => async (...a) => {
    watch.pause();
    beginResolveOp();
    try {
      return await fn(...a);
    } finally {
      endResolveOp();
      watch.resume();
    }
  };
  // Bracket SEUL (sans pause du poll) pour les ops Resolve légères/fréquentes (statut, listes).
  const rOp = (fn) => async (...a) => {
    beginResolveOp();
    try {
      return await fn(...a);
    } finally {
      endResolveOp();
    }
  };


  // Pistes sondées + `langCode` normalisé (tag ou titre libre → code langue, cf. audioLang).
  // La table des variantes reste la SEULE de core/audioLang.js : le renderer lit ce code pour dire à
  // quelle piste se résout une règle par langue, sans réimplémenter la normalisation.
  async function probeAudioTracksTagged(p) {
    const r = await ffmpeg.probeAudioTracks(p);
    const tracks = (r.tracks || []).map((t) => ({ ...t, langCode: audioLang.trackLangCode(t) }));
    return { ...r, tracks };
  }


  // Registre des sorties d'upscale : même source, mêmes bornes, mêmes réglages ⇒ le fichier existe
  // déjà et l'upscale d'un item du board ne repaie pas des minutes de GPU.
  const upLedger = createUpscaleLedger();

  // Table de dispatch : channel -> (args[], ev) => result|Promise. Calque exact de registerIpc().
  const H = {
    // --- Resolve : statut du pont et import Media Pool (pont Python externe requis) ---
    "resolve:status": rOp(() => resolveMod.resolveStatus()),
    "resolve:import": guarded(([paths]) => resolveMod.importToMediaPool(paths)),
    // Poll immédiat (déclenché par le renderer au focus fenêtre).
    "resolve:refreshNow": () => { void watch.refreshNow(); return { ok: true }; },

    // --- Langue de l'UI : copie durable dans nr.config.json (lue au prochain boot). Le renderer
    // applique le changement immédiatement via localStorage ; ici c'est la persistance de fond. ---
    "config:get": () => ({ lang: CONFIG.lang || null }),
    "config:setLang": ([lang]) => {
      const code = String(lang || "fr").toLowerCase().split(/[-_]/)[0];
      return saveConfig({ lang: ["fr", "en", "es", "de", "ja", "zh"].includes(code) ? code : "fr" });
    },

    // --- Fermer/rouvrir le logiciel de montage (libérer RAM/GPU pendant une tâche lourde) ---
    "power:state": () => hostPower.state(),
    "power:reconcile": rOp(() => hostPower.reconcile()),
    "power:close": guarded(([host]) => hostPower.close(host || "resolve")),
    "power:reopen": guarded(async () => {
      const r = await hostPower.reopen();
      return r;
    }),
    "power:restart": guarded(async ([host]) => {
      const r = await hostPower.restart(host || "resolve");
      return r;
    }),

    // --- Provisionnement 1er lancement (app packagée) : venv torch CUDA + ffmpeg + poids ---
    "setup:status": () => setup.setupStatus(),
    "setup:run": ([options]) => {
      sidecars.killSidecars();
      return setup.runSetup(ev, options || {});
    },
    "compat:status": ([opts]) => compatibility.status(opts || {}),

    // --- Console / journal (debug + bêta-test) : historique des logs, vidage, rapport de bug ---
    // Le flux temps réel arrive en SSE `console:log` (core + sidecars python).
    "console:logs": () => logbus.snapshot(),
    "console:clear": () => { logbus.clear(); return { ok: true }; },
    "bug:report": ([request]) => bugreport.submitBugReport(request),
    // Le formulaire a besoin de savoir s'il peut envoyer AVANT que le testeur écrive : sans ça, un
    // rapport se rédige entièrement pour finir sur « aucun webhook ». Porte aussi les plafonds de
    // pièces jointes, qui dépendent du boost du serveur Discord.
    "bug:status": () => bugreport.status(),
    // Specs de la machine du testeur : affichées dans le formulaire, recollectées à l'envoi.
    "bug:context": () => bugContext.collectBugContext(),
    "player:info": ([p]) => ffmpeg.playInfo(p),
    "ffmpeg:audioTracks": ([p]) => probeAudioTracksTagged(p),
    "ffmpeg:detectScenes": ([p, threshold, model, options]) => sidecars.detectScenes(ev, p, threshold, model, options),
    "ffmpeg:cachedScenes": ([p, model, threshold, options]) => sidecars.getCachedScenes(p, model, threshold, options),
    "ffmpeg:proxy": ([opts]) => proxy.proxySegment(opts),
    "ffmpeg:proxyCancel": ([token]) => {
      proxy.proxyCancel(token);
      return null;
    },
    "ffmpeg:thumbnail": ([request, legacyTime]) => {
      const o = request && typeof request === "object" ? request : { path: request, time: legacyTime };
      // Une carte encore hors champ demande "low" : la file de vignettes garde alors deux ouvriers
      // pour les cartes réellement visibles (cf. THUMB_LOW_MAX). Défaut "high" — un appelant qui ne
      // dit rien est un affichage immédiat.
      const priority = o.priority === "low" ? "low" : "high";
      return thumbs.thumbnail(o.path, o.time, priority, o.settings).catch((err) => ({ error: String(err) }));
    },
    "ffmpeg:thumbsBatch": ([request, legacyItems]) => {
      const o = request && typeof request === "object" && !Array.isArray(request) ? request : { path: request, items: legacyItems };
      return thumbs.thumbsBatch(o.path, o.items, o.settings).catch((err) => ({ ok: false, error: String(err) }));
    },
    "ffmpeg:thumbsResolve": ([request]) => {
      const o = Array.isArray(request) ? { items: request } : request || { items: [] };
      return thumbs.thumbsResolve(o.items, o.settings).catch(() => []);
    },
    // Codecs RÉELLEMENT encodables ici (vraie sonde ffmpeg, cachée) → l'UI n'affiche pas le reste.
    "export:capabilities": ([opts]) => exportMod.exportCapabilities(opts || {}),

    // --- Upscale : shaders GPU (libplacebo) ---
    "upscale:run": ([opts]) => sidecars.runUpscale(ev, opts),
    "upscale:shaderRun": ([opts]) => turbo.runTurbo(sidecars, ev, opts),
    // Le test image suit le MÊME aiguillage que l'encodage (IA / shader GLSL / poids ONNX) — sinon
    // l'aperçu montrerait le rendu d'un autre moteur que celui qui produira le fichier.
    "upscale:testFrame": async ([opts]) => {
      await prepareTestFrame(opts);
      return turbo.runTurboFrame(sidecars, opts);
    },

  // --- Gestionnaire de modèles app-wide (download à la demande / delete / statut / disque) ---
  "models:list": () => models.listModels(),

    // --- Pont Adobe (panneau CEP Premiere/AE ↔ core) ---
    "adobe:status": () => adobeBridge.status(),
    "adobe:snapshot": ([app]) => adobeBridge.snapshot(app),
    "adobe:launch": ([app]) => adobeBridge.launch(app),
    "adobe:cmd": ([app, payload]) => adobeBridge.cmd(ev, app, payload),
    "adobe:installPanel": () => adobeBridge.installPanel(),
    "adobe:setPanelAutoUpdate": ([on]) => adobeBridge.setPanelAutoUpdate(on),
    "adobe:import": ([opts]) => adobeBridge.importMedia(ev, opts || {}),

    // --- Board de référence (saveAsset binaire : transport base64 à finaliser en P4) ---
    "reference:listScenes": () => refStore.listScenes(),
    "reference:storagePath": () => refStore.storagePath(),
    "reference:loadScene": ([id]) => refStore.loadScene(id),
    "reference:saveScene": ([scene]) => refStore.saveScene(scene),
    "reference:deleteScene": ([id]) => refStore.deleteScene(id),
    // bytes arrive en base64 (transport JSON) → Buffer pour refStore.
    "reference:saveAsset": ([bytes, ext]) => {
      const buf = bytes && bytes.__b64 ? Buffer.from(bytes.__b64, "base64") : bytes;
      return refStore.saveAsset(buf, ext);
    },
    // Télécharge un média distant côté core (sans CORS) puis le persiste en asset disque.
    "reference:fetchAsset": ([url, options]) => refStore.fetchAsset(url, options || {}),
    // Résout le vrai média de N'IMPORTE quel lien (fichier direct ou page via OpenGraph) → asset.
    "reference:resolveMedia": ([url, options]) => refStore.resolveMedia(url, options || {}),
    // Extrait le VRAI média d'un lien (réseaux sociaux & co) via yt-dlp / gallery-dl.
    "reference:extractMedia": ([url, options]) => extract.extractMedia(url, options || {}),
    // Décompose une vidéo locale en frames image → assets disque → liste de chemins.
    "reference:extractFrames": ([opts]) => extractBoardFrames(opts),
    "reference:push": ([payload]) => {
      broadcast("reference:push", payload);
      return null;
    },
    // Upscale d'un item média du board → nouveau fichier dans assets/ (possédé par l'app).
    // NON destructif : l'ancien fichier reste sur disque (le board garde de quoi revenir en arrière).
    "reference:upscaleItem": ([opts]) => upscaleBoardItem(ev, opts),
    // Supprime un fichier UNIQUEMENT s'il est un asset de l'app (cleanup d'un upscale annulé).
    "reference:dropAsset": ([p]) => refStore.removeAsset(p),
    // Ménage du magasin d'assets (Paramètres du board) : ce que plus aucune scène ne réclame part.
    "reference:sweepAssets": ([opts]) => refStore.sweepAssets(opts || {}),
    // Dossier déposé sur le board : médias trouvés récursivement, avec leur sous-dossier relatif
    // (l'import en fait un cadre par dossier). Plafonné, et le dit quand il tronque.
    "reference:scanFolder": ([dir, opts]) => scanFolder(dir, opts || {}),
    // Export du board (PNG/JPG en base64, SVG en texte) vers un chemin choisi par l'utilisateur.
    "reference:writeFile": ([filePath, data, encoding]) => writeExportFile(filePath, data, encoding),
    // Un cadre d'un média rendu en PNG base64, lu SUR LE DISQUE : c'est la seule source de pixels
    // relisible par le renderer (le protocole d'asset de la coquille teinte le canvas). Sert
    // l'extraction de palette, qui sans ça ne trouvait « aucune couleur exploitable ».
    "reference:sampleFrame": ([filePath, opts]) => ffmpeg.sampleFrame(filePath, opts || {}),

    // --- Partage « .netsu » : export (board courant → archive) / import (archive → scène) ---
    // L'export encode ses clips un par un : il rend compte item par item, sinon un board fourni
    // laisse l'utilisateur devant un bouton figé pendant plusieurs minutes.
    "netsu:export": ([scene, destPath, opts]) =>
      netsu.exportBoard(refStore, scene, destPath, {
        ...(opts || {}),
        onProgress: (p) => broadcast("netsu:progress", p),
      }),
    "netsu:import": ([srcPath]) => netsu.importBoard(refStore, srcPath),
    "netsu:weigh": ([scene, opts]) => netsu.weigh(scene, opts || {}),
    // Relocalisation EN LOT : un dossier, tous les médias manquants qu'on y reconnaît.
    "netsu:relocateFrom": ([dirPath, wanted]) => netsu.relocateFrom(dirPath, wanted || []),

    // --- Projet « .netsu » : le fichier EST le document (ouvert en continu, Ctrl+S incrémental) ---
    "netsu:openProject": ([srcPath]) => netsu.openProject(refStore, srcPath),
    "netsu:previewProject": ([srcPath]) => netsu.previewProject(refStore, srcPath),
    "netsu:saveProject": ([filePath, scene]) => netsu.saveProject(refStore, filePath, scene),
    "netsu:saveProjectAs": ([opts]) => netsu.saveProjectAs(refStore, opts || {}),
    "netsu:closeProject": ([filePath]) => netsu.closeProject(filePath),
    "netsu:recents": ([type]) => netsu.recentProjects(refStore, type),
    "netsu:forget": ([filePath]) => netsu.forgetProject(filePath),
    "netsu:deleteProject": ([filePath]) => netsu.deleteProject(filePath),
  };

  // Décompose une vidéo locale en frames d'APERÇU (ffmpeg, basse qualité) écrites dans le cache temp
  // SEQ_DIR (purgé au boot) → liste de chemins pour bâtir un item séquence. `in/out` (s) = plage de
  // boucle. Pas de persistance durable : un aperçu ne doit pas remplir le disque (cf. SEQ_DIR).
  async function extractBoardFrames(opts) {
    const { path: src, fps, max, height, in: inSec, out: outSec, projectPath, title } = opts || {};
    if (!src) return { ok: false, error: t("sourceMissing") };
    if (/^(https?:|data:|blob:)/i.test(String(src))) return { ok: false, error: t("localMediaRequired") };
    try {
      const { frames, fps: usedFps } = await ffmpeg.extractFrames(src, { fps, max, height, start: inSec, end: outSec });
      if (!frames.length) return { ok: false, error: t("noFrames") };
      if (!projectPath) return { ok: true, frames, fps: usedFps };
      const index = netsuSidecar.indexSidecar(projectPath);
      const group = netsuSidecar.slugify(title || "sequence");
      const organized = [];
      for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
        const adopted = netsuSidecar.adopt(projectPath, frames[frameIndex], {
          place: { kind: "image", group, index: frameIndex },
          index,
        });
        if (adopted.ok && adopted.path) organized.push(adopted.path);
      }
      if (!organized.length) return { ok: false, error: t("noFrames") };
      return { ok: true, frames: organized, fps: usedFps };
    } catch (e) {
      return { ok: false, error: String(e.stderr || e) };
    }
  }

  // Image → sidecar `image` (sortie PNG) ; vidéo → sidecar `upscale` HEVC mp4 (lisible direct sur le
  // board). `in/out` (secondes) = cut local ; sinon média entier. Renvoie { ok, path }.
  // Upscale d'un média du board. NetsuBoard n'a QU'UN moteur : les shaders GPU (libplacebo/Vulkan).
  // Aucun réseau neuronal, donc aucun environnement Python, aucun poids à télécharger — c'est ce qui
  // permet à l'application de s'installer en quelques secondes. `engine` reste accepté dans les
  // options pour ne pas casser les appels existants, mais il n'a plus qu'une valeur possible.
  async function upscaleBoardItem(event, opts) {
    const { path: src, kind, in: inSec, out: outSec, shader = "artcnn_c4f32", scale = 2 } = opts || {};
    if (!src) return { ok: false, error: t("sourceMissing") };
    if (/^(https?:|data:|blob:)/i.test(String(src))) return { ok: false, error: t("localMediaRequired") };

    // Un upscale coûte des minutes de GPU. Le registre répond d'abord : même source, mêmes bornes,
    // mêmes réglages ⇒ le fichier existe déjà, inutile de repayer le calcul.
    const ledgerKey = upLedger.fingerprint({
      ...upLedger.statSource(String(src)),
      src: String(src),
      in: inSec, out: outSec,
      encode: { workflow: `board_${kind === "image" ? "image" : "video"}` },
      upscale: { enabled: true, shader, scale },
    });
    const known = upLedger.lookup(ledgerKey);
    if (known) return { ok: true, path: known.file, cached: true };
    const remember = (out) => {
      if (out) upLedger.record(ledgerKey, out, { engine: "turbo", model: shader, scale });
      return out;
    };
    const base = `up_${Date.now().toString(36)}`;

    // Une image est une vidéo d'une seule frame pour libplacebo : même filtre, même shader, sortie
    // PNG au lieu d'un conteneur vidéo.
    if (kind === "image") {
      // GIF animé → chemin dédié (toutes les frames repassent par le shader, sortie GIF) ; image
      // fixe → une frame, sortie PNG. Un GIF envoyé sur le chemin fixe ne rendrait que sa 1re image.
      const isGif = /\.gif$/i.test(String(src));
      const out = refStore.assetPath(`${base}.${isGif ? "gif" : "png"}`);
      const r = isGif
        ? await shaderUpscale.runShaderGif({ input: src, out, shader, scale })
        : await shaderUpscale.runShaderImage({ input: src, out, shader, scale });
      if (!r || !r.ok || !r.output) return { ok: false, error: (r && r.error) || "échec upscale image" };
      return { ok: true, path: remember(r.output), width: r.width, height: r.height };
    }

    // Vidéo : sortie HEVC mp4 (encode GPU) directement lisible sur le board.
    const segs = inSec != null && outSec != null ? [{ in: inSec, out: outSec }] : undefined;
    const r = await turbo.runTurbo(sidecars, event, {
      input: src, shader, scale, codec: "hevc_nvenc", outDir: refStore.assetsDir,
      whole: !segs, segments: segs, importBack: false, baseName: base,
    });
    if (!r || !r.ok || !r.outputs || !r.outputs.length) return { ok: false, error: (r && r.error) || "échec upscale vidéo" };
    return { ok: true, path: remember(r.outputs[0]) };
  }


  // Ménage du magasin d'assets du board, AU DÉMARRAGE et à ce moment-là seulement : aucun board
  // n'est encore ouvert, donc aucun fichier affiché ne peut disparaître sous les yeux de personne.
  // Sans ça, sorties d'upscale, frames extraites et médias téléchargés s'empilent pour toujours.
  const ASSET_SWEEP_DELAY_MS = 20000;
  const assetSweepTimer = setTimeout(() => {
    const swept = refStore.sweepAssets({});
    if (swept.ok && swept.removed) {
      logbus.emit("core", "info", `[board] ${swept.removed} asset(s) inutilisés retirés (${Math.round(swept.bytes / 1048576)} Mo)`);
    }
  }, ASSET_SWEEP_DELAY_MS);
  assetSweepTimer.unref?.();

  function handle(req, res, u) {
    // SSE : flux d'événements de progression
    if (u.pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": connected\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return true;
    }

    // Invocation : POST /rpc
    if (u.pathname === "/rpc" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        let msg = {};
        try {
          msg = JSON.parse(body);
        } catch {}
        if (process.env.NR_CORE_DEBUG) console.error("[rpc]", msg.channel);
        const h = H[msg.channel];
        if (!h) {
          res.writeHead(404, JSONH).end(JSON.stringify({ ok: false, error: `unknown channel: ${msg.channel}` }));
          return;
        }
        try {
          const result = await h(msg.args || [], ev);
          res.writeHead(200, JSONH).end(JSON.stringify({ ok: true, result }));
        } catch (err) {
          const detail = String((err && err.stack) || err);
          logbus.emit("core", "error", `[rpc ${msg.channel}] ${detail.split("\n")[0]}`);
          res.writeHead(200, JSONH).end(JSON.stringify({ ok: false, error: detail }));
        }
      });
      return true;
    }

    return false;
  }

  return {
    handle, broadcast, channels: Object.keys(H), stopWatch: watch.stop, stopCache: cachePolicy.stop,
    closeProjects: () => netsu.closeAllProjects(),
  };
}

module.exports = { createRpc };

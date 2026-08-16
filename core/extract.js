// @ts-check
// Extraction du VRAI média derrière un lien (réseaux sociaux + ~1800 sites).
//
// yt-dlp est l'exécutable AUTONOME posé par le setup dans NR_HOME/runtime/bin (cf. config.js,
// `ytDlpCommand`). NetsuBoard n'installe aucun environnement Python : rien ici ne doit dépendre d'un
// interpréteur. gallery-dl (images d'un post photo) n'est PAS provisionné — il n'est utilisé que si
// le poste en fournit un, et son absence n'empêche jamais l'extraction vidéo.
//
// On télécharge le fichier dans le dossier d'assets du board (durable) puis on renvoie le(s)
// chemin(s) + le type au renderer, qui pose un item vidéo/image NATIF (pas une carte embed). Pour un
// projet ouvert, la destination est directement son dossier compagnon organisé ; le magasin global
// ne sert que pour un board sans fichier.
//
// Stratégie (jusqu'à 2 passes : sans cookies puis avec, le contenu public marche sans login) :
//   1. yt-dlp → meilleure vidéo mp4 (merge HLS/DASH via ffmpeg) ;
//   2. si pas de vidéo (post photo) et gallery-dl présent → image(s) pleine résolution.
// La 2e passe utilise un cookies.txt exporté s'il existe, sinon le trousseau d'un navigateur
// installé : c'est ce qui débloque le contenu réservé aux comptes connectés.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const {
  PYTHON, DETECT_ENV, DATA_DIR, ffBin, NR_HOME,
  cookieBrowserCandidates, ytCookiesFile, ytDlpCommand,
} = require('./config');
const { t } = require('./i18n');
const sidecar = require('./netsu/sidecar');
const downloadTarget = require('./netsu/downloadTarget');

const ASSETS_DIR = path.join(DATA_DIR, 'reference', 'assets');
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'mkv', 'm4v', 'avi', 'ogv']);
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'tiff', 'tif']);

function ensureDir(d) {
  try { fs.mkdirSync(d, { recursive: true }); } catch (_) {}
}

// dossier de ffmpeg si fourni en absolu (bundle) → passé à yt-dlp ; sinon il le cherche dans le PATH.
function ffmpegDir() {
  const f = ffBin('ffmpeg');
  return path.isAbsolute(f) ? path.dirname(f) : null;
}

/** gallery-dl, s'il existe : exécutable autonome à côté de yt-dlp, sinon module d'un Python local
 * (venv de développement). Renvoie null quand ni l'un ni l'autre n'est plausible — spawn d'un
 * `python` inexistant ne dirait rien d'utile.
 * @returns {{ bin: string, args: string[] } | null} */
function galleryCommand() {
  const exe = path.join(NR_HOME, 'runtime', 'bin', process.platform === 'win32' ? 'gallery-dl.exe' : 'gallery-dl');
  try { if (fs.existsSync(exe)) return { bin: exe, args: [] }; } catch (_) {}
  const venv = process.platform === 'win32'
    ? path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe')
    : path.join(__dirname, '..', '.venv', 'bin', 'python');
  try { if (fs.existsSync(venv)) return { bin: venv, args: ['-m', 'gallery_dl'] }; } catch (_) {}
  try { if (PYTHON && path.isAbsolute(PYTHON) && fs.existsSync(PYTHON)) return { bin: PYTHON, args: ['-m', 'gallery_dl'] }; } catch (_) {}
  return null;
}

// Lance un process et résout { code, stdout, stderr, missing }. Tué dur après `timeoutMs`.
// `missing` = l'exécutable lui-même est absent (ENOENT) : ce n'est pas un lien qui échoue.
function run(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { env: DETECT_ENV });
    let out = '', err = '';
    const killer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => {
      clearTimeout(killer);
      const missing = /** @type {NodeJS.ErrnoException} */ (e)?.code === 'ENOENT';
      resolve({ code: -1, stdout: out, stderr: String(e), missing });
    });
    child.on('close', (code) => { clearTimeout(killer); resolve({ code: code ?? -1, stdout: out, stderr: err, missing: false }); });
  });
}

function extOf(p) { return (p.split('.').pop() || '').toLowerCase(); }

let toolCheckPromise = null;

async function ytdlpAvailable() {
  const cmd = ytDlpCommand();
  const { code, stderr, missing } = await run(cmd.bin, [...cmd.args, '--version'], 20000);
  return {
    ok: code === 0,
    missing,
    error: missing ? `yt-dlp introuvable (${cmd.bin}) — relance l'installation pour poser l'outil` : stderr.trim(),
  };
}

async function galleryAvailable() {
  const cmd = galleryCommand();
  if (!cmd) return { ok: false, missing: true, error: '' };
  const { code, stderr, missing } = await run(cmd.bin, [...cmd.args, '--version'], 20000);
  return { ok: code === 0, missing, error: stderr.trim() };
}

async function checkTools() {
  if (!toolCheckPromise) {
    toolCheckPromise = (async () => {
      const [yt, gl] = await Promise.all([ytdlpAvailable(), galleryAvailable()]);
      return { yt, gl };
    })();
  }
  return toolCheckPromise;
}

// Vidéo destinée à un LECTEUR DE BOARD, pas à un montage : H.264 en 1080p au plus. Le même plan
// existe en AV1 et en VP9, souvent en 4K — la WebView les décode en logiciel, un 2160p AV1 rend un
// carré noir (MEDIA_ERR_DECODE) pour cent fois le poids d'un 1080p avc1. Le repli garde une sortie
// même quand la plateforme n'a rien en avc1.
const YTDLP_FORMAT = [
  'bv*[vcodec^=avc1][height<=1080]+ba[ext=m4a]',
  'b[vcodec^=avc1][height<=1080]',
  'bv*[ext=mp4][height<=1080]+ba[ext=m4a]',
  'b[ext=mp4]',
  'b',
].join('/');

// yt-dlp : meilleure vidéo mp4 → fichier(s) dans `outputDir`. Renvoie les chemins vidéo écrits.
async function tryYtdlp(url, cookies, outputDir) {
  const outTpl = path.join(outputDir, 'nr-yt-%(id)s.%(ext)s');
  const args = [
    url,
    '-f', YTDLP_FORMAT,
    '--merge-output-format', 'mp4',
    '--no-playlist', '--no-warnings', '--no-progress', '--no-simulate',
    '--socket-timeout', '30', '--max-filesize', '1024m',
    '--restrict-filenames',
    '-o', outTpl,
    '--print', 'after_move:filepath',
  ];
  // Instagram changes its public web API frequently. The current extractor plus browser
  // impersonation keeps this path independent from a locked local Chrome cookie database.
  if (/https?:\/\/(?:www\.)?instagram\.com\//i.test(url)) args.push('--impersonate', 'chrome');
  const ffDir = ffmpegDir();
  if (ffDir) args.push('--ffmpeg-location', ffDir);
  if (cookies && cookies.file) args.push('--cookies', cookies.file);
  else if (cookies && cookies.browser) args.push('--cookies-from-browser', cookies.browser);

  const cmd = ytDlpCommand();
  const { code, stdout, stderr, missing } = await run(cmd.bin, [...cmd.args, ...args], 120000);
  const paths = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const items = [];
  for (const p of paths) if (fs.existsSync(p) && VIDEO_EXTS.has(extOf(p))) items.push({ path: p, kind: 'video' });
  if (code === 0 && items.length) return { ok: true, items };
  return { ok: false, missing, error: missing ? `yt-dlp introuvable (${cmd.bin})` : stderr.trim() };
}

// gallery-dl : images (post photo, carrousel) → un sous-dossier dédié, puis on liste les fichiers.
async function tryGallery(url, cookies, outputDir) {
  const cmd = galleryCommand();
  if (!cmd) return { ok: false, error: '' };
  const sub = path.join(outputDir, `nr-gl-${crypto.randomBytes(5).toString('hex')}`);
  ensureDir(sub);
  const args = [
    '-q', '-D', sub,
    '--range', '1-20', '--filesize-max', '256M', '--no-mtime',
    url,
  ];
  if (cookies && cookies.file) args.push('--cookies', cookies.file);
  else if (cookies && cookies.browser) args.push('--cookies-from-browser', cookies.browser);

  const { stderr } = await run(cmd.bin, [...cmd.args, ...args], 120000);
  let files = [];
  try { files = fs.readdirSync(sub); } catch (_) {}
  const items = [];
  for (const f of files) {
    const p = path.join(sub, f);
    const e = extOf(p);
    if (IMAGE_EXTS.has(e) || VIDEO_EXTS.has(e)) items.push({ path: p, kind: IMAGE_EXTS.has(e) ? 'image' : 'video' });
  }
  if (!items.length) { try { fs.rmSync(sub, { recursive: true, force: true }); } catch (_) {} }
  return items.length ? { ok: true, items } : { ok: false, error: stderr.trim() };
}

/** Passes de cookies : la publique d'abord (le contenu public n'a rien à prouver), puis UNE passe
 * authentifiée. Un cookies.txt exporté passe avant le trousseau d'un navigateur — il reste lisible
 * même navigateur ouvert, là où Chrome verrouille sa base.
 * @returns {({ file: string|null, browser: string|null }|null)[]} */
function cookiePasses() {
  const file = ytCookiesFile();
  if (file) return [null, { file, browser: null }];
  const browser = cookieBrowserCandidates()[0];
  return browser ? [null, { file: null, browser }] : [null];
}

// Extrait le média derrière `url`. Passe sans cookies d'abord (public), puis avec (contenu connecté).
/** @param {string} url @param {{ projectPath?: string, title?: string }} [options] */
async function extractMedia(url, options = {}) {
  if (!/^https?:\/\//i.test(String(url || ''))) return { ok: false, error: 'URL invalide' };
  const projectPath = String(options.projectPath || '');
  const videoDir = projectPath ? downloadTarget.bucketDir(projectPath, 'video') : ASSETS_DIR;
  const imageDir = projectPath ? downloadTarget.bucketDir(projectPath, 'image') : ASSETS_DIR;
  ensureDir(videoDir);
  ensureDir(imageDir);
  const tools = await checkTools();
  if (!tools.yt.ok && !tools.gl.ok) {
    return { ok: false, error: tools.yt.error || t('extractToolsMissing') };
  }
  const errors = [];
  for (const ck of cookiePasses()) {
    if (tools.yt.ok) {
      const v = await tryYtdlp(url, ck, videoDir);
      if (v.ok) return projectPath ? organizeProjectItems(projectPath, v.items, options.title) : v;
      if (v.error) errors.push(v.error);
    }
    if (tools.gl.ok) {
      const g = await tryGallery(url, ck, imageDir);
      if (g.ok) return projectPath ? organizeProjectItems(projectPath, g.items, options.title) : g;
      if (g.error) errors.push(g.error);
    }
  }
  const tail = errors.find(Boolean);
  return { ok: false, error: tail || 'aucun média extractible (compte privé, lien non supporté, ou outil à jour requis)' };
}

function organizeProjectItems(projectPath, items, title) {
  const index = sidecar.indexSidecar(projectPath);
  const organized = [];
  for (const item of items || []) {
    const adopted = sidecar.adopt(projectPath, item.path, {
      place: { kind: item.kind, title: title || path.basename(item.path, path.extname(item.path)) },
      index,
    });
    if (!adopted.ok || !adopted.path) continue;
    if (path.resolve(adopted.path) !== path.resolve(item.path) && sidecar.isInSidecar(projectPath, item.path)) {
      try { fs.rmSync(item.path, { force: true }); } catch (_) {}
    }
    organized.push({ path: adopted.path, kind: item.kind });
  }
  return organized.length ? { ok: true, items: organized } : { ok: false, error: 'échec du rangement du média' };
}

module.exports = { extractMedia };

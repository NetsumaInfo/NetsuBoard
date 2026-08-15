// Contrôle RAPIDE du premier lancement : `setupStatus` lit `quickReady ? true : ffmpegReady(...)`.
// Ce qui passe ici n'ouvre jamais l'écran d'installation, donc un runtime incomplet ou un ffmpeg
// périmé doivent être refusés ICI — sinon la version épinglée ne parvient jamais aux postes déjà
// installés, et l'écran de réparation devient inatteignable.
//
// Ces cas viennent de `setup-selection.test.cjs`, dont le reste vérifiait un catalogue de modèles que
// l'installation ne propose plus : NetsuBoard n'exécute aucun poids.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { quickSetupReady, SETUP_RUNTIME_VERSION } = require('../core/setup');

// Runtime complet et CRÉDIBLE : le contrôle regarde des fichiers, pas une déclaration. Le dossier de
// shaders doit contenir au moins un .glsl, et yt-dlp exister — l'un ou l'autre absent renvoie à la
// réparation, ce qu'exercent les cas plus bas.
function installedConfig(extra = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-setup-'));
  const shaderDir = path.join(home, 'shaders');
  fs.mkdirSync(shaderDir);
  fs.writeFileSync(path.join(shaderDir, 'artcnn.glsl'), '// shader');
  const ytDlp = path.join(home, 'yt-dlp.exe');
  fs.writeFileSync(ytDlp, '');
  return {
    setupCompletedAt: new Date().toISOString(),
    ffmpeg: process.execPath,
    ffprobe: process.execPath,
    // Version enregistrée par setup.ps1 : le contrôle rapide la compare comme une chaîne et ne lance
    // AUCUN processus. Sans elle, il interrogerait le binaire — ici node, qui n'annonce évidemment
    // pas « ffmpeg version ».
    ffmpegVersion: '9.0',
    setupRuntimeVersion: SETUP_RUNTIME_VERSION,
    shaderDir,
    ytDlp,
    ...extra,
  };
}

const ready = (config) => quickSetupReady(config, { ignorePackageGate: true });

test('quick setup check accepts a complete install', () => {
  assert.equal(ready(installedConfig()), true);
});

test('quick setup rejects an install predating a mandatory runtime capability', () => {
  const config = installedConfig();
  delete config.setupRuntimeVersion;
  assert.equal(ready(config), false);
  assert.equal(ready({ ...config, setupRuntimeVersion: SETUP_RUNTIME_VERSION }), true);
});

test('quick setup check rejects an install whose ffmpeg version is no longer accepted', () => {
  const at = (ffmpegVersion) => ready(installedConfig({ ffmpegVersion }));
  assert.equal(at('7.1'), false, 'une 7.1 héritée doit renvoyer vers la réparation');
  assert.equal(at('8.0'), false, 'une version hors liste doit être refusée');
  assert.equal(at('9.0'), true, 'la version épinglée est acceptée');
  assert.equal(at('8.1'), true, 'le repli zip est accepté sans boucler sur l\'installation');
  assert.equal(at('9.0.1'), true, 'un correctif de la version épinglée est accepté');
});

// Sans shader, l'upscale n'a plus de moteur : l'installation doit rouvrir.
// (La présence de yt-dlp n'est pas exercée ici : `ytDlpReady` rend `true` hors application packagée,
// et `PACKAGED` est figé au require du module.)
test('quick setup check rejects a runtime whose shaders are gone', () => {
  const config = installedConfig();
  fs.rmSync(config.shaderDir, { recursive: true, force: true });
  assert.equal(ready(config), false);
});

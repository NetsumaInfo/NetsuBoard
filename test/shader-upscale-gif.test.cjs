// Le moteur d'upscale est le seul de NetsuBoard : ce qu'il refuse n'a aucun repli. Deux propriétés
// se vérifient sans GPU ni ffmpeg — un GIF animé a bien un chemin à lui (sinon il ressortait aplati
// sur sa première image), et un dossier de shaders non provisionné se dit tel quel. Ce dernier point
// est le piège : `runOne` lance ffmpeg avec cwd = SHADER_DIR, donc un dossier absent faisait échouer
// spawn en ENOENT, remonté à l'utilisateur en « ffmpeg introuvable » — la mauvaise piste.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// SHADER_DIR est lu une fois au require de core/config : l'env doit être posé avant l'import.
const MISSING = path.join(os.tmpdir(), 'nb-shaders-absent-' + process.pid);
process.env.NETSURUSH_SHADER_DIR = MISSING;
const shaderUpscale = require('../core/shaderUpscale.js');

test('le dossier des shaders manquant est nommé, pas déguisé en ffmpeg introuvable', async () => {
  assert.equal(fs.existsSync(MISSING), false);
  const calls = [
    shaderUpscale.runShaderGif({ input: 'a.gif', out: 'b.gif' }),
    shaderUpscale.runShaderImage({ input: 'a.png', out: 'b.png' }),
    shaderUpscale.runShaderFrame({ input: 'a.mp4' }),
    shaderUpscale.runShaderUpscale(null, { input: 'a.mp4', outDir: os.tmpdir(), whole: true }),
  ];
  for (const r of await Promise.all(calls)) {
    assert.equal(r.ok, false);
    assert.match(r.error, /dossier des shaders absent/);
    assert.match(r.error, /fetch-shaders/); // la sortie dit quoi lancer pour réparer
  }
});

test('un GIF animé a un chemin dédié, séparé de l\'image fixe', async () => {
  assert.equal(typeof shaderUpscale.runShaderGif, 'function');
  // Le chemin image fixe écrit UNE frame : il doit continuer de refuser un GIF plutôt que l'aplatir.
  const flattened = await shaderUpscale.runShaderImage({ input: 'anim.gif', out: 'out.png' });
  assert.equal(flattened.ok, false);
  assert.match(flattened.error, /GIF/);
});

'use strict';

// Cohérence de la CSP avec les voies par lesquelles le board sert ses médias.
//
// La panne que ces cas ferment est invisible en développement et systématique une fois l'application
// installée : le renderer de dev est servi depuis l'origine Vite, dont la CSP n'est pas celle du
// bundle. Un `img-src` incomplet passe donc toute la phase de test et ne casse que chez l'utilisateur.
//
// Deux voies servent EXACTEMENT les mêmes fichiers (cf. `displaySrc` → `nr.assetUrl`) :
//   1. le protocole asset de la coquille, sans socket ;
//   2. le serveur HTTP local du service, en repli.
// Une image et une vidéo empruntent la même, choisie au même moment par le même code. Autoriser
// l'une pour `media-src` et l'oublier pour `img-src` ne « limite » donc rien : ça casse les images
// en laissant croire que le média fonctionne, puisque les vidéos, elles, s'affichent.

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'src-tauri', 'tauri.conf.json'), 'utf8'),
);
const csp = config.app.security.csp;

/** Une directive → ses sources. */
function sources(name) {
  const found = csp
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(/\s+/))
    .find((parts) => parts[0] === name);
  assert.ok(found, `directive ${name} absente de la CSP`);
  return found.slice(1);
}

test('la CSP existe : sans elle, ces règles ne protègent rien', () => {
  assert.equal(typeof csp, 'string');
  assert.ok(csp.length > 0);
});

test('tout ce qui sert une vidéo sert aussi une image', () => {
  // L'invariant central. `media-src` a longtemps porté le serveur local que `img-src` n'avait pas :
  // dans l'application installée, les vidéos jouaient et les images restaient des cases vides.
  const missing = sources('media-src').filter((origin) => !sources('img-src').includes(origin));
  assert.deepEqual(missing, [], `origines servant la vidéo mais pas l'image : ${missing.join(', ')}`);
});

test('les deux voies de service des médias sont autorisées aux images', () => {
  const img = sources('img-src');
  assert.ok(img.includes('asset:') || img.includes('http://asset.localhost'), 'protocole asset absent de img-src');
  assert.ok(img.includes('http://127.0.0.1:*'), 'serveur local absent de img-src');
});

test('la sonde du protocole asset peut atteindre son origine', () => {
  // `assetSrc` teste le protocole avec un fetch() — donc soumis à `connect-src`, pas à `img-src`.
  // Refusée là, la sonde échoue, l'application conclut que le protocole n'existe pas et bascule TOUT
  // le média sur le repli HTTP pour la session entière. Une omission ici ne se voit jamais
  // directement : elle se manifeste en aval, comme une panne d'affichage.
  assert.ok(sources('connect-src').includes('http://asset.localhost'), 'origine du protocole asset absente de connect-src');
});

test('le service local reste joignable pour le RPC et le flux d’événements', () => {
  assert.ok(sources('connect-src').includes('http://127.0.0.1:*'));
});

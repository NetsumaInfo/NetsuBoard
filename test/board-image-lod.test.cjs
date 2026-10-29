// Level of detail of a board image: which level of its pyramid replaces the full source.
// The choice decides the memory a whole board takes — an inverted condition is either thirty
// full-definition bitmaps kept alive (eviction, blank boxes while navigating) or a blurry board.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const Module = require('node:module');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const rel = 'src/components/reference/boardImageLod.ts';
// The module pulls React, the bridge and the store: only the pure decisions are kept. The purge
// subscription (onThumbsCleared) comes from a stripped import → inert stub.
const src = 'const onThumbsCleared = () => {};\n'
  + 'const isCoreFileRef = (ref) => !!ref && !/^(https?:|data:|blob:|collab:)/i.test(ref);\n'
  + fs.readFileSync(path.join(root, rel), 'utf8')
  .replace(/^import[^;]*;$/gm, '')
  .replace(/export function useImageLod[\s\S]*$/m, '');
const js = esbuild.transformSync(src, { loader: 'ts', format: 'cjs' }).code;
const mod = new Module(rel, null);
mod._compile(js, path.join(root, rel));
const { tierEligible, screenLongSide, pickLevel, wantsTiers, heavySource, zoomCeil } = mod.exports;

const img = (over = {}) => ({ kind: 'image', ref: 'C:/rushes/a.png', w: 400, h: 225, natW: 7680, natH: 4320, ...over });
const LADDER = [512, 1024, 2048];

test('the smallest level sharper than the screen is picked', () => {
  assert.equal(pickLevel(300, LADDER, null), 512);
  assert.equal(pickLevel(512, LADDER, null), 512);
  assert.equal(pickLevel(513, LADDER, null), 1024);
  assert.equal(pickLevel(1900, LADDER, null), 2048);
});

test('the full source only shows once no level is sharp enough', () => {
  assert.equal(pickLevel(2049, LADDER, null), 0);
  // A small source has no level at all: it is always shown as it is.
  assert.equal(pickLevel(10, [], null), 0);
  assert.equal(pickLevel(800, [512], null), 0);
});

// Without a dead band, a wheel back-and-forth around a threshold swapped the source at every notch
// — and every swap is a decode.
test('a sharper level on screen is kept while it is one step above the need', () => {
  assert.equal(pickLevel(300, LADDER, 1024), 1024, 'one step above: kept');
  assert.equal(pickLevel(300, LADDER, 2048), 512, 'two steps above: released');
  assert.equal(pickLevel(1500, LADDER, 0), 0, 'full source, need one step below: kept');
  assert.equal(pickLevel(300, LADDER, 0), 512, 'full source far above the need: released');
  // Never kept when it is not sharp enough.
  assert.equal(pickLevel(900, LADDER, 512), 1024);
});

test('the screen size is in device pixels and counts the crop', () => {
  assert.equal(screenLongSide(img(), 1), 400);
  assert.equal(screenLongSide(img(), 2, 1.5), 1200);
  // A crop keeping half the width draws the source twice as large as the box.
  assert.equal(screenLongSide(img({ crop: { x: 0, y: 0, w: 0.5, h: 1 } }), 1), 800);
});

// An 8K wallpaper filling a 1440p screen is 2560 device px: past the top level, the source shows.
// At a quarter of the screen it must NOT — that was the 133 MB bitmap per image.
test('a large source drawn at a fraction of the screen goes through a level', () => {
  const need = screenLongSide(img({ w: 640, h: 360 }), 1, 1);
  assert.equal(pickLevel(need, LADDER, null), 1024);
});

test('only local still images use the pyramid', () => {
  assert.equal(tierEligible(img()), true);
  for (const ext of ['gif', 'webp', 'avif', 'apng']) {
    assert.equal(tierEligible(img({ ref: `C:/rushes/a.${ext}` })), false, ext);
  }
  assert.equal(tierEligible(img({ ref: 'https://cdn.example/a.png' })), false);
  assert.equal(tierEligible(img({ ref: 'blob:abc' })), false);
  assert.equal(tierEligible(img({ kind: 'video' })), false);
  assert.equal(tierEligible(img({ ref: '' })), false);
  assert.equal(tierEligible(img({ loading: true })), false);
  assert.equal(tierEligible(img({ missing: true })), false);
});

test('a pyramid is only asked for when it would replace a clearly larger source', () => {
  assert.equal(wantsTiers(img(), 400), true);
  assert.equal(wantsTiers(img({ natW: 500, natH: 300 }), 400), false);
  // Unmeasured: only the core can tell, it answers with an empty pyramid for a small file.
  assert.equal(wantsTiers(img({ natW: undefined, natH: undefined }), 400), true);
});

// Rule 3: decoding a 4K+ source "while waiting" is the import freeze itself.
test('a heavy or unmeasured source waits for its level instead of decoding in full', () => {
  assert.equal(heavySource(img()), true);
  assert.equal(heavySource(img({ natW: undefined, natH: undefined })), true);
  assert.equal(heavySource(img({ natW: 1920, natH: 1080 })), false);
});

test('the subscribed zoom is quantised to octaves, and never underestimates', () => {
  for (const s of [0.002, 0.03, 0.4, 1, 1.01, 2, 3, 7.9, 64]) {
    const z = zoomCeil(s);
    assert.ok(z >= s, `${z} doit majorer ${s}`);
    assert.equal(Math.log2(z), Math.round(Math.log2(z)), `${z} doit être une puissance de 2`);
  }
  assert.equal(zoomCeil(1.01), zoomCeil(1.99));
  assert.notEqual(zoomCeil(1.99), zoomCeil(2.01));
});

test('a remounted item starts on the right source, not on the full one', () => {
  const raw = read(rel);
  assert.match(raw, /function firstSrc\(item: BoardItem\): string/);
  assert.match(raw, /useState\(\(\) => firstSrc\(item\)\)/);
  assert.match(raw, /decoded\.add\(src\)/);
});

test('a dead level falls back to the full source instead of leaving a broken box', () => {
  const raw = read(rel);
  assert.match(raw, /tierMaps\.delete\(item\.ref\)/);
  assert.match(raw, /setShown\(item\.src\)/);
  assert.match(read('src/components/reference/BoardItem.tsx'), /if \(!lod\.onError\(\) && !retry\.onFailure\(\)\) triggerRecover\(item\)/,
    'l’erreur du <img> doit passer par le repli du LOD puis la reprise locale avant la récupération de média');
});

test('a transient failure is retried, not cached for the session', () => {
  const raw = read(rel);
  assert.match(raw, /if \(src\) resolved\.set\(key, src\)/);
  assert.match(raw, /if \(tiers\) tierMaps\.set\(ref, tiers\)/);
});

test('requests are capped in flight and primed in one batch per scene', () => {
  const raw = read(rel);
  const max = Number(/const THUMB_INFLIGHT_MAX = (\d+)/.exec(raw)[1]);
  assert.ok(max >= 1 && max < 6, `${max} demandes en vol : sous les 6 sockets de l'origine`);
  assert.match(raw, /export function primeBoardThumbs/);
  assert.match(raw, /imageTiersResolve/);
  assert.match(raw, /thumbsResolve/);
  assert.match(read('src/components/reference/ReferenceBoard.tsx'), /primeBoardThumbs\(/);
  assert.match(raw, /warmDecode\(small\)/);
});

test('the displayed source only changes once the new one is decoded', () => {
  const raw = read(rel);
  assert.match(raw, /img\.decode\?\.\(\)/, 'la cible doit être DÉCODÉE, pas seulement chargée');
  // Three paths change the shown source: the decoded swap, the file reset, and the error fallback
  // of a dead level — which goes TO the full source, the only swap safe without preloading.
  const swaps = raw.match(/setShown\(/g) ?? [];
  assert.equal(swaps.length, 3);
  assert.match(raw, /void preload\(target\)\.then\(\(ok\) => \{[\s\S]*?setShown\(target\)/);
});

// The core side: one ffmpeg pass, one output per level, only levels clearly smaller than the source.
test('the core makes every level in one pass, only below the source size', () => {
  const thumbs = require(path.join(root, 'core/thumbs.js'));
  assert.deepEqual(thumbs.tierSidesFor(7680, 4320), [512, 1024, 2048]);
  assert.deepEqual(thumbs.tierSidesFor(1920, 1080), [512, 1024]);
  assert.deepEqual(thumbs.tierSidesFor(1200, 675), [512]);
  assert.deepEqual(thumbs.tierSidesFor(600, 338), []);
  const args = thumbs.tierArgs('C:/a.png', [512, 1024, 2048]);
  assert.equal(args.filter((a) => a === '-i').length, 1, 'the source is decoded once');
  assert.equal(args.filter((a) => a === '-map').length, 3);
  assert.match(args[args.indexOf('-filter_complex') + 1], /split=3/);
  const one = thumbs.tierArgs('C:/a.png', [512]);
  assert.doesNotMatch(one[one.indexOf('-filter_complex') + 1], /split/);
});

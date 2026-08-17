// Opacité des contenus : Alt + molette, comme les outils de référence. Sur un média elle ne touche
// que lui, sur le vide elle touche toute la planche, et un plancher empêche de perdre ses images.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const board = read('src/components/reference/ReferenceBoard.tsx');
const prefs = read('src/components/reference/boardPrefs.ts');

test('Alt takes the wheel away from zoom', () => {
  assert.match(board, /if \(e\.altKey\) \{ wheelOpacity\(e\); return; \}/);
  assert.match(board, /const wheelOpacity = useCallback/);
});

test('the wheel targets the media under the cursor, the whole board otherwise', () => {
  assert.match(board, /closest\?\.\("\[data-board-item\]"\)/);
  assert.match(board, /st\.patchItem\(item\.id, \{ opacity: next < 1 \? next : undefined \}, false\)/);
  assert.match(board, /st\.setPrefs\(\{ contentOpacity: next \}\)/);
});

test('a floor keeps the board findable', () => {
  assert.match(prefs, /export const MEDIA_OPACITY_MIN = 0\.1;/);
  assert.match(prefs, /Math\.min\(1, Math\.max\(MEDIA_OPACITY_MIN, v\)\)/);
  assert.match(board, /clampMediaOpacity/);
});

test('the global opacity is one layer, so a per-item value multiplies with it', () => {
  assert.match(board, /opacity: contentOpacity \}\}/);
  assert.match(read('src/components/reference/BoardItem.tsx'), /opacity: item\.opacity \?\? 1,/);
  assert.match(prefs, /contentOpacity: 1,/);
});

test('both readings are announced and translated everywhere', () => {
  for (const lang of ['fr', 'en', 'de', 'es', 'ja', 'zh']) {
    const j = JSON.parse(read(`src/locales/${lang}/reference.json`));
    assert.match(j.notice.itemOpacity, /\{\{percent\}\}/, `${lang} notice.itemOpacity`);
    assert.match(j.notice.contentOpacity, /\{\{percent\}\}/, `${lang} notice.contentOpacity`);
    assert.equal(typeof j.settings.contentOpacity, 'string', `${lang} settings.contentOpacity`);
  }
});

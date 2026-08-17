// Barre d'outils ÉPINGLÉE : son contenu et son bord sont réglables, et les sorties du format
// (épingler, détacher, rattacher) ne le sont PAS — une fenêtre coin sans bouton pour en sortir se
// récupère au clavier ou pas du tout.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const toolbar = read('src/components/reference/Toolbar.tsx');
const buttons = read('src/components/reference/toolbarButtons.tsx');
const prefs = read('src/components/reference/boardPrefs.ts');
const panel = read('src/components/reference/ReferencePanel.tsx');

test('the pinned toolbar renders each end in the order the user arranged', () => {
  // L'ordre vient des PRÉFÉRENCES : c'est la disposition posée au glisser-déposer.
  assert.match(toolbar, /const group = \(ids: PinnedButtonId\[\]\) =>/);
  assert.match(toolbar, /\{group\(prefs\.pinnedButtons\)\}/);
  assert.match(toolbar, /\{group\(prefs\.pinnedButtonsEnd\)\}/);
});

test('pin, detach and attach are never maskable', () => {
  const ids = [...buttons.matchAll(/\{ id: "(\w+)"/g)].map((m) => m[1]);
  for (const forbidden of ['pin', 'detach', 'attach']) {
    assert.ok(!ids.includes(forbidden), `${forbidden} must stay out of the customisable list`);
  }
  assert.match(toolbar, /const windowButtons = \(/);
});

test('the bar is arranged by dragging onto a mock of itself', () => {
  const editor = read('src/components/reference/PinnedBarEditor.tsx');
  // Deux zones de dépôt, dans le sens du bord, et une réserve pour ce qui n'est pas posé.
  assert.match(editor, /<Dropzone zone="start" ids=\{start\} \/>/);
  assert.match(editor, /<Dropzone zone="end" ids=\{end\} \/>/);
  assert.match(editor, /dataTransfer\.setData\("text\/plain", /);
  // Un bouton ne vit que dans UNE zone : le mouvement le retire de l'autre.
  assert.match(editor, /start: start\.filter\(\(x\) => x !== id\)/);
  assert.match(editor, /end: end\.filter\(\(x\) => x !== id\)/);
  // Le clic reste une voie complète : ajouter depuis la réserve, retirer une icône posée.
  assert.match(editor, /onClick=\{\(\) => move\(b\.id, "start"\)\}/);
  assert.match(editor, /onClick=\{\(\) => remove\(id\)\}/);
  // Les sorties du format restent APRÈS les boutons ancrés à la fin.
  const tail = toolbar.slice(toolbar.indexOf('{group(prefs.pinnedButtonsEnd)}'));
  assert.match(tail.slice(0, 200), /\{windowButtons\}/);
});

test('the full bar is arranged the same way, around the project name', () => {
  // Meme editeur, memes zones : la barre pleine se dispose comme la barre epinglee.
  assert.match(read('src/components/reference/BoardSettings.tsx'), /start=\{prefs\.barButtons\}/);
  assert.match(toolbar, /\{group\(prefs\.barButtons\)\}/);
  assert.match(toolbar, /\{group\(prefs\.barButtonsEnd\)\}/);
  // Le nom du projet reste ENTRE les deux zones.
  const startAt = toolbar.indexOf('{group(prefs.barButtons)}');
  const centerAt = toolbar.indexOf('fileLabel(filePath)');
  const endAt = toolbar.indexOf('{group(prefs.barButtonsEnd)}');
  assert.ok(startAt < centerAt && centerAt < endAt, 'the project name must sit between both zones');
  // Les quatre boutons qui n'existaient que dans la barre pleine sont adressables.
  for (const id of ['saveAs', 'openProject', 'share', 'newScene']) {
    assert.match(buttons, new RegExp(`id: "${id}"`), `${id} must be offered`);
    assert.match(toolbar, new RegExp(`${id}:`), `${id} must be rendered from the table`);
  }
});

test('preferences that listed a button in both zones are split on read', () => {
  assert.match(prefs, /function splitZones/);
  assert.match(prefs, /known\(v\[startKey\]\)\.filter\(\(id\) => !end\.includes\(id\)\)/);
  assert.match(prefs, /\.\.\.splitZones\(v, "pinnedButtons", "pinnedButtonsEnd"\)/);
  assert.match(prefs, /\.\.\.splitZones\(v, "barButtons", "barButtonsEnd"\)/);
});

test('a stale button id or an unknown edge falls back to the default', () => {
  assert.match(prefs, /PINNED_BUTTONS\.some\(\(b\) => b\.id === id\)/);
  assert.match(prefs, /PINNED_SIDES\.some\(\(s\) => s\.id === v\.pinnedSide\) \? v\.pinnedSide : PREFS_DEFAULT\.pinnedSide/);
});

test('left and right edges turn the pinned bar vertical, bottom and right put it after the board', () => {
  assert.match(buttons, /export function isVerticalSide\(side: PinnedSide\): boolean/);
  assert.match(panel, /const vertical = pinned && isVerticalSide\(pinnedSide\)/);
  assert.match(panel, /const barAfter = pinned && \(pinnedSide === "bottom" \|\| pinnedSide === "right"\)/);
  assert.match(panel, /\{!barAfter && bar\}/);
  assert.match(panel, /\{barAfter && bar\}/);
});

test('every offered button has a translated label and both new actions are offered', () => {
  const ids = [...buttons.matchAll(/\{ id: "(\w+)", labelKey: "([\w.]+)"/g)];
  assert.ok(ids.length >= 15, 'the customisable list must cover the toolbar');
  const fr = JSON.parse(read('src/locales/fr/reference.json'));
  for (const [, id, key] of ids) {
    const value = key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), fr);
    assert.equal(typeof value, 'string', `${id} has no label (${key})`);
  }
  // Les deux fonctionnalités qui n'avaient jusqu'ici qu'un raccourci.
  assert.ok(ids.some(([, id]) => id === 'extractPalette'));
  assert.ok(ids.some(([, id]) => id === 'tidy'));
});

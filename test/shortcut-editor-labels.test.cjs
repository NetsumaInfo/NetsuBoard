// L'éditeur de raccourcis résout ses libellés dans le namespace de SON module : croisés avec un
// autre, les clés absentes s'affichaient telles quelles (« shortcut.delete ») dans les Paramètres.
// Et toute action peut être DÉLIÉE — un combo vide est un choix, pas un trou à recombler.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const editor = read('src/components/shortcuts/ShortcutEditor.tsx');
const lib = read('src/lib/shortcuts.ts');
const settings = read('src/components/reference/BoardSettings.tsx');
const shared = read('src/components/reference/referenceShared.ts');

test('labels resolve in the namespace the caller names', () => {
  assert.match(editor, /const \{ t \} = useTranslation\(\[ns, "common"\]\)/);
  assert.doesNotMatch(editor, /useTranslation\(\["derush"/);
  assert.match(settings, /<ShortcutEditor\s+ns="reference"/);
});

test('every board shortcut label exists in the reference namespace', () => {
  const fr = JSON.parse(read('src/locales/fr/reference.json'));
  const keys = [...shared.matchAll(/labelKey: "shortcut\.(\w+)"/g)].map((m) => m[1]);
  assert.ok(keys.length >= 29, `expected the full command list, got ${keys.length}`);
  for (const key of keys) {
    assert.equal(typeof fr.shortcut[key], 'string', `shortcut.${key} is missing from fr/reference.json`);
  }
});

test('an action can be unbound, and the unbinding survives a reload', () => {
  assert.match(editor, /if \(e\.key === "Delete" \|\| e\.key === "Backspace"\) \{/);
  assert.match(editor, /onChange\(\{ \.\.\.keys, \[capturing\]: "" \}\)/);
  // mergeKeys ne doit PAS traiter la chaîne vide comme une absence.
  assert.match(lib, /if \(action in defaults && typeof combo === "string"\) out\[action\] = combo;/);
});

test('one frame step drives both the film strip and a video player', () => {
  const hook = read('src/components/reference/useBoardShortcuts.ts');
  // Une seule paire d'actions pour les deux : la pellicule saute d'un index, le lecteur de 1/fps.
  assert.match(shared, /\{ action: "prevFrame", labelKey: "shortcut\.prevFrame", combo: "," \}/);
  assert.doesNotMatch(shared, /seqPrevFrame|seqNextFrame/);
  assert.match(hook, /const clips = picked\.filter\(\(it\) => it\.kind === "video" \|\| it\.kind === "youtube"\)/);
  assert.match(hook, /for \(const it of clips\) stepFrame\(it, dir\)/);
  // La cadence EXACTE vient de ffprobe, et le pas se fait a l'arret.
  const step = read('src/components/reference/boardFrameStep.ts');
  assert.match(step, /nr\.reference\.playInfo\(item\.ref\)/);
  assert.match(step, /patchItem\(item\.id, \{ playMode: "off" \}, false\)/);
  assert.match(step, /playerSeek\(item\.id, at \+ dir \/ fpsFor\(item\)/);
  assert.match(read('core/rpc.js'), /"reference:playInfo": \(\[filePath\]\) => ffmpeg\.playInfo\(filePath\)/);
});

test('the command list only carries actions this product has', () => {
  const actions = [...shared.matchAll(/\{ action: "(\w+)"/g)].map((m) => m[1]);
  // Chaque action doit etre traitee par le hook (ou par une callback de fenetre).
  const hook = read('src/components/reference/useBoardShortcuts.ts');
  for (const a of actions) {
    assert.match(hook, new RegExp(`case "${a}"`), `${a} has no handler`);
  }
});

test('transparent-to-mouse is a rebindable action, not a frozen one', () => {
  assert.match(shared, /\{ action: "toggleMouseThrough", labelKey: "shortcut\.toggleMouseThrough", combo: "Shift\+M" \}/);
  assert.match(read('src/components/reference/useBoardShortcuts.ts'), /case "toggleMouseThrough":/);
  // La barre d'outils déclenche la MÊME bascule, avertissement compris.
  assert.match(read('src/components/reference/Toolbar.tsx'), /action="toggleMouseThrough"/);
  assert.match(read('src/components/reference/boardMouseThrough.ts'), /export function askMouseThrough\(\): void/);
});

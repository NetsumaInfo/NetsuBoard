// Périmètre de la translucidité du board : le fond suit toujours le curseur, l'INTERFACE reste
// opaque par défaut (une barre de titre translucide sur un bureau chargé ne se lit plus), et le
// cadre de la zone de pose suit le fond.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const css = read('src/index.css');
const board = read('src/components/reference/ReferenceBoard.tsx');
const prefs = read('src/components/reference/boardPrefs.ts');

test('the interface keeps an opaque surface unless it is told to follow', () => {
  assert.match(prefs, /seeThroughShell: false,/);
  assert.match(css, /html\.nr-see-through:not\(\.nr-see-through-shell\) \.nr-chrome \{/);
  assert.match(css, /html\.nr-see-through:not\(\.nr-see-through-shell\) \.nr-chrome-page \{/);
  assert.match(board, /root\.classList\.toggle\("nr-see-through-shell", on && seeThroughShell\)/);
});

test('the title bar and every floating panel are tagged as interface', () => {
  assert.match(read('src/App.tsx'), /nr-chrome-page flex h-9/);
  assert.match(read('src/components/reference/ReferenceWindow.tsx'), /nr-chrome-page group flex h-6/);
  for (const file of ['Toolbar.tsx', 'DrawToolbar.tsx', 'Inspector.tsx', 'SequencePlayer.tsx']) {
    assert.match(read(`src/components/reference/${file}`), /nr-chrome/, `${file} paints a surface over the board`);
  }
});

test('the placement frame follows the background opacity by default', () => {
  assert.match(prefs, /seeThroughPlaceFrame: true,/);
  assert.match(board, /opacity: seeThroughPlaceFrame \? background\.opacity : 1,/);
});

test('the pin shows the window is held above by the transparent mode', () => {
  const through = read('src/components/reference/boardMouseThrough.ts');
  const shell = read('src/store/shell.ts');
  const controls = read('src/components/WindowControls.tsx');
  // Le mode tient la fenetre au-dessus ET le dit : sinon l'epingle ment sur ce que fait la fenetre.
  assert.match(shell, /onTopHold: boolean;/);
  assert.match(through, /app\.setOnTopHold\(on\)/);
  assert.match(controls, /const onTop = pinned \|\| onTopHold;/);
  assert.match(controls, /aria-pressed=\{onTop\}/);
  // L'epingle posee pendant le mode gagne : la sortie ne doit pas la retirer.
  assert.match(through, /\} else if \(!app\.pinned\) \{/);
  for (const lang of ['fr', 'en', 'de', 'es', 'ja', 'zh']) {
    const j = JSON.parse(read(`src/locales/${lang}/shell.json`));
    assert.equal(typeof j.windowControls.pinnedByMode, 'string', `${lang} misses windowControls.pinnedByMode`);
  }
});

test('both scope switches are translated everywhere', () => {
  for (const lang of ['fr', 'en', 'de', 'es', 'ja', 'zh']) {
    const s = JSON.parse(read(`src/locales/${lang}/reference.json`)).settings;
    for (const key of ['seeThroughScope', 'seeThroughShell', 'seeThroughPlaceFrame', 'bgOpacity']) {
      assert.equal(typeof s[key], 'string', `${lang} misses settings.${key}`);
    }
  }
});

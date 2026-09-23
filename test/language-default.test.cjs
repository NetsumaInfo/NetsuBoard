// The interface language a user gets before choosing one. French is the source language of the
// catalogues, not a default: a user whose system language is unsupported reads English, and one
// who lists several languages gets the first supported one, not only the first entry.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const { pickLanguage, language, SUPPORTED } = require(path.join(ROOT, 'core', 'i18n.js'));
const { CONFIG } = require(path.join(ROOT, 'core', 'config.js'));
const { setupErrorText } = require(path.join(ROOT, 'core', 'setup.js'));

function loadRendererPick() {
  const code = ts.transpileModule(fs.readFileSync(path.join(ROOT, 'src/i18n/pickLanguage.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const result = {};
  new Function('exports', code)(result);
  return result.pickLanguage;
}

test('the first supported language of the preference list wins', () => {
  const renderer = loadRendererPick();
  for (const pick of [(tags) => pickLanguage(tags), (tags) => renderer(tags, SUPPORTED)]) {
    assert.equal(pick(['ja-JP']), 'ja');
    assert.equal(pick(['pt-BR', 'ko', 'de-AT']), 'de');
    assert.equal(pick(['zh_CN']), 'zh');
    assert.equal(pick(['pt-BR', 'ko']), null);
    assert.equal(pick([null, undefined, '']), null);
  }
});

test('the core language is the saved choice, never French by default', () => {
  const before = CONFIG.lang;
  try {
    CONFIG.lang = 'ja';
    assert.equal(language(), 'ja');
    CONFIG.lang = 'pt';
    const os = pickLanguage([Intl.DateTimeFormat().resolvedOptions().locale]);
    assert.equal(language(), os || 'en');
  } finally {
    CONFIG.lang = before;
  }
});

test('setup.ps1 errors are shown in the interface language', () => {
  const before = CONFIG.lang;
  try {
    CONFIG.lang = 'ja';
    assert.equal(setupErrorText('#ffmpegMissing|ffmpeg was not found after extraction|'), '展開後に ffmpeg が見つかりません');
    assert.equal(setupErrorText('#ytdlpMissing|x|接続がタイムアウトしました'), 'ダウンロード後に yt-dlp が見つかりません：接続がタイムアウトしました');
    assert.equal(setupErrorText('#unknownKey|Fallback label|'), 'Fallback label');
    assert.equal(setupErrorText('NR_SETUP_HOME is missing'), 'NR_SETUP_HOME is missing');
  } finally {
    CONFIG.lang = before;
  }
});

// Numbers a person reads follow the interface language, and numbers a person types parse whatever
// decimal mark their keyboard and habits use: "1,5" is one and a half, not one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(language) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', 'src/lib/utils.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const deps = {
    clsx: { clsx: () => '' },
    'tailwind-merge': { twMerge: () => '' },
    '@/i18n': { default: { language } },
  };
  const result = {};
  new Function('exports', 'require', code)(result, (id) => deps[id] ?? {});
  return result;
}

test('typed numbers accept a decimal comma or a decimal point', () => {
  const { parseDecimal } = load('en');
  assert.equal(parseDecimal('1,5'), 1.5);
  assert.equal(parseDecimal('1.5'), 1.5);
  assert.equal(parseDecimal(' 12 '), 12);
  assert.equal(parseDecimal('１．５'), 1.5);
  assert.equal(parseDecimal('−2,25'), -2.25);
  assert.equal(parseDecimal('1.234,5'), 1234.5);
  assert.equal(parseDecimal('1,234.5'), 1234.5);
  assert.equal(parseDecimal('1 024'), 1024);
  assert.equal(parseDecimal(',5'), 0.5);
  assert.equal(parseDecimal('24 fps'), 24);
  assert.ok(Number.isNaN(parseDecimal('')));
  assert.ok(Number.isNaN(parseDecimal('abc')));
});

test('displayed numbers use the interface language', () => {
  assert.equal(load('fr').fmtNumber(1.5), '1,5');
  assert.equal(load('en').fmtNumber(1.5), '1.5');
  assert.equal(load('de').fmtSeconds(1.25), '1,3 Sek.');
  assert.equal(load('ja').fmtSeconds(1.5), '1.5s');
  assert.equal(load('fr').fmtPercent(0.5), '50 %');
  assert.equal(load('en').fmtPercent(0.5), '50%');
});

test('an unknown interface language formats in English, not French', () => {
  assert.equal(load('').uiLocale(), 'en');
  assert.equal(load('').fmtNumber(1.5), '1.5');
});

test('what a field shows parses back to the same value in every language', () => {
  for (const language of ['fr', 'en', 'es', 'de', 'ja', 'zh']) {
    const { fmtNumber, parseDecimal } = load(language);
    for (const value of [0.1, 1.5, 12, 2048, 65536]) {
      assert.equal(parseDecimal(fmtNumber(value, { maximumFractionDigits: 6, useGrouping: false })), value, `${language} ${value}`);
    }
  }
});

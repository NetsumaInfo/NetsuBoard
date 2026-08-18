const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function sourceFiles(relativeDirectory, extension) {
  const directory = path.join(root, relativeDirectory);
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => read(path.join(relativeDirectory, entry.name)))
    .join("\n");
}

test("collaboration docs and native command surface contain no prototype escape hatches", () => {
  const native = sourceFiles("src-tauri/src/collab", ".rs");
  const renderer = sourceFiles("src/lib/collab", ".ts");

  assert.doesNotMatch(native, /implemented so far/i);
  assert.doesNotMatch(`${native}\n${renderer}`, /collab_key_wrap|collab_net_allow/);
  assert.doesNotMatch(renderer, /nb\.collab\.project/);
  assert.match(read("AGENTS.md"), /docs\/collab\.md/);
  assert.match(read("docs/collab.md"), /Rust `CollabService` \+ Loro \+ SQLite/);
});

test("collaboration security and operating contracts remain discoverable", () => {
  const security = read("SECURITY.md");
  const threatModel = read("NetsuBoard-threat-model.md");
  const distribution = read("docs/distribution.md");

  assert.match(security, /native collaboration service/i);
  assert.match(threatModel, /trusted renderer/i);
  assert.match(threatModel, /^# NetsuBoard threat model/m);
  assert.match(threatModel, /^### Data flows and trust boundaries/m);
  assert.match(threatModel, /^## Threat model table/m);
  assert.match(distribution, /VITE_CONVEX_URL/);
  assert.match(read("convex/schema.ts"), /revokedDevices/);
  assert.match(read("convex/devices.ts"), /this device identity has been revoked/);
});

test("all six locales expose collaboration copy", () => {
  for (const locale of ["fr", "en", "de", "es", "ja", "zh"]) {
    const reference = JSON.parse(read(`src/locales/${locale}/reference.json`));
    const settings = JSON.parse(read(`src/locales/${locale}/settings.json`));
    assert.ok(reference.collab, `${locale} reference.collab is missing`);
    assert.ok(settings.collab, `${locale} settings.collab is missing`);
  }
});

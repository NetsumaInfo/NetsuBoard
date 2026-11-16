// AI agents on the real web: what an agent passes to add_media as `urls` goes through the core's
// own downloaders (reference:fetchAsset for a file, reference:resolveMedia for a page). Uses the
// network, so it runs only with NB_NET_TESTS=1:
//   NB_NET_TESTS=1 node --test test/agent-web.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const PORT = 43200 + Math.floor(Math.random() * 8);
const skip = process.env.NB_NET_TESTS !== '1' && 'network test: set NB_NET_TESTS=1';

// Public-domain works on Wikimedia Commons (Special:FilePath redirects to the file itself).
const FILES = [
  'Nine-Dragons1.jpg',
  'Friedrich-Johann-Justin-Bertuch_Mythical-Creature-Dragon_1806.jpg',
  // Large originals Wikimedia refuses at full size (429): they arrive as 1920 px thumbnails.
  'Neuschwanstein_Castle_LOC_print.jpg',
  'Chambord_Castle_Northwest_facade.jpg',
].map((f) => `https://commons.wikimedia.org/wiki/Special:FilePath/${f}`);
const PAGES = ['https://commons.wikimedia.org/wiki/File:Nine-Dragons1.jpg'];

function rpc(channel, args = []) {
  const body = JSON.stringify({ channel, args });
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/rpc', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const isImage = (file) => {
  const head = fs.readFileSync(file).subarray(0, 12);
  return (head[0] === 0xff && head[1] === 0xd8) || head.subarray(0, 4).toString('latin1') === '\x89PNG' || head.subarray(8, 12).toString('latin1') === 'WEBP';
};

test('images found on the web land on disk through the core', { skip, timeout: 120000 }, async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-web-'));
  const core = spawn(process.execPath, [path.join(root, 'core', 'server.js')], {
    env: { ...process.env, NR_HOME: home, NR_CORE_PORT: String(PORT) }, stdio: 'ignore',
  });
  t.after(() => { core.kill(); try { fs.rmSync(home, { recursive: true, force: true }); } catch {} });
  for (let i = 0; i < 100; i++) {
    try { if ((await rpc('agent:status')).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }

  for (const url of FILES) {
    const res = await rpc('reference:fetchAsset', [url, {}]);
    assert.equal(res.ok, true, url);
    const out = res.result;
    assert.equal(out.ok, true, `${url}: ${out.error}`);
    const file = out.path || out.ref;
    assert.ok(file && fs.existsSync(file), `${url}: no file (${JSON.stringify(out)})`);
    assert.ok(isImage(file), `${url}: not an image`);
  }
  for (const url of PAGES) {
    const res = await rpc('reference:resolveMedia', [url, {}]);
    assert.equal(res.result?.ok, true, `${url}: ${res.result?.error}`);
  }
  const bad = await rpc('reference:fetchAsset', ['https://commons.wikimedia.org/wiki/Special:FilePath/Does-not-exist-netsuboard.jpg', {}]);
  assert.equal(bad.result.ok, false);
});

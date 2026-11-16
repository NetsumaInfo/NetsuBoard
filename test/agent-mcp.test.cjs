// AI agents: the MCP stdio server (core/mcp.js) and the core relay (core/agent.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { TOOL_DEFS, toContent } = require('../core/mcp.js');
const { createAgentRelay, ENDPOINT_FILE } = require('../core/agent.js');

test('every MCP tool has an implementation on the board side, and the reverse', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/reference/agentTools.ts'), 'utf8');
  const body = source.slice(source.indexOf('const TOOLS: Record<string, Tool> = {'));
  const implemented = new Set([...body.matchAll(/^  ([a-z_]+): /gm)].map((m) => m[1]));
  const declared = new Set(TOOL_DEFS.map((t) => t.name));
  assert.deepEqual([...declared].filter((n) => !implemented.has(n)), [], 'declared without implementation');
  assert.deepEqual([...implemented].filter((n) => !declared.has(n)), [], 'implemented without declaration');
});

test('tool schemas are valid MCP input schemas', () => {
  for (const tool of TOOL_DEFS) {
    assert.equal(tool.inputSchema.type, 'object', tool.name);
    assert.ok(tool.description.length > 10, tool.name);
    for (const req of tool.inputSchema.required || []) assert.ok(req in tool.inputSchema.properties, `${tool.name}.${req}`);
  }
});

test('answers become MCP content, images first', () => {
  const shot = toContent({ ok: true, result: { width: 2 }, image: { data: 'AAA', mimeType: 'image/png' } });
  assert.equal(shot.content[0].type, 'image');
  assert.equal(shot.isError, false);
  const err = toContent({ ok: false, error: 'nope' });
  assert.equal(err.isError, true);
  assert.match(err.content[0].text, /nope/);
});

test('the relay refuses calls while off, with a bad secret, or without a window', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-agent-'));
  let clients = 0;
  const sent = [];
  const relay = createAgentRelay({ home, broadcast: (ch, p) => sent.push([ch, p]), clientCount: () => clients });
  relay.publish(43117);
  const { secret, port } = JSON.parse(fs.readFileSync(path.join(home, ENDPOINT_FILE), 'utf8'));
  assert.equal(port, 43117);

  assert.match((await relay.call(secret, 'board_state', {})).error, /off/);
  relay.setEnabled(true);
  assert.match((await relay.call('wrong', 'board_state', {})).error, /secret/);
  assert.match((await relay.call(secret, 'board_state', {})).error, /window/);

  clients = 1;
  const pending = relay.call(secret, 'board_state', { a: 1 });
  const [, payload] = sent.find(([ch]) => ch === 'agent:call');
  assert.equal(payload.tool, 'board_state');
  assert.equal(relay.reply(payload.id, { ok: true, result: 42 }), true);
  assert.deepEqual(await pending, { ok: true, result: 42 });
  assert.equal(relay.reply(payload.id, { ok: true }), false);

  const dropped = relay.call(secret, 'list_items', {});
  relay.setEnabled(false);
  assert.match((await dropped).error, /turned off/);
  fs.rmSync(home, { recursive: true, force: true });
});

test('a rate-limited download is tried once more after Retry-After, then gives up', async () => {
  const http = require('node:http');
  const { downloadBytes } = require('../core/reference.js');
  let hits = 0;
  let mode = 'once';
  const srv = http.createServer((req, res) => {
    hits++;
    if (mode === 'always' || hits === 1) { res.writeHead(429, { 'Retry-After': '0' }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end('png');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/a.png`;
  try {
    const got = await downloadBytes(url);
    assert.equal(got.buf.toString(), 'png');
    assert.equal(hits, 2);
    hits = 0;
    mode = 'always';
    await assert.rejects(downloadBytes(url), /HTTP 429/);
    assert.equal(hits, 2);
  } finally {
    srv.close();
  }
});

test('a Wikimedia original refused for its size falls back to the 1920 px thumbnail', () => {
  const { wikimediaThumb } = require('../core/reference.js');
  const at = (s) => wikimediaThumb(new URL(s));
  assert.equal(at('https://upload.wikimedia.org/wikipedia/commons/4/47/Chambord.jpg?utm_source=x'),
    'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/Chambord.jpg/1920px-Chambord.jpg');
  assert.equal(at('https://upload.wikimedia.org/wikipedia/en/a/ab/Logo.svg'),
    'https://upload.wikimedia.org/wikipedia/en/thumb/a/ab/Logo.svg/1920px-Logo.svg.png');
  assert.equal(at('https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/C.jpg/1920px-C.jpg'), null);
  assert.equal(at('https://upload.wikimedia.org/wikipedia/commons/4/47/Book.pdf'), null);
  assert.equal(at('https://example.org/wikipedia/commons/4/47/C.jpg'), null);
});

test('the compound tools and new options are declared', () => {
  const by = Object.fromEntries(TOOL_DEFS.map((t) => [t.name, t]));
  for (const name of ['batch', 'checkpoint', 'style_items', 'timeline', 'relayout_frame', 'text_fit']) assert.ok(by[name], name);
  assert.deepEqual(by.batch.inputSchema.required, ['ops']);
  assert.deepEqual(by.checkpoint.inputSchema.properties.action.enum, ['save', 'restore', 'list', 'drop']);
  assert.deepEqual(by.text_fit.inputSchema.properties.action.enum, ['same_size', 'fit_box']);
  assert.deepEqual(by.style_items.inputSchema.properties.theme.enum, ['dark', 'pastel', 'neon']);
  assert.ok(by.scenes.inputSchema.properties.action.enum.includes('backup'));
  assert.deepEqual(by.update_items.inputSchema.required, []);
  for (const key of ['ids', 'patch', 'fit']) assert.ok(key in by.update_items.inputSchema.properties, key);
  for (const key of ['fit', 'valign', 'padding']) assert.ok(key in by.add_text.inputSchema.properties, key);
  assert.ok(!('fit' in by.style_items.inputSchema.properties));
});

test('the server instructions point to batch, checkpoints, backups and fit', () => {
  const lines = [];
  const write = process.stdout.write;
  process.stdout.write = (chunk) => { lines.push(String(chunk)); return true; };
  try {
    return require('../core/mcp.js').handle({ id: 1, method: 'initialize', params: {} }).then(() => {
      process.stdout.write = write;
      const { instructions } = JSON.parse(lines.join('')).result;
      for (const word of ['batch', 'checkpoint', 'scenes › backup', 'fit:true']) assert.ok(instructions.includes(word), word);
    });
  } finally {
    process.stdout.write = write;
  }
});

test('a .netsu backup copies the file and its journals into a dated sibling folder', async () => {
  const { backupProject } = require('../core/netsu.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-backup-'));
  try {
    const file = path.join(dir, 'board.netsu');
    fs.writeFileSync(file, 'db');
    fs.writeFileSync(`${file}-wal`, 'wal');
    const res = await backupProject(file);
    assert.equal(res.ok, true);
    assert.match(path.basename(res.dir), /^backup-board-\d{4}-\d{2}-\d{2}-\d{4}$/);
    assert.equal(path.dirname(res.dir), dir);
    assert.deepEqual(fs.readdirSync(res.dir).sort(), ['board.netsu', 'board.netsu-wal']);
    assert.equal(fs.readFileSync(path.join(res.dir, 'board.netsu-wal'), 'utf8'), 'wal');
    assert.equal(fs.readFileSync(file, 'utf8'), 'db');
    assert.equal((await backupProject(path.join(dir, 'missing.netsu'))).ok, false);
    assert.equal((await backupProject(path.join(dir, 'notes.txt'))).ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

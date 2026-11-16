// AI agents end to end: a real core (own port and home), a stand-in renderer on the SSE stream, and
// the real core/mcp.js spoken to over stdio. Holds the whole path an agent call takes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const PORT = 43190 + Math.floor(Math.random() * 8);

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

async function waitFor(check, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await check()) return true; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('timed out');
}

// Stand-in renderer: answers agent:call over SSE like useAgentBridge does.
function fakeRenderer(answer) {
  const req = http.get({ host: '127.0.0.1', port: PORT, path: '/events' }, (res) => {
    let buf = '';
    res.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (!line.startsWith('data: ')) continue;
        const { channel, payload } = JSON.parse(line.slice(6));
        if (channel === 'agent:call') void rpc('agent:reply', [payload.id, answer(payload)]);
      }
    });
  });
  return () => req.destroy();
}

function mcpClient(home) {
  const child = spawn(process.execPath, [path.join(root, 'core', 'mcp.js')], { env: { ...process.env, NR_HOME: home }, stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = new Map();
  let buf = '';
  let next = 1;
  child.stdout.on('data', (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      waiting.get(msg.id)?.(msg);
      waiting.delete(msg.id);
    }
  });
  const request = (method, params) => new Promise((resolve) => {
    const id = next++;
    waiting.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  return { request, close: () => child.kill() };
}

test('an MCP tool call travels mcp.js → core → board and back', { timeout: 60000 }, async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-e2e-'));
  const core = spawn(process.execPath, [path.join(root, 'core', 'server.js')], {
    env: { ...process.env, NR_HOME: home, NR_CORE_PORT: String(PORT) }, stdio: 'ignore',
  });
  let stopRenderer = () => {};
  const mcp = mcpClient(home);
  t.after(() => {
    stopRenderer();
    mcp.close();
    core.kill();
    try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
  });

  await waitFor(() => fs.existsSync(path.join(home, 'agent-endpoint.json')));
  await waitFor(async () => (await rpc('agent:status')).ok);

  const init = await mcp.request('initialize', { protocolVersion: '2025-06-18' });
  assert.equal(init.result.serverInfo.name, 'netsuboard');
  const list = await mcp.request('tools/list');
  assert.ok(list.result.tools.some((tool) => tool.name === 'add_media'));

  // Off by default: the board is never reached.
  const off = await mcp.request('tools/call', { name: 'board_state', arguments: {} });
  assert.equal(off.result.isError, true);
  assert.match(off.result.content[0].text, /off/);

  await rpc('agent:setEnabled', [true]);
  const noWindow = await mcp.request('tools/call', { name: 'board_state', arguments: {} });
  assert.match(noWindow.result.content[0].text, /not open/);

  const seen = [];
  stopRenderer = fakeRenderer((call) => {
    seen.push(call);
    return call.tool === 'screenshot'
      ? { ok: true, result: { width: 1 }, image: { data: 'QUJD', mimeType: 'image/png' } }
      : { ok: true, result: { name: 'Board', echo: call.args } };
  });
  await waitFor(async () => (await rpc('agent:status')).result.renderer);

  const state = await mcp.request('tools/call', { name: 'move_items', arguments: { ids: ['a'], dx: 5 } });
  assert.equal(state.result.isError, false);
  assert.deepEqual(JSON.parse(state.result.content[0].text), { name: 'Board', echo: { ids: ['a'], dx: 5 } });
  assert.deepEqual(seen.map((c) => c.tool), ['move_items']);

  const shot = await mcp.request('tools/call', { name: 'screenshot', arguments: {} });
  assert.deepEqual(shot.result.content[0], { type: 'image', data: 'QUJD', mimeType: 'image/png' });

  const unknown = await mcp.request('tools/call', { name: 'rm_rf', arguments: {} });
  assert.equal(unknown.error.code, -32602);
});

// AI agent relay: an MCP client (Claude Code, Codex…) drives the board through core/mcp.js, which
// calls `agent:call` here. The board state lives in the renderer, so the call is broadcast over SSE
// and the renderer answers with `agent:reply`: every edit then goes through the same store as a
// mouse edit — undo, autosave and collaboration sync included.
//
// The relay is OFF until the renderer turns it on (Settings › AI agents). A per-session secret,
// written next to core-port.json, keeps a stray local process from driving the board unannounced.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const CALL_TIMEOUT_MS = 120000;
const ENDPOINT_FILE = "agent-endpoint.json";

function createAgentRelay({ home, broadcast, clientCount }) {
  const secret = crypto.randomBytes(24).toString("hex");
  const pending = new Map(); // id → { resolve, timer }
  let enabled = false;
  let lastCall = 0;

  function publish(port) {
    try {
      fs.mkdirSync(home, { recursive: true });
      fs.writeFileSync(path.join(home, ENDPOINT_FILE), JSON.stringify({ port, secret, pid: process.pid }));
    } catch (error) {
      console.warn("core: agent endpoint not published", String(error));
    }
  }

  function status() {
    return {
      enabled,
      renderer: clientCount() > 0,
      lastCall,
      node: process.execPath,
      script: path.join(__dirname, "mcp.js"),
    };
  }

  function setEnabled(on) {
    enabled = !!on;
    if (!enabled) {
      for (const [id, p] of pending) {
        clearTimeout(p.timer);
        p.resolve({ ok: false, error: "AI agents were turned off in NetsuBoard." });
        pending.delete(id);
      }
    }
    broadcast("agent:status", status());
    return status();
  }

  function call(given, tool, args) {
    if (given !== secret) return { ok: false, error: "Invalid agent secret. Restart the MCP server." };
    if (!enabled) return { ok: false, error: "AI agents are off. Turn them on in NetsuBoard › Settings › AI agents." };
    if (clientCount() === 0) return { ok: false, error: "The NetsuBoard window is not open." };
    if (typeof tool !== "string" || !tool) return { ok: false, error: "Missing tool name." };
    lastCall = Date.now();
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, error: `The board did not answer within ${CALL_TIMEOUT_MS / 1000} s.` });
      }, CALL_TIMEOUT_MS);
      pending.set(id, { resolve, timer });
      broadcast("agent:call", { id, tool, args: args && typeof args === "object" ? args : {} });
    });
  }

  function reply(id, result) {
    const p = pending.get(id);
    if (!p) return false;
    clearTimeout(p.timer);
    pending.delete(id);
    p.resolve(result && typeof result === "object" ? result : { ok: false, error: "Empty answer from the board." });
    return true;
  }

  return { publish, status, setEnabled, call, reply };
}

module.exports = { createAgentRelay, ENDPOINT_FILE };

// Browser-to-loopback boundary for the Node control plane. CORS is not authentication, so the
// request itself is refused before RPC/SSE handling when either Host or Origin is untrusted.

'use strict';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const TAURI_ORIGINS = new Set([
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
]);

function hostName(headers) {
  return String(headers.host || '').replace(/:\d+$/, '').toLowerCase();
}

function rendererOriginAllowed(origin) {
  if (!origin) return true; // native and local non-browser clients do not send Origin
  if (TAURI_ORIGINS.has(String(origin))) return true;
  try {
    const parsed = new URL(String(origin));
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
  } catch (_) {
    return false;
  }
}

function controlRequestAllowed(headers) {
  return LOOPBACK_HOSTS.has(hostName(headers)) && rendererOriginAllowed(headers.origin);
}

module.exports = { controlRequestAllowed, rendererOriginAllowed };

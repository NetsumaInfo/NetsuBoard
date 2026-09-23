// @ts-check
// core/ytdlpUpdate.js
// yt-dlp is the only runtime dependency that ROTS. ffmpeg and the GLSL shaders keep working for
// years; yt-dlp's extractors are broken by the platforms themselves every few weeks. It is fetched
// once, by `scripts/setup.ps1`, from `releases/latest` — after that nothing ever touches it, so an
// install left alone slowly loses the half of a reference board that arrives through a link, and
// the only cure was to reinstall the application.
//
// The automatic refresh is anchored to the APPLICATION update rather than to a timer or to every
// launch: a build that has just replaced itself is the one moment where new code is already
// expected, and it caps the cost at one check per release. `yt-dlp -U` asks GitHub for the latest
// stable and returns in a second when it is already current — the ~18 MB is only paid on a real
// version gap. The version that was checked is written to nr.config.json, so a boot of the same
// build does nothing at all.
//
// That anchor has one hole: an installation nobody updates for months also stops refreshing yt-dlp,
// which is exactly when its extractors rot. `ytDlpStatus()` and `updateYtDlpNow()` open the second
// door — Settings › Updates shows the provisioned version against the latest GitHub release, and
// updates the tool on its own, without waiting for the next application release.

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { execFile } = require('node:child_process');
const { CONFIG, DETECT_ENV, saveConfig, ytDlpCommand } = require('./config');
const { t } = require('./i18n');

// Downloading a new binary over a metered connection must never hold the boot, and a machine behind
// a proxy that swallows the request must not hang a process either.
const UPDATE_TIMEOUT_MS = 5 * 60 * 1000;
// `--version` is one line off a cold executable; on Windows that still means a process start.
const VERSION_TIMEOUT_MS = 30 * 1000;
// The published-version probe is cosmetic: it must never make the panel wait.
const PROBE_TIMEOUT_MS = 8 * 1000;

// `-U` updates within the CHANNEL the binary was built for, so the panel has to ask the same
// repository or it compares across channels: the setup fetches the stable `releases/latest`, but an
// install can end up on a nightly, and a nightly is always ahead of the newest stable — which read
// as "up to date" forever and never offered the update the user came for.
// The channel is read from the version shape, which is how yt-dlp itself spells it: stable is
// `YYYY.MM.DD`, nightly and master add a `.HHMMSS` fourth segment. Asking the binary directly costs
// a full extraction run (`--version` alone prints no debug header), which this panel will not pay.
const STABLE_REPO = 'yt-dlp/yt-dlp';
const NIGHTLY_REPO = 'yt-dlp/yt-dlp-nightly-builds';
function releasesUrl(installed) {
  const nightly = String(installed || '').split('.').length > 3;
  return `https://api.github.com/repos/${nightly ? NIGHTLY_REPO : STABLE_REPO}/releases/latest`;
}

/** Application version: the repository package.json in dev, the staged one in a bundle. */
function appVersion() {
  const roots = [process.env.NR_RESOURCE_DIR, path.join(__dirname, '..')].filter(Boolean);
  for (const root of roots) {
    try { return String(JSON.parse(fs.readFileSync(path.join(String(root), 'package.json'), 'utf8')).version || ''); }
    catch (_) { /* next candidate */ }
  }
  return '';
}

// Only the standalone executable this product provisioned is ours to replace. The two fallbacks of
// `ytDlpCommand()` — a `python -m yt_dlp` module and a `yt-dlp` found on PATH — belong to whoever
// installed them: `-U` refuses on a pip install anyway, and silently upgrading a tool the user put
// on their own PATH would be overreach.
function ownedBinary() {
  const cmd = ytDlpCommand();
  if (cmd.args.length || !path.isAbsolute(cmd.bin)) return null;
  try { return fs.existsSync(cmd.bin) ? cmd.bin : null; } catch (_) { return null; }
}

/** One child process, never throwing: every caller here reads a failure as "unknown", not a crash. */
function run(bin, args, timeout) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, env: DETECT_ENV, windowsHide: true },
      (error, stdout, stderr) => resolve({ error, out: `${stdout || ''}${stderr || ''}`.trim() }));
  });
}

// yt-dlp spells its date version zero-padded (2026.08.19) while a registry normalises the same
// release to 2026.8.19. Two spellings of ONE version: comparing the raw strings claimed an update was
// available against the build already installed. Everything below is canonicalised before it is
// compared or shown, so the panel can never display two versions that are the same release.
function canonicalVersion(value) {
  const text = String(value || '').trim();
  const match = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(.*)$/.exec(text);
  return match ? `${match[1]}.${match[2].padStart(2, '0')}.${match[3].padStart(2, '0')}${match[4]}` : text;
}

/**
 * Is `version` strictly OLDER than `latest`? An ORDER, not an inequality: a nightly carries a fourth
 * timestamp segment (2026.08.30.232658) and is newer than the latest stable (2026.08.19), which a
 * plain `!==` read as "an update is available" and offered to downgrade. A segment that is not a
 * number stops the comparison and answers NO: an update is never invented out of a version this
 * cannot read.
 */
function isOlder(version, latest) {
  const left = String(version || '').split('.');
  const right = String(latest || '').split('.');
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const a = left[i] === undefined ? 0 : Number(left[i]);
    const b = right[i] === undefined ? 0 : Number(right[i]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    if (a !== b) return a < b;
  }
  return false;
}

// yt-dlp versions are dates (2026.07.04), sometimes with a build suffix. Anything else on the line
// is a warning the tool printed on its way up, so the shape is matched rather than the position.
const VERSION_RE = /\b(\d{4}\.\d{1,2}\.\d{1,2}(?:\.\d+)?(?:[.-]\w+)?)\b/;

/**
 * Version of the binary actually on disk. Reads the executable this product owns AND, unlike the
 * update path, the fallbacks: the panel has to be able to say which yt-dlp resolves a link, even
 * when it is one this product must not replace.
 * @returns {Promise<string|null>}
 */
async function installedVersion() {
  const cmd = ytDlpCommand();
  const { error, out } = await run(cmd.bin, [...cmd.args, '--version'], VERSION_TIMEOUT_MS);
  if (error && !out) return null;
  const match = VERSION_RE.exec(out);
  return match ? canonicalVersion(match[1]) : null;
}

/**
 * Tag of the latest release ON THE INSTALLED BINARY'S CHANNEL, or null. Fails soft on every count —
 * no network, a proxy, a rate limit or a changed payload all mean "unknown", never an error the
 * panel has to show.
 * @param {string|null} installed
 * @returns {Promise<string|null>}
 */
function publishedVersion(installed) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    let request;
    try {
      // GitHub rejects an API request without a User-Agent; the product name is the honest one.
      const headers = { accept: 'application/vnd.github+json', 'user-agent': 'NetsuBoard' };
      request = https.get(releasesUrl(installed), { headers, timeout: PROBE_TIMEOUT_MS }, (res) => {
        if (res.statusCode !== 200) { res.resume(); return done(null); }
        let body = '';
        res.setEncoding('utf8');
        // A redirect or an error page can be arbitrarily large; the payload we want is a few KB.
        res.on('data', (chunk) => { body += chunk; if (body.length > 2 * 1024 * 1024) { res.destroy(); done(null); } });
        res.on('end', () => {
          try { done(canonicalVersion(String(JSON.parse(body)?.tag_name || '').replace(/^v/, '')) || null); }
          catch (_) { done(null); }
        });
        res.on('error', () => done(null));
      });
    } catch (_) { return done(null); }
    request.on('timeout', () => { request.destroy(); done(null); });
    request.on('error', () => done(null));
  });
}

/**
 * Updates yt-dlp once per application version. Never throws and never blocks: a failure leaves the
 * marker unwritten, so the next boot simply tries again — which is what carries the refresh over
 * for someone who was offline the day they updated.
 * @returns {Promise<{ updated: boolean, reason?: string, version?: string }>}
 */
async function refreshYtDlpForAppVersion() {
  const version = appVersion();
  if (!version) return { updated: false, reason: 'unknown version' };
  if (CONFIG.ytDlpCheckedFor === version) return { updated: false, reason: 'already checked' };

  const bin = ownedBinary();
  if (!bin) return { updated: false, reason: 'yt-dlp not provisioned' };

  const result = await run(bin, ['-U'], UPDATE_TIMEOUT_MS);
  if (result.error) {
    console.warn(`yt-dlp: update failed (${String(result.error.message || result.error)})`);
    return { updated: false, reason: 'failed' };
  }
  // `-U` prints either "yt-dlp is up to date" or the version it moved to; both mean the binary is
  // now current for this application version, so the marker is written in either case.
  // The boot path deliberately spawns nothing else: reading the version back would double the cost
  // of a refresh that runs while the application is starting. The panel reads it on demand instead.
  saveConfig({ ytDlpCheckedFor: version, ytDlpCheckedAt: Date.now() });
  const line = result.out.split(/\r?\n/).filter(Boolean).pop() || 'up to date';
  console.log(`yt-dlp: ${line}`);
  return { updated: true, version };
}

/**
 * Read-only snapshot for Settings › Updates. Spawns `--version` (local, cheap) and, unless asked not
 * to, probes GitHub. Downloads nothing.
 * @param {{ remote?: boolean }} [options]
 * @returns {Promise<{ ok: true, available: boolean, manager: 'binary', owned: boolean, version: string|null, latest: string|null, outdated: boolean, checkedFor: string|null, checkedAt: number|null, appVersion: string, reason?: string }>}
 */
async function ytDlpStatus(options = {}) {
  // Sequential, not parallel: which repository holds "latest" depends on the channel of the binary
  // on disk, so the installed version has to be known first.
  const version = await installedVersion();
  const latest = options.remote === false ? null : await publishedVersion(version);
  const outdated = Boolean(version && latest && isOlder(version, latest));
  return {
    ok: true,
    manager: 'binary',
    // A yt-dlp this product did not provision is reported, never updated — the panel greys the
    // button rather than pretending a click would do something.
    owned: ownedBinary() != null,
    available: version != null,
    version,
    latest,
    outdated,
    checkedFor: CONFIG.ytDlpCheckedFor || null,
    checkedAt: CONFIG.ytDlpCheckedAt || null,
    appVersion: appVersion(),
    ...(version ? {} : { reason: 'yt-dlp missing' }),
  };
}

/**
 * Manual update from Settings › Updates. Bypasses the per-release marker — it IS the answer to an
 * installation that has not seen an application update in months — and reports what changed, so the
 * panel can say "already current" rather than leaving the click without an outcome.
 * @returns {Promise<{ ok: boolean, version: string|null, previous: string|null, changed: boolean, error?: string, notOwned?: boolean }>}
 */
async function updateYtDlpNow() {
  const bin = ownedBinary();
  if (!bin) return { ok: false, version: await installedVersion(), previous: null, changed: false, error: t('ytdlpNotOwned'), notOwned: true };

  const previous = await installedVersion();
  const result = await run(bin, ['-U'], UPDATE_TIMEOUT_MS);
  if (result.error) {
    const detail = result.out.split(/\r?\n/).filter(Boolean).pop() || String(result.error.message || result.error);
    console.warn(`yt-dlp: update failed (${detail})`);
    return { ok: false, version: previous, previous, changed: false, error: detail };
  }
  const version = await installedVersion();
  // The manual update also satisfies this release: an update that just ran must not be repeated by
  // the boot path on the next restart.
  saveConfig({ ytDlpCheckedFor: appVersion() || CONFIG.ytDlpCheckedFor, ytDlpCheckedAt: Date.now() });
  console.log(`yt-dlp: ${version ? `version ${version}` : 'update finished'}`);
  return { ok: true, version, previous, changed: Boolean(version && previous && version !== previous) };
}

// `isOlder` is exported for the suite that pins the ordering: it is the rule that decides whether
// a button is offered at all, and it is worth testing on its own rather than through a spawn.
// `isOlder` and `releasesUrl` are exported for the suite that pins them: the ordering decides
// whether a button is offered at all, and the channel decides what it is compared against. Both
// are worth testing on their own rather than through a spawn.
module.exports = { refreshYtDlpForAppVersion, ytDlpStatus, updateYtDlpNow, isOlder, releasesUrl };

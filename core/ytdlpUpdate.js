// @ts-check
// core/ytdlpUpdate.js
// yt-dlp is the only runtime dependency that ROTS. ffmpeg and the GLSL shaders keep working for
// years; yt-dlp's extractors are broken by the platforms themselves every few weeks. It is fetched
// once, by `scripts/setup.ps1`, from `releases/latest` — after that nothing ever touches it, so an
// install left alone slowly loses the half of a reference board that arrives through a link, and
// the only cure was to reinstall the application.
//
// The refresh is anchored to the APPLICATION update rather than to a timer or to every launch:
// a build that has just replaced itself is the one moment where new code is already expected, and
// it caps the cost at one check per release. `yt-dlp -U` asks GitHub for the latest stable and
// returns in a second when it is already current — the ~18 MB is only paid on a real version gap.
// The version that was checked is written to nr.config.json, so a boot of the same build does
// nothing at all.

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { CONFIG, DETECT_ENV, saveConfig, ytDlpCommand } = require('./config');

// Downloading a new binary over a metered connection must never hold the boot, and a machine behind
// a proxy that swallows the request must not hang a process either.
const UPDATE_TIMEOUT_MS = 5 * 60 * 1000;

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

/**
 * Updates yt-dlp once per application version. Never throws and never blocks: a failure leaves the
 * marker unwritten, so the next boot simply tries again — which is what carries the refresh over
 * for someone who was offline the day they updated.
 * @returns {Promise<{ updated: boolean, reason?: string, version?: string }>}
 */
async function refreshYtDlpForAppVersion() {
  const version = appVersion();
  if (!version) return { updated: false, reason: 'version inconnue' };
  if (CONFIG.ytDlpCheckedFor === version) return { updated: false, reason: 'déjà vérifié' };

  const bin = ownedBinary();
  if (!bin) return { updated: false, reason: 'yt-dlp non provisionné' };

  const result = await new Promise((resolve) => {
    execFile(bin, ['-U'], { timeout: UPDATE_TIMEOUT_MS, env: DETECT_ENV, windowsHide: true },
      (error, stdout, stderr) => resolve({ error, out: `${stdout || ''}${stderr || ''}`.trim() }));
  });
  if (result.error) {
    console.warn(`yt-dlp: mise à jour impossible (${String(result.error.message || result.error)})`);
    return { updated: false, reason: 'échec' };
  }
  // `-U` prints either "yt-dlp is up to date" or the version it moved to; both mean the binary is
  // now current for this application version, so the marker is written in either case.
  saveConfig({ ytDlpCheckedFor: version });
  const line = result.out.split(/\r?\n/).filter(Boolean).pop() || 'à jour';
  console.log(`yt-dlp: ${line}`);
  return { updated: true, version };
}

module.exports = { refreshYtDlpForAppVersion };

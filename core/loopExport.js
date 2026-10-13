// @ts-check
// Board clip → looping animated image: animated WebP, or GIF.
//
// Both loop on their own wherever an image is shown, which a video file does not. WebP keeps 24-bit
// colour and stays light; GIF is the compatibility format, capped at 256 colours per frame by the
// format itself — the palette pass below is the best it can give, not a match for WebP.
//
// One ffmpeg pass, written beside the destination under a temporary name and renamed when complete:
// a cancelled or failed export never leaves a truncated file where the user asked for one.

const path = require('path');
const { spawn } = require('child_process');
const { ffBin, fsp } = require('./config');
const { probeMedia, playInfo } = require('./ffmpeg');
const { t } = require('./i18n');

// An animated image has no seeking and is decoded whole by whatever displays it: past a minute it
// is a video that should have stayed one.
const MAX_LOOP_SEC = 60;
// GIF delays are stored in hundredths of a second: nothing above 50 fps survives the muxer.
const MAX_FPS = { webp: 60, gif: 50 };
const WEBP_MAX_SIDE = 16383;
const FORMATS = new Set(['webp', 'gif']);

const frac = (v) => Math.min(1, Math.max(0, Number(v) || 0)).toFixed(6);

/**
 * Filter chain shared by both formats, in the order the board applies them: crop, mirror, cadence,
 * size. `width` is a ceiling, never an enlargement.
 * @param {{ crop?: { x: number, y: number, w: number, h: number } | null, flipH?: boolean, flipV?: boolean, fps?: number, width?: number }} o
 */
function loopFilters(o) {
  const chain = [];
  const c = o.crop;
  if (c && Number(c.w) > 0 && Number(c.h) > 0) {
    chain.push(`crop=iw*${frac(c.w)}:ih*${frac(c.h)}:iw*${frac(c.x)}:ih*${frac(c.y)}`);
  }
  if (o.flipH) chain.push('hflip');
  if (o.flipV) chain.push('vflip');
  if (Number(o.fps) > 0) chain.push(`fps=${Number(o.fps).toFixed(3)}`);
  const width = Math.min(WEBP_MAX_SIDE, Math.round(Number(o.width) || 0));
  if (width > 0) chain.push(`scale='min(${width},iw)':-2:flags=lanczos`);
  return chain;
}

/**
 * ffmpeg arguments of one export. `out` is the file actually written (the temporary name), so the
 * muxer is named explicitly instead of being guessed from an extension.
 * @param {{ input: string, out: string, format: 'webp' | 'gif', start?: number, duration?: number, filters?: string[], quality?: number }} o
 */
function loopArgs(o) {
  const filters = o.filters || [];
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats'];
  if (Number(o.start) > 0) args.push('-ss', String(o.start)); // seek before -i: fast
  args.push('-i', o.input);
  if (Number(o.duration) > 0) args.push('-t', String(o.duration));
  args.push('-an', '-sn');
  if (o.format === 'gif') {
    // `stats_mode=diff` weights the palette towards what moves, `diff_mode=rectangle` rewrites only
    // the changed area of each frame: same recipe as the GIF upscale (core/shaderUpscale.js).
    const head = filters.length ? `[0:v:0]${filters.join(',')},split[a][b]` : '[0:v:0]split[a][b]';
    args.push('-filter_complex',
      `${head};[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
      '-loop', '0', '-f', 'gif', o.out);
    return args;
  }
  const quality = Math.min(100, Math.max(1, Math.round(Number(o.quality) || 80)));
  args.push('-map', '0:v:0');
  if (filters.length) args.push('-vf', filters.join(','));
  args.push('-c:v', 'libwebp_anim', '-lossless', '0', '-q:v', String(quality),
    '-compression_level', '4', '-loop', '0', '-f', 'webp', o.out);
  return args;
}

/** @type {import('child_process').ChildProcess | null} */
let running = null;
let cancelled = false;

function cancelLoopExport() {
  if (!running) return { ok: true, cancelled: false };
  cancelled = true;
  try { running.kill(); } catch (_) { /* already gone */ }
  return { ok: true, cancelled: true };
}

/**
 * @param {{ sender?: { send: (channel: string, payload: unknown) => void } } | null} event
 * @param {{ path?: string, out?: string, format?: string, in?: number, end?: number, fps?: number, width?: number, quality?: number, crop?: any, flipH?: boolean, flipV?: boolean }} opts
 */
async function exportLoop(event, opts) {
  const o = opts || {};
  const input = String(o.path || '');
  const format = String(o.format || 'webp');
  if (!input || !o.out) return { ok: false, error: t('sourceMissing') };
  if (/^(https?:|data:|blob:)/i.test(input)) return { ok: false, error: t('localMediaRequired') };
  if (!FORMATS.has(format)) return { ok: false, error: t('loopFormatUnknown', { format }) };
  if (running) return { ok: false, error: t('loopBusy') };

  let out = path.resolve(String(o.out));
  if (path.extname(out).toLowerCase() !== `.${format}`) out += `.${format}`;

  let total = 0;
  let sourceFps = 0;
  try {
    total = (await probeMedia(input)).duration || 0;
    sourceFps = (await playInfo(input)).fps || 0;
  } catch (e) {
    return { ok: false, error: t('sourceUnreadable', { detail: String(e.stderr || e) }) };
  }
  const start = Math.max(0, Number(o.in) || 0);
  const end = Number(o.end) > start ? Number(o.end) : total;
  const duration = end - start;
  if (!(duration > 0)) return { ok: false, error: t('noFrames') };
  if (duration > MAX_LOOP_SEC + 0.05) return { ok: false, error: t('loopTooLong', { max: MAX_LOOP_SEC }) };

  const cap = MAX_FPS[format];
  const wanted = Number(o.fps) > 0 ? Number(o.fps) : sourceFps;
  const fps = wanted > 0 ? Math.min(cap, wanted) : 0;
  const filters = loopFilters({ crop: o.crop, flipH: o.flipH, flipV: o.flipV, fps, width: o.width });

  const tmp = `${out}.part`;
  const args = loopArgs({ input, out: tmp, format: /** @type {'webp'|'gif'} */ (format), start, duration, filters, quality: o.quality });
  const send = (pct) => { if (event?.sender) event.sender.send('reference:loopProgress', { pct }); };

  await fsp.mkdir(path.dirname(out), { recursive: true });
  cancelled = false;
  send(0);
  const r = await new Promise((resolve) => {
    const cp = spawn(ffBin('ffmpeg'), args, { windowsHide: true });
    running = cp;
    let errTail = '';
    let buf = '';
    cp.stdout.on('data', (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        const m = line.match(/^out_time_(?:us|ms)=(\d+)/); // both keys carry microseconds
        if (m) send(Math.min(99, Math.round((parseInt(m[1], 10) / 1e6 / duration) * 100)));
      }
    });
    cp.stderr.on('data', (d) => { errTail = (errTail + d.toString()).slice(-800); });
    cp.on('error', (e) => resolve({ ok: false, error: t('ffmpegMissing', { detail: e.message }) }));
    cp.on('close', (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: errTail.trim() || t('loopFailed', { code: String(code) }) });
    });
  });
  running = null;

  if (!r.ok) {
    try { await fsp.rm(tmp, { force: true }); } catch (_) { /* best effort */ }
    return cancelled ? { ok: false, cancelled: true } : r;
  }
  try {
    await fsp.rm(out, { force: true });
    await fsp.rename(tmp, out);
    const bytes = (await fsp.stat(out)).size;
    send(100);
    return { ok: true, path: out, bytes };
  } catch (e) {
    try { await fsp.rm(tmp, { force: true }); } catch (_) { /* best effort */ }
    return { ok: false, error: String((e && e.message) || e) };
  }
}

module.exports = { exportLoop, cancelLoopExport, loopArgs, loopFilters, MAX_LOOP_SEC };

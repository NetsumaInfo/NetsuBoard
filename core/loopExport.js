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
const { ffBin, fsp, SEQ_DIR } = require('./config');
const { probeMedia, playInfo } = require('./ffmpeg');
const { t } = require('./i18n');

// An animated image has no seeking and is decoded whole by whatever displays it: past a minute it
// is a video that should have stayed one.
const MAX_LOOP_SEC = 60;
// GIF delays are stored in hundredths of a second: nothing above 50 fps survives the muxer.
const MAX_FPS = { webp: 60, gif: 50 };
const WEBP_MAX_SIDE = 16383;
const FORMATS = new Set(['webp', 'gif']);
// Length of the sample an estimate encodes, taken from the middle of the range.
const ESTIMATE_SEC = 1;

/**
 * @typedef {{ input: string, format: 'webp' | 'gif', start: number, duration: number, filters: string[] }} LoopPlan
 * @typedef {{ path?: string, out?: string, format?: string, in?: number, end?: number, fps?: number, width?: number, quality?: number, lossless?: boolean, crop?: any, flipH?: boolean, flipV?: boolean }} LoopOpts
 */

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
 * @param {{ input: string, out: string, format: 'webp' | 'gif', start?: number, duration?: number, filters?: string[], quality?: number, lossless?: boolean }} o
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
  args.push('-map', '0:v:0');
  if (filters.length) args.push('-vf', filters.join(','));
  if (o.lossless) {
    // Lossless is exact against RGB, so the frames are handed over as such. `-q:v` then only sets
    // how hard the encoder searches, not what the picture looks like.
    args.push('-c:v', 'libwebp_anim', '-pix_fmt', 'bgra', '-lossless', '1', '-q:v', '75');
  } else {
    const quality = Math.min(100, Math.max(1, Math.round(Number(o.quality) || 80)));
    args.push('-c:v', 'libwebp_anim', '-lossless', '0', '-q:v', String(quality));
  }
  args.push('-compression_level', '4', '-loop', '0', '-f', 'webp', o.out);
  return args;
}

/** @type {import('child_process').ChildProcess | null} */
let running = null;
let cancelled = false;
/** @type {import('child_process').ChildProcess | null} */
let estimating = null;
let estimateSeq = 0;

function cancelLoopExport() {
  if (!running) return { ok: true, cancelled: false };
  cancelled = true;
  try { running.kill(); } catch (_) { /* already gone */ }
  return { ok: true, cancelled: true };
}

function stopEstimate() {
  if (!estimating) return;
  try { estimating.kill(); } catch (_) { /* already gone */ }
  estimating = null;
}

/**
 * What both the export and its estimate encode: source, range and filter chain — or the reason
 * there is nothing to encode.
 * @param {LoopOpts} o
 * @returns {Promise<{ error?: string, plan?: LoopPlan }>}
 */
async function planLoop(o) {
  const input = String(o.path || '');
  const format = String(o.format || 'webp');
  if (!input) return { error: t('sourceMissing') };
  if (/^(https?:|data:|blob:)/i.test(input)) return { error: t('localMediaRequired') };
  if (!FORMATS.has(format)) return { error: t('loopFormatUnknown', { format }) };

  let total = 0;
  let sourceFps = 0;
  try {
    total = (await probeMedia(input)).duration || 0;
    sourceFps = (await playInfo(input)).fps || 0;
  } catch (e) {
    return { error: t('sourceUnreadable', { detail: String(e.stderr || e) }) };
  }
  const start = Math.max(0, Number(o.in) || 0);
  const end = Number(o.end) > start ? Number(o.end) : total;
  const duration = end - start;
  if (!(duration > 0)) return { error: t('noFrames') };
  if (duration > MAX_LOOP_SEC + 0.05) return { error: t('loopTooLong', { max: MAX_LOOP_SEC }) };

  const wanted = Number(o.fps) > 0 ? Number(o.fps) : sourceFps;
  const fps = wanted > 0 ? Math.min(MAX_FPS[format], wanted) : 0;
  const filters = loopFilters({ crop: o.crop, flipH: o.flipH, flipV: o.flipV, fps, width: o.width });
  return { plan: { input, format: /** @type {'webp' | 'gif'} */ (format), start, duration, filters } };
}

/**
 * One ffmpeg run. `onChild` hands the process over so the caller can stop it.
 * @param {string[]} args
 * @param {(seconds: number) => void} onTime
 * @param {(cp: import('child_process').ChildProcess) => void} onChild
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
function runFfmpeg(args, onTime, onChild) {
  return new Promise((resolve) => {
    const cp = spawn(ffBin('ffmpeg'), args, { windowsHide: true });
    onChild(cp);
    let errTail = '';
    let buf = '';
    cp.stdout.on('data', (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        const m = line.match(/^out_time_(?:us|ms)=(\d+)/); // both keys carry microseconds
        if (m) onTime(parseInt(m[1], 10) / 1e6);
      }
    });
    cp.stderr.on('data', (d) => { errTail = (errTail + d.toString()).slice(-800); });
    cp.on('error', (e) => resolve({ ok: false, error: t('ffmpegMissing', { detail: e.message }) }));
    cp.on('close', (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: errTail.trim() || t('loopFailed', { code: String(code) }) });
    });
  });
}

/**
 * @param {{ sender?: { send: (channel: string, payload: unknown) => void } } | null} event
 * @param {LoopOpts} opts
 */
async function exportLoop(event, opts) {
  const o = opts || {};
  if (!o.out) return { ok: false, error: t('sourceMissing') };
  if (running) return { ok: false, error: t('loopBusy') };
  const { plan, error } = await planLoop(o);
  if (!plan) return { ok: false, error };
  const { format, duration } = plan;

  let out = path.resolve(String(o.out));
  if (path.extname(out).toLowerCase() !== `.${format}`) out += `.${format}`;
  const tmp = `${out}.part`;
  const args = loopArgs({ ...plan, out: tmp, quality: o.quality, lossless: o.lossless });
  const send = (pct) => { if (event?.sender) event.sender.send('reference:loopProgress', { pct }); };

  await fsp.mkdir(path.dirname(out), { recursive: true });
  estimateSeq += 1; // an estimate still in flight is now stale…
  stopEstimate();   // …and the export owns the machine from here
  cancelled = false;
  send(0);
  const r = await runFfmpeg(args,
    (sec) => send(Math.min(99, Math.round((sec / duration) * 100))),
    (cp) => { running = cp; });
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

/**
 * Weight the export would have, from a real encode of a short sample with the same settings,
 * scaled to the full range. No formula predicts either format: both depend on how much the picture
 * moves. A newer request replaces the one in flight, which then resolves `stale`.
 * @param {LoopOpts} opts
 */
async function estimateLoop(opts) {
  const o = opts || {};
  const seq = ++estimateSeq;
  stopEstimate();
  if (running) return { ok: false, stale: true };
  const { plan, error } = await planLoop(o);
  if (seq !== estimateSeq) return { ok: false, stale: true };
  if (!plan) return { ok: false, error };

  const sample = Math.min(plan.duration, ESTIMATE_SEC);
  const tmp = path.join(SEQ_DIR, `loop-estimate-${process.pid}-${seq}.${plan.format}`);
  const args = loopArgs({
    ...plan, start: plan.start + (plan.duration - sample) / 2, duration: sample,
    out: tmp, quality: o.quality, lossless: o.lossless,
  });
  try {
    await fsp.mkdir(SEQ_DIR, { recursive: true });
    const r = await runFfmpeg(args, () => {}, (cp) => { estimating = cp; });
    if (seq !== estimateSeq) return { ok: false, stale: true };
    estimating = null;
    if (!r.ok) return r;
    const bytes = (await fsp.stat(tmp)).size;
    return { ok: true, bytes: Math.round(bytes * (plan.duration / sample)) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    try { await fsp.rm(tmp, { force: true }); } catch (_) { /* best effort */ }
  }
}

module.exports = { exportLoop, estimateLoop, cancelLoopExport, loopArgs, loopFilters, MAX_LOOP_SEC };

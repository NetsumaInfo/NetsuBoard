// @ts-check
// Animatic → video file (MP4: H.264 and AAC).
//
// The renderer paints every frame (camera, items, their appearances) and streams them here as JPEG;
// ffmpeg encodes them with the probed hardware H.264 encoder, libx264 when there is none. The audio
// is mixed in the same pass: the music, lowered while a video plays with its sound on, and the
// sound of those videos.
//
// One export at a time. The file is written beside the destination under a temporary name and
// renamed when complete: a cancelled or failed export never leaves a truncated file behind.

const path = require('path');
const { spawn } = require('child_process');
const { ffBin, fsp } = require('./config');
const { probeAudioTracks } = require('./ffmpeg');
const { getCapabilities } = require('./export/capabilities');
const { selectProxyEncoder, proxyVideoArgs } = require('./proxyEncoder');
const { t } = require('./i18n');

// Music level while a video plays with its sound on (the same ducking as the live player).
const DUCK = 0.25;
const MAX_SIDE = 4096;

/**
 * @typedef {{ path: string, from: number, to: number, at: number, speed?: number }} SoundPiece
 * @typedef {{ path: string, duck?: [number, number][] }} MusicTrack
 * @typedef {{ out: string, fps: number, width: number, height: number, duration: number,
 *   encoder: string[], music?: MusicTrack | null, sounds?: SoundPiece[] }} AnimaticArgsOpts
 */

const num = (v, digits = 3) => (Number(v) || 0).toFixed(digits);

/** `atempo` chain for a speed: each stage takes 0.5–2, so 0.25 is two halvings. */
function atempoChain(speed) {
  let s = Math.min(4, Math.max(0.25, Number(speed) || 1));
  if (Math.abs(s - 1) < 1e-3) return [];
  const out = [];
  while (s < 0.5) { out.push('atempo=0.5'); s /= 0.5; }
  while (s > 2) { out.push('atempo=2'); s /= 2; }
  out.push(`atempo=${s.toFixed(4)}`);
  return out;
}

/** Volume expression of the music: 1, or DUCK inside any of the spans. */
function duckVolume(spans) {
  const parts = (spans || [])
    .filter((s) => Array.isArray(s) && Number(s[1]) > Number(s[0]))
    .map(([a, b]) => `between(t,${num(a)},${num(b)})`);
  return parts.length ? `volume='if(${parts.join('+')},${DUCK},1)':eval=frame` : 'anull';
}

/**
 * ffmpeg arguments: JPEG frames on stdin (input 0), then the music, then each sound piece.
 * @param {AnimaticArgsOpts} o
 */
function animaticArgs(o) {
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-nostats',
    '-f', 'image2pipe', '-framerate', String(o.fps), '-c:v', 'mjpeg', '-i', 'pipe:0'];
  const sounds = o.sounds || [];
  const graph = [];
  const labels = [];
  let input = 1;
  if (o.music) {
    args.push('-i', o.music.path);
    graph.push(`[${input}:a:0]${duckVolume(o.music.duck)}[m]`);
    labels.push('[m]');
    input += 1;
  }
  sounds.forEach((s, i) => {
    args.push('-i', s.path);
    const chain = [`atrim=start=${num(s.from)}:end=${num(s.to)}`, 'asetpts=PTS-STARTPTS', ...atempoChain(s.speed ?? 1)];
    const delay = Math.max(0, Math.round((Number(s.at) || 0) * 1000));
    if (delay > 0) chain.push(`adelay=${delay}:all=1`);
    graph.push(`[${input}:a:0]${chain.join(',')}[s${i}]`);
    labels.push(`[s${i}]`);
    input += 1;
  });
  if (labels.length > 1) graph.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest[a]`);
  if (graph.length) args.push('-filter_complex', graph.join(';'));
  args.push('-map', '0:v:0');
  if (labels.length) args.push('-map', labels.length > 1 ? '[a]' : labels[0]);
  args.push(...o.encoder, '-r', String(o.fps));
  if (labels.length) args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000');
  else args.push('-an');
  args.push('-t', num(o.duration), '-movflags', '+faststart', '-f', 'mp4', o.out);
  return args;
}

/**
 * @type {null | { id: number, cp: import('child_process').ChildProcess, out: string, tmp: string,
 *   hardware: boolean, done: Promise<number | null>, errTail: string, exited: boolean, cancelled: boolean }}
 */
let job = null;
let nextId = 1;

const hasAudio = async (file) => {
  try { return ((await probeAudioTracks(file))?.tracks?.length ?? 0) > 0; } catch (_) { return false; }
};
const isFile = (p) => typeof p === 'string' && !!p && !/^(https?:|data:|blob:|collab:)/i.test(p);

/**
 * Opens an export: ffmpeg starts and waits for frames.
 * @param {{ out?: string, fps?: number, width?: number, height?: number, duration?: number, cpu?: boolean,
 *   music?: MusicTrack | null, sounds?: SoundPiece[] }} opts
 */
async function startAnimaticExport(opts) {
  const o = opts || {};
  if (job) return { ok: false, error: t('loopBusy') };
  const fps = Math.min(60, Math.max(1, Math.round(Number(o.fps) || 30)));
  const even = (v) => Math.max(2, Math.min(MAX_SIDE, Math.round((Number(v) || 0) / 2) * 2));
  const width = even(o.width), height = even(o.height);
  const duration = Number(o.duration) || 0;
  if (!o.out || !(duration > 0)) return { ok: false, error: t('sourceMissing') };

  let out = path.resolve(String(o.out));
  if (path.extname(out).toLowerCase() !== '.mp4') out += '.mp4';
  const tmp = `${out}.part`;

  const music = o.music && isFile(o.music.path) && (await hasAudio(o.music.path)) ? o.music : null;
  /** @type {SoundPiece[]} */
  const sounds = [];
  const audible = new Map();
  for (const s of Array.isArray(o.sounds) ? o.sounds : []) {
    if (!isFile(s?.path) || !(Number(s.to) > Number(s.from))) continue;
    if (!audible.has(s.path)) audible.set(s.path, await hasAudio(s.path));
    if (audible.get(s.path)) sounds.push(s);
  }

  let caps;
  try { caps = await getCapabilities(); } catch (_) { caps = { h264Encoder: null, h265Encoder: null, codecEncoderOptions: {} }; }
  const resolved = selectProxyEncoder('h264', caps, o.cpu ? 'cpu' : 'auto');
  const args = animaticArgs({ out: tmp, fps, width, height, duration, encoder: proxyVideoArgs(resolved, 'level3'), music, sounds });

  await fsp.mkdir(path.dirname(out), { recursive: true });
  const cp = spawn(ffBin('ffmpeg'), args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  const id = nextId++;
  const current = {
    id, cp, out, tmp, hardware: resolved.vendor !== 'cpu', errTail: '', exited: false, cancelled: false,
    /** @type {Promise<number | null>} */
    done: Promise.resolve(null),
  };
  current.done = new Promise((resolve) => {
    cp.on('error', (e) => { current.errTail = t('ffmpegMissing', { detail: e.message }); current.exited = true; resolve(-1); });
    cp.on('close', (code) => { current.exited = true; resolve(code); });
  });
  cp.stderr?.on('data', (d) => { current.errTail = (current.errTail + d.toString()).slice(-800); });
  // A write after ffmpeg died raises EPIPE on the stream: the next call reports the real cause.
  cp.stdin?.on('error', () => {});
  job = current;
  return { ok: true, id, encoder: resolved.encoder, width, height, fps, audio: !!music || sounds.length > 0 };
}

function failure(current) {
  return { ok: false, error: current.errTail.trim() || t('loopFailed', { code: 'ffmpeg' }), hardware: current.hardware };
}

async function drop(current) {
  if (job === current) job = null;
  await fsp.rm(current.tmp, { force: true }).catch(() => {});
}

/**
 * Frames, in order, as base64 JPEG.
 * @param {number} id @param {string[]} frames
 */
async function writeAnimaticFrames(id, frames) {
  const current = job;
  if (!current || current.id !== id) return { ok: false, error: t('sourceMissing') };
  const stdin = current.cp.stdin;
  for (const b64 of Array.isArray(frames) ? frames : []) {
    if (current.exited || !stdin || stdin.destroyed) {
      await current.done;
      const r = failure(current);
      await drop(current);
      return r;
    }
    if (!stdin.write(Buffer.from(String(b64), 'base64'))) {
      await new Promise((resolve) => {
        const go = () => { stdin.off('drain', go); current.cp.off('close', go); resolve(null); };
        stdin.on('drain', go);
        current.cp.on('close', go);
      });
    }
  }
  return { ok: true };
}

/** Last frame sent: ffmpeg finishes the file, which then takes its real name. @param {number} id */
async function finishAnimaticExport(id) {
  const current = job;
  if (!current || current.id !== id) return { ok: false, error: t('sourceMissing') };
  current.cp.stdin?.end();
  const code = await current.done;
  if (code !== 0) {
    const r = failure(current);
    await drop(current);
    return r;
  }
  try {
    await fsp.rm(current.out, { force: true });
    await fsp.rename(current.tmp, current.out);
    const bytes = (await fsp.stat(current.out)).size;
    if (job === current) job = null;
    return { ok: true, path: current.out, bytes };
  } catch (e) {
    await drop(current);
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/** Stops the export in progress and removes its partial file. */
async function cancelAnimaticExport() {
  const current = job;
  if (!current) return { ok: true, cancelled: false };
  current.cancelled = true;
  try { current.cp.stdin?.destroy(); } catch (_) { /* already closed */ }
  try { current.cp.kill('SIGKILL'); } catch (_) { /* already gone */ }
  await current.done;
  await drop(current);
  return { ok: true, cancelled: true };
}

module.exports = {
  startAnimaticExport, writeAnimaticFrames, finishAnimaticExport, cancelAnimaticExport,
  animaticArgs, atempoChain, duckVolume,
};

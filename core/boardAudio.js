// @ts-check
// Board audio: the sound track of a video pulled out as its own file, and the loudness outline drawn
// on an audio card. Both read the file on disk through ffmpeg; nothing is decoded in JavaScript
// except the small mono stream the outline is measured on.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { ffBin } = require('./config');
const ffmpeg = require('./ffmpeg');

// Container written for each audio codec when the track is copied as is. The track is never
// re-encoded (extraction is lossless); a codec the list does not know goes into Matroska audio,
// which holds anything.
const CODEC_EXT = {
  aac: 'm4a', alac: 'm4a', mp3: 'mp3', opus: 'opus', vorbis: 'ogg', flac: 'flac',
  ac3: 'ac3', eac3: 'eac3',
};

/** @param {string} codec @returns {string} */
function extFor(codec) {
  if (/^pcm_/.test(codec)) return 'wav';
  return CODEC_EXT[codec] || 'mka';
}

/**
 * Copies one audio track of a local video into the app's asset folder.
 * @param {string} assetsDir
 * @param {{ path?: string, track?: number, start?: number, end?: number }} opts
 * @returns {Promise<{ ok: true, path: string, codec: string, duration: number } | { ok: false, error: string }>}
 */
async function extractTrack(assetsDir, opts) {
  const input = opts && opts.path;
  if (!input) return { ok: false, error: 'no source' };
  try { await fs.promises.access(input); } catch (_) { return { ok: false, error: 'source not found' }; }
  const { tracks } = await ffmpeg.probeAudioTracks(input);
  if (!tracks || !tracks.length) return { ok: false, error: 'no audio' };
  const index = Math.max(0, Math.min(tracks.length - 1, Number(opts.track) || 0));
  const codec = tracks[index].codec || '';
  const start = Number(opts.start) > 0 ? Number(opts.start) : 0;
  const end = Number(opts.end) > start ? Number(opts.end) : 0;
  let mtime = 0;
  try { mtime = (await fs.promises.stat(input)).mtimeMs; } catch (_) { /* hashed without it */ }
  const key = crypto.createHash('sha1').update(`${input}|${mtime}|a${index}|${start}|${end}`).digest('hex').slice(0, 20);
  const out = path.join(assetsDir, `audio-${key}.${extFor(codec)}`);
  try {
    if ((await fs.promises.stat(out)).size > 0) return { ok: true, path: out, codec, duration: end ? end - start : 0 };
  } catch (_) { /* not written yet */ }
  const tmp = `${out}.part`;
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    ...(start ? ['-ss', String(start)] : []),
    '-i', input,
    ...(end ? ['-t', String(end - start)] : []),
    '-map', `0:a:${index}`, '-vn', '-sn', '-dn', '-c:a', 'copy',
    // The muxer is named explicitly: the temporary name has no extension ffmpeg could read.
    '-f', muxerFor(extFor(codec)), tmp,
  ];
  try {
    await ffmpeg.run('ffmpeg', args);
    await fs.promises.rename(tmp, out);
  } catch (e) {
    try { await fs.promises.unlink(tmp); } catch (_) { /* nothing written */ }
    const err = /** @type {any} */ (e);
    return { ok: false, error: String((err && err.stderr) || err).trim().split('\n').pop() || 'ffmpeg failed' };
  }
  return { ok: true, path: out, codec, duration: end ? end - start : 0 };
}

/** @param {string} ext @returns {string} */
function muxerFor(ext) {
  return { m4a: 'ipod', mp3: 'mp3', opus: 'opus', ogg: 'ogg', flac: 'flac', ac3: 'ac3', eac3: 'eac3', wav: 'wav' }[ext] || 'matroska';
}

// Outline cache by (path, mtime, bins). An outline is a few hundred numbers: keeping the last
// hundred costs nothing and spares a full decode each time a card is mounted.
const PEAKS_MAX = 100;
const peaksCache = new Map();
const peaksInflight = new Map();
const PEAK_RATE = 2000; // Hz of the mono stream measured: enough for an outline, cheap to decode

/**
 * Loudness outline of an audio (or video) file: `bins` values between 0 and 1.
 * @param {string} input
 * @param {number} [bins]
 * @returns {Promise<{ ok: true, peaks: number[], duration: number } | { ok: false, error: string }>}
 */
async function peaks(input, bins = 160) {
  const n = Math.max(16, Math.min(1024, Math.round(Number(bins) || 160)));
  let mtime = 0;
  try { mtime = (await fs.promises.stat(input)).mtimeMs; } catch (_) { return { ok: false, error: 'source not found' }; }
  const key = `${input}|${mtime}|${n}`;
  const hit = peaksCache.get(key);
  if (hit) return hit;
  const running = peaksInflight.get(key);
  if (running) return running;
  const job = measure(input, n).then((result) => {
    if (result.ok) {
      peaksCache.set(key, result);
      if (peaksCache.size > PEAKS_MAX) peaksCache.delete(peaksCache.keys().next().value);
    }
    return result;
  });
  peaksInflight.set(key, job);
  try { return await job; } finally { peaksInflight.delete(key); }
}

/** @param {string} input @param {number} n */
function measure(input, n) {
  return new Promise((resolve) => {
    const child = spawn(ffBin('ffmpeg'), [
      '-hide_banner', '-loglevel', 'error', '-i', input, '-map', '0:a:0', '-vn',
      '-ac', '1', '-ar', String(PEAK_RATE), '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1',
    ], { windowsHide: true });
    // Running maxima per small block; regrouped into `n` bins once the length is known.
    const BLOCK = 50; // samples per block (25 ms)
    /** @type {number[]} */
    const blocks = [];
    let cur = 0;
    let inBlock = 0;
    let carry = /** @type {Buffer | null} */ (null);
    child.stdout.on('data', (/** @type {Buffer} */ chunk) => {
      const buf = carry ? Buffer.concat([carry, chunk]) : chunk;
      const usable = buf.length - (buf.length % 2);
      carry = usable < buf.length ? buf.subarray(usable) : null;
      for (let i = 0; i < usable; i += 2) {
        const v = Math.abs(buf.readInt16LE(i));
        if (v > cur) cur = v;
        if (++inBlock === BLOCK) { blocks.push(cur); cur = 0; inBlock = 0; }
      }
    });
    let stderr = '';
    child.stderr.on('data', (d) => { if (stderr.length < 4000) stderr += d; });
    child.on('error', (e) => resolve({ ok: false, error: String(e) }));
    child.on('close', (code) => {
      if (inBlock) blocks.push(cur);
      if (!blocks.length) {
        resolve({ ok: false, error: code ? stderr.trim().split('\n').pop() || 'ffmpeg failed' : 'no audio' });
        return;
      }
      const out = new Array(n).fill(0);
      for (let b = 0; b < n; b++) {
        const from = Math.floor((b * blocks.length) / n);
        const to = Math.max(from + 1, Math.floor(((b + 1) * blocks.length) / n));
        let m = 0;
        for (let i = from; i < to && i < blocks.length; i++) if (blocks[i] > m) m = blocks[i];
        out[b] = m;
      }
      const top = Math.max(1, ...out);
      resolve({
        ok: true,
        peaks: out.map((v) => Math.round((v / top) * 1000) / 1000),
        duration: (blocks.length * BLOCK) / PEAK_RATE,
      });
    });
  });
}

module.exports = { extractTrack, peaks, extFor };

// @ts-check
// Size and length of a local video as the board will show it, read by ffprobe from the container
// headers. Measuring through a <video> element meant opening the file in the webview, and for a
// container it cannot read (MKV, AVI, TS…) starting a whole ffmpeg remux just to learn two numbers.

const fs = require('fs');
const ffmpeg = require('./ffmpeg');

const CACHE_MAX = 500;
const cache = new Map(); // path → { mtime, result }

/** @param {any} st */
function rotationOf(st) {
  const tag = Number(st && st.tags && st.tags.rotate);
  if (Number.isFinite(tag) && tag) return tag;
  for (const sd of (st && st.side_data_list) || []) {
    const r = Number(sd && sd.rotation);
    if (Number.isFinite(r) && r) return r;
  }
  return 0;
}

/**
 * @param {string} filePath
 * @returns {Promise<{ ok: true, width: number, height: number, duration: number } | { ok: false, error: string }>}
 */
async function probeVideo(filePath) {
  let mtime = 0;
  try { mtime = (await fs.promises.stat(filePath)).mtimeMs; } catch (_) { return { ok: false, error: 'source not found' }; }
  const hit = cache.get(filePath);
  if (hit && hit.mtime === mtime) return hit.result;
  try {
    const raw = await ffmpeg.run('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'format=duration:stream=width,height,sample_aspect_ratio:stream_tags=rotate:stream_side_data=rotation',
      '-of', 'json', filePath,
    ]);
    const j = JSON.parse(raw.toString());
    const st = (j.streams || [])[0] || {};
    let width = Number(st.width) || 0;
    let height = Number(st.height) || 0;
    // Anamorphic sources: the picture is shown stretched by its sample aspect ratio.
    const [sn, sd] = String(st.sample_aspect_ratio || '1:1').split(':').map(Number);
    if (sn > 0 && sd > 0 && sn !== sd) width = Math.round((width * sn) / sd);
    // A phone clip stored sideways and flagged as rotated plays upright.
    if (Math.abs(rotationOf(st)) % 180 === 90) [width, height] = [height, width];
    const result = { ok: /** @type {const} */ (true), width, height, duration: parseFloat(j.format && j.format.duration) || 0 };
    if (width && height) {
      cache.delete(filePath);
      cache.set(filePath, { mtime, result });
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    }
    return result;
  } catch (e) {
    const err = /** @type {any} */ (e);
    return { ok: false, error: String((err && err.stderr) || err).trim().split('\n').pop() || 'ffprobe failed' };
  }
}

module.exports = { probeVideo };

// Image size from the file header alone. Measuring through an <img> reads and decodes the whole
// picture: forty 20-megapixel photos meant forty full decodes competing with the board for the
// main thread, only to learn two numbers that sit in the first few kilobytes of the file.

import { probeImage } from "./referenceShared";

const HEAD_BYTES = 256 * 1024;

type Size = { w: number; h: number };

export async function probeImageFast(src: string): Promise<Size> {
  try {
    const head = await readHead(src);
    const size = head && parseSize(head);
    if (size && size.w > 0 && size.h > 0) return size;
  } catch { /* fall back to a full load below */ }
  return probeImage(src);
}

async function readHead(src: string): Promise<Uint8Array | null> {
  const res = await fetch(src, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } });
  if (!res.ok || !res.body) return null;
  // A server that ignores Range sends the whole file: stop reading once the header is in.
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < HEAD_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }
  void reader.cancel().catch(() => undefined);
  const out = new Uint8Array(Math.min(total, HEAD_BYTES));
  let at = 0;
  for (const c of chunks) {
    const n = Math.min(c.length, out.length - at);
    out.set(c.subarray(0, n), at);
    at += n;
    if (at >= out.length) break;
  }
  return out;
}

export function parseSize(b: Uint8Array): Size | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ascii = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 3) === "PNG") {
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  if (b.length >= 10 && ascii(0, 3) === "GIF") {
    return { w: dv.getUint16(6, true), h: dv.getUint16(8, true) };
  }
  if (b.length >= 26 && ascii(0, 2) === "BM") {
    return { w: dv.getInt32(18, true), h: Math.abs(dv.getInt32(22, true)) };
  }
  if (b.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return webp(b, dv, ascii);
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) return jpeg(b, dv);
  return null;
}

function webp(b: Uint8Array, dv: DataView, ascii: (o: number, n: number) => string): Size | null {
  const chunk = ascii(12, 4);
  if (chunk === "VP8X") {
    return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  }
  if (chunk === "VP8 ") return { w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = dv.getUint32(21, true);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

// JPEG: walk the segments to the first SOF. The display size follows the EXIF orientation (the
// webview rotates the picture), so a portrait shot stored sideways reports swapped sides.
function jpeg(b: Uint8Array, dv: DataView): Size | null {
  let o = 2;
  let swap = false;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) return null;
    const marker = b[o + 1];
    if (marker === 0xff) { o++; continue; }
    const len = dv.getUint16(o + 2);
    if (marker === 0xe1) swap = exifSwaps(b, dv, o + 4, len - 2);
    const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (sof) {
      const h = dv.getUint16(o + 5);
      const w = dv.getUint16(o + 7);
      return swap ? { w: h, h: w } : { w, h };
    }
    o += 2 + len;
  }
  return null;
}

function exifSwaps(b: Uint8Array, dv: DataView, start: number, len: number): boolean {
  if (len < 14 || String.fromCharCode(...b.subarray(start, start + 4)) !== "Exif") return false;
  const tiff = start + 6;
  if (tiff + 8 > b.length) return false;
  const le = b[tiff] === 0x49;
  const u16 = (o: number) => dv.getUint16(o, le);
  const ifd = tiff + dv.getUint32(tiff + 4, le);
  if (ifd + 2 > b.length) return false;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 10 > b.length) return false;
    if (u16(e) === 0x0112) return u16(e + 8) >= 5 && u16(e + 8) <= 8;
  }
  return false;
}

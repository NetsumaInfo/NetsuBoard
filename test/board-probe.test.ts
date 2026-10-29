// Image size read from the header bytes, so an import never decodes a full picture to measure it.

import { describe, expect, it } from "vitest";
import { parseSize } from "@/components/reference/boardProbe";

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
const be16 = (n: number) => [n >> 8, n & 255];
const be32 = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];

describe("parseSize", () => {
  it("reads PNG", () => {
    expect(parseSize(bytes([0x89], "PNG", [13, 10, 26, 10], be32(13), "IHDR", be32(1920), be32(1080)))).toEqual({ w: 1920, h: 1080 });
  });

  it("reads GIF", () => {
    expect(parseSize(bytes("GIF89a", [0x40, 0x01, 0xf0, 0x00]))).toEqual({ w: 320, h: 240 });
  });

  it("reads JPEG past an APP0 segment", () => {
    const app0 = [0xff, 0xe0, ...be16(16), ...new Array(14).fill(0)];
    const sof = [0xff, 0xc0, ...be16(17), 8, ...be16(600), ...be16(800), 3];
    expect(parseSize(bytes([0xff, 0xd8], app0, sof, new Array(12).fill(0)))).toEqual({ w: 800, h: 600 });
  });

  it("swaps JPEG sides when EXIF says the picture is turned", () => {
    // TIFF big-endian, one IFD entry: Orientation (0x0112), SHORT, count 1, value 6 (90° CW).
    const tiff = [..."MM".split("").map((c) => c.charCodeAt(0)), 0, 42, ...be32(8), ...be16(1), ...be16(0x0112), ...be16(3), ...be32(1), ...be16(6), 0, 0];
    const exif = [..."Exif".split("").map((c) => c.charCodeAt(0)), 0, 0, ...tiff];
    const app1 = [0xff, 0xe1, ...be16(exif.length + 2), ...exif];
    const sof = [0xff, 0xc0, ...be16(17), 8, ...be16(3000), ...be16(4000), 3];
    expect(parseSize(bytes([0xff, 0xd8], app1, sof, new Array(12).fill(0)))).toEqual({ w: 3000, h: 4000 });
  });

  it("returns null for unknown data", () => {
    expect(parseSize(bytes("hello world, not an image"))).toBeNull();
  });
});

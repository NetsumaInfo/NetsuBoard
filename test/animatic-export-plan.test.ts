import { describe, expect, it } from "vitest";
import { cutAt, makeClip, removeFromShot, setFx, type ClipData } from "@/components/reference/clip/clipModel";
import {
  duckSpans, exportFileName, frameCount, itemSpans, lookAcross, lookAt, pinRect, soundPieces, videoTimeAt,
} from "@/components/reference/clip/exportPlan";

const frame = { x: 0, y: 0, w: 1600, h: 900 };
const clip = (): ClipData => makeClip(frame, ["a"]);

describe("Animatic export plan", () => {
  it("counts frames over the whole track", () => {
    expect(frameCount(clip(), 30)).toBe(900); // 30 s without music
    expect(frameCount({ ...clip(), music: { ref: "m", name: "m", dur: 2.5 } }, 24)).toBe(60);
  });

  it("fades an item in from the start of its span and out after its end", () => {
    const c = clip();
    expect(lookAt(c, "a", [1, 3], 0.9)).toBeNull();
    expect(lookAt(c, "a", [1, 3], 1)).toBeNull(); // first instant: nothing yet
    expect(lookAt(c, "a", [1, 3], 1.15)!.alpha).toBeGreaterThan(0.5);
    expect(lookAt(c, "a", [1, 3], 2)!.alpha).toBe(1);
    const out = lookAt(c, "a", [1, 3], 3.1)!;
    expect(out.alpha).toBeGreaterThan(0);
    expect(out.alpha).toBeLessThan(1);
    expect(lookAt(c, "a", [1, 3], 3.4)).toBeNull();
  });

  it("plays the zoom, slide and cut effects", () => {
    const zoom = setFx(clip(), ["a"], { kind: "zoom", dur: 1 });
    const z = lookAt(zoom, "a", [0, 5], 0.2)!;
    expect(z.scale).toBeGreaterThan(0.82);
    expect(z.scale).toBeLessThan(1);
    const slide = lookAt(setFx(clip(), ["a"], { kind: "slide", dur: 1 }), "a", [0, 5], 0.2)!;
    expect(slide.dy).toBeGreaterThan(0);
    const cut = setFx(clip(), ["a"], { kind: "cut", opacity: 0.5 });
    expect(lookAt(cut, "a", [0, 5], 0.001)).toEqual({ alpha: 0.5, scale: 1, dy: 0 });
    expect(lookAt(cut, "a", [0, 5], 5)).toBeNull();
  });

  it("fades a pinned item in only", () => {
    expect(lookAt(clip(), "a", [0, 2], 0.15, true)!.alpha).toBeLessThan(1);
    expect(lookAt(clip(), "a", [0, 2], 2.05, true)).toBeNull();
  });

  it("joins the shots an item stays in, splits where it leaves", () => {
    let c = cutAt(cutAt(clip(), 10), 20); // "a" sits in the three shots
    expect(itemSpans(c, "a")).toEqual([[0, 30]]);
    c = removeFromShot(c, 1, ["a"]);
    expect(itemSpans(c, "a")).toEqual([[0, 10], [20, 30]]);
    // Back on screen at 20: it appears again rather than staying faded out.
    expect(lookAcross(c, "a", itemSpans(c, "a"), 15)).toBeNull();
    expect(lookAcross(c, "a", itemSpans(c, "a"), 21)!.span).toEqual([20, 30]);
  });

  it("maps playing time to the video range for each loop type", () => {
    expect(videoTimeAt(5, 2, "loop")).toBeCloseTo(1);
    expect(videoTimeAt(5, 2, "once")).toBeCloseTo(1.999);
    expect(videoTimeAt(3, 2, "pingpong")).toBeCloseTo(1);
    expect(videoTimeAt(5, 2, "frozen")).toBe(0);
  });

  it("places sound pieces at every loop, forward halves of a ping-pong", () => {
    const base = { path: "v.mp4", in: 1, len: 2, speed: 1, span: [0, 5] as [number, number] };
    expect(soundPieces({ ...base, mode: "loop" }).map((p) => [p.at, p.from, p.to])).toEqual([[0, 1, 3], [2, 1, 3], [4, 1, 2]]);
    expect(soundPieces({ ...base, mode: "once" })).toHaveLength(1);
    expect(soundPieces({ ...base, mode: "pingpong" }).map((p) => p.at)).toEqual([0, 4]);
    expect(soundPieces({ ...base, mode: "frozen" })).toEqual([]);
    expect(soundPieces({ ...base, mode: "loop", speed: 2 })[0]).toMatchObject({ at: 0, from: 1, to: 3, speed: 2 });
  });

  it("merges overlapping duck spans", () => {
    expect(duckSpans([[4, 6], [1, 2], [1.5, 3]])).toEqual([[1, 3], [4, 6]]);
  });

  it("puts a pinned item in its corner", () => {
    expect(pinRect("br", 0.25, 2, 1920, 1080)).toEqual({ x: 1920 - 480 - 48, y: 1080 - 240 - 48, w: 480, h: 240 });
    expect(pinRect("tl", 0.25, 1, 1920, 1080)).toMatchObject({ x: 48, y: 48 });
  });

  it("names the file after the Animatic", () => {
    expect(exportFileName("Clip: final/v2")).toBe("Clip final v2.mp4");
    expect(exportFileName(undefined)).toBe("Animatic.mp4");
  });
});

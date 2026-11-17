import { describe, expect, it } from "vitest";
import {
  addToShot, beatGrid, beatsToSeconds, nudgeCut, remapClip, setTempo, shiftLong, shiftShotItems, shotItemSpan, snapPoints, tapTempo, cameraAt, cameraMove, cameraMoveOf, cascade, cutOnBeats, duplicateShot, frameOnItems, moveShot, patchShot, shotsPerItem, clipDuration, cutAt, deleteShot, fxOf, markIn, markOut, removeFromShot, resetTiming, setFx, fitSpeed, neighbourShotStart, rulerStep, unassigned, fitToDuration, frameAround, itemBar, laneOf,
  longToShot, makeClip, mergeShot, moveBoundary, normalizeClip, presentAt, pruneClip, setLongSpan,
  setShotItemTiming, setVideo, snapTime, toLong, viewForRect, type ClipData,
} from "@/components/reference/clip/clipModel";
import { analyse, computePeaks } from "@/components/reference/clip/audioAnalysis";
import { copyFolderContent } from "@/components/reference/boardFolders";

const F = { x: 0, y: 0, w: 1600, h: 900 };
const G = { x: 1600, y: 0, w: 800, h: 450 };

function clip(dur = 20): ClipData {
  return { ...makeClip(F, ["a", "b"]), music: { ref: "m.mp3", name: "m", dur } };
}

describe("clip model", () => {
  it("frames a box in 16:9", () => {
    const r = frameAround({ x: 0, y: 0, w: 100, h: 400 }, 0);
    expect(r.w / r.h).toBeCloseTo(16 / 9);
    expect(r.h).toBeCloseTo(400);
    expect(r.x + r.w / 2).toBeCloseTo(50);
  });

  it("letterboxes a framing in a viewport", () => {
    const v = viewForRect(F, 800, 800);
    expect(v.scale).toBeCloseTo(0.5);
    expect(v.ty).toBeCloseTo(400 - 450 * 0.5);
  });

  it("uses the music length, else a default", () => {
    expect(clipDuration(clip(12))).toBe(12);
    expect(clipDuration(makeClip(F, []))).toBe(30);
  });

  it("cuts a shot and keeps the items still present", () => {
    let c = clip();
    c = setShotItemTiming(c, 0, "b", { early: 15 }); // b leaves at 5 s
    c = cutAt(c, 10);
    expect(c.shots).toHaveLength(2);
    expect(c.shots[1].start).toBe(10);
    expect(c.shots[1].items.map((s) => s.id)).toEqual(["a"]);
  });

  it("refuses cuts too close to an edge", () => {
    expect(cutAt(clip(), 0.1).shots).toHaveLength(1);
    expect(cutAt(clip(), 19.95).shots).toHaveLength(1);
  });

  it("reports presence with offsets and the Long lane", () => {
    let c = setShotItemTiming(clip(), 0, "b", { delay: 4 });
    c = toLong({ ...c, shots: c.shots.map((s) => ({ ...s, items: [...s.items, { id: "l" }] })) }, ["l"], [2, 6]);
    expect([...presentAt(c, 1)].sort()).toEqual(["a"]);
    expect([...presentAt(c, 5)].sort()).toEqual(["a", "b", "l"]);
    expect([...presentAt(c, 7)].sort()).toEqual(["a", "b"]);
    expect(laneOf(c, "l")).toEqual({ long: true });
    expect(laneOf(c, "a")).toEqual({ shot: 0 });
  });

  it("keeps an item in one lane only", () => {
    let c = toLong(clip(), ["a"]);
    expect(c.shots[0].items.map((s) => s.id)).toEqual(["b"]);
    c = addToShot(c, 0, ["a"]);
    expect(c.long).toEqual([]);
    c = toLong(c, ["a"], [3, 8]);
    c = longToShot(cutAt(c, 5), "a");
    expect(c.shots[0].items.some((s) => s.id === "a")).toBe(true);
  });

  it("moves and merges boundaries", () => {
    let c = cutAt(clip(), 10);
    c = moveBoundary(c, 1, 12);
    expect(c.shots[1].start).toBe(12);
    c = moveBoundary(c, 1, 50);
    expect(c.shots[1].start).toBeCloseTo(20 - 0.25);
    c = mergeShot(c, 1);
    expect(c.shots).toHaveLength(1);
  });

  it("moves the camera inside a shot and glides between shots", () => {
    let c = { ...clip(), shots: [{ ...makeClip(F, []).shots[0], to: G }] };
    expect(cameraAt(c, 10).x).toBeCloseTo(800);
    c = cutAt(c, 10);
    c = { ...c, shots: c.shots.map((s, i) => (i === 1 ? { ...s, from: F, to: F, transition: "glide" as const, glide: 2 } : s)) };
    const mid = cameraAt(c, 11);
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.x).toBeLessThan(800);
    expect(cameraAt(c, 13).x).toBeCloseTo(0);
  });

  it("snaps to the nearest beat within tolerance", () => {
    const beats = [0.5, 1, 1.5, 2];
    expect(snapTime(1.08, beats, 0.1)).toBe(1);
    expect(snapTime(1.3, beats, 0.1)).toBe(1.3);
    expect(snapTime(5, [], 1)).toBe(5);
  });

  it("clamps video speed and fits a range to a bar", () => {
    let c = setVideo(clip(), "a", { speed: 10 });
    expect(c.videos.a.speed).toBe(4);
    c = setVideo(c, "a", { speed: 1 });
    expect(c.videos.a).toBeUndefined();
    expect(fitSpeed(4, 8)).toBe(0.5);
    expect(fitSpeed(100, 1)).toBe(4);
  });

  it("measures an item's bar across shots", () => {
    const c = cutAt(clip(), 10);
    expect(itemBar(c, "a")).toEqual([0, 20]);
    expect(itemBar(setLongSpan(toLong(c, ["b"]), "b", 2, 4), "b")).toEqual([2, 4]);
  });

  it("prunes deleted items and fits a shorter track", () => {
    let c = cutAt(clip(), 15);
    c = pruneClip(c, new Set(["a"]));
    expect(c.shots[0].items.map((s) => s.id)).toEqual(["a"]);
    c = fitToDuration({ ...c, music: { ref: "m", name: "m", dur: 10 } });
    expect(c.shots).toHaveLength(1);
  });

  it("deletes a shot into its neighbour and keeps the last one", () => {
    let c = cutAt(cutAt(clip(), 10), 15);
    expect(deleteShot(c, 1).shots.map((s) => s.start)).toEqual([0, 15]);
    expect(deleteShot(c, 0).shots.map((s) => s.start)).toEqual([0, 15]);
    c = deleteShot(deleteShot(c, 2), 1);
    expect(deleteShot(c, 0).shots).toHaveLength(1);
  });

  it("steps between shot starts", () => {
    const c = cutAt(cutAt(clip(), 10), 15);
    expect(neighbourShotStart(c, 12, 1)).toBe(15);
    expect(neighbourShotStart(c, 12, -1)).toBe(10);
    expect(neighbourShotStart(c, 10, -1)).toBe(0);
    expect(neighbourShotStart(c, 16, 1)).toBe(20);
  });

  it("lists items no lane shows, and spaces ruler ticks", () => {
    expect(unassigned(toLong(clip(), ["a"]), ["a", "b", "c"])).toEqual(["c"]);
    expect(rulerStep(100)).toBe(1);
    expect(rulerStep(10)).toBe(10);
  });

  it("marks the entry and the exit of several items at the playhead", () => {
    let c = cutAt(clip(), 10);
    c = markIn(c, ["a", "b"], 12);
    expect(presentAt(c, 11).has("a")).toBe(false);
    expect(presentAt(c, 12.5).has("a") && presentAt(c, 12.5).has("b")).toBe(true);
    c = markOut(c, ["a"], 16);
    expect(presentAt(c, 17).has("a")).toBe(false);
    expect(presentAt(c, 17).has("b")).toBe(true);
    c = toLong(c, ["b"], [2, 20]);
    c = markIn(c, ["b"], 5);
    expect(c.long[0].start).toBe(5);
  });

  it("brings an item into the shot under the playhead when it enters there", () => {
    let c = cutAt(clip(), 10);
    c = removeFromShot(c, 1, ["a"]);
    c = markIn(c, ["a"], 14);
    expect(presentAt(c, 15).has("a")).toBe(true);
  });

  it("cascades entries on the beats, else evenly, and resets them", () => {
    let c = { ...clip(), beats: [0, 0.5, 1, 1.5, 2] };
    c = cascade(c, 0, ["b", "a"]);
    expect(c.shots[0].items.find((s) => s.id === "a")?.delay).toBeCloseTo(0.5);
    c = cascade({ ...c, beats: [] }, 0, ["a", "b"]);
    expect(c.shots[0].items.find((s) => s.id === "b")?.delay).toBeCloseTo(5);
    c = resetTiming(c, 0, ["a", "b"]);
    expect(c.shots[0].items.every((s) => s.delay == null)).toBe(true);
  });

  it("stores only appearance settings that differ from the default", () => {
    let c = setFx(clip(), ["a", "b"], { kind: "zoom", dur: 9 });
    expect(c.fx?.a).toEqual({ kind: "zoom", dur: 2 });
    expect(fxOf(c, "b").kind).toBe("zoom");
    c = setFx(c, ["a"], { kind: "fade", dur: 0.3 });
    expect(c.fx?.a).toBeUndefined();
    expect(fxOf(c, "a")).toEqual({ kind: "fade", dur: 0.3, opacity: 1 });
  });

  it("makes one shot per item, each framed on it", () => {
    const boxes = [{ id: "a", box: { x: 0, y: 0, w: 100, h: 100 } }, { id: "b", box: { x: 500, y: 0, w: 100, h: 100 } }, { id: "c", box: { x: 0, y: 500, w: 100, h: 100 } }];
    let c = toLong(clip(), ["b"]);
    c = shotsPerItem(c, 5, boxes, 4);
    expect(c.shots.map((s) => s.start)).toEqual([0, 5, 9, 13]);
    expect(c.shots.slice(1).map((s) => s.items.map((x) => x.id))).toEqual([["a"], ["b"], ["c"]]);
    expect(c.shots[2].from.x + c.shots[2].from.w / 2).toBeCloseTo(550);
    expect(c.long).toEqual([]);
    // Not enough room: the items that do not fit are left out.
    expect(shotsPerItem(clip(), 18, boxes, 4).shots.length).toBe(2);
  });

  it("cuts every n beats and converts beats to seconds", () => {
    const c = { ...clip(), bpm: 120, beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4] };
    expect(cutOnBeats(c, 4).shots.map((s) => s.start)).toEqual([0, 2, 4]);
    expect(beatsToSeconds(c, 4)).toBe(2);
    expect(beatsToSeconds(clip(), 4)).toBeNull();
  });

  it("applies and recognises ready-made camera moves", () => {
    let c = cameraMove(clip(), 0, "zoomIn");
    expect(c.shots[0].to.w).toBeCloseTo(F.w * 0.72);
    expect(cameraMoveOf(c.shots[0])).toBe("zoomIn");
    c = cameraMove(c, 0, "panRight");
    expect(cameraMoveOf(c.shots[0])).toBe("panRight");
    expect(cameraMoveOf(cameraMove(c, 0, "static").shots[0])).toBe("static");
  });

  it("frames a shot on its items, duplicates and reorders shots", () => {
    let c = frameOnItems(clip(), 0, [{ x: 0, y: 0, w: 160, h: 90 }]);
    expect(c.shots[0].from.w / c.shots[0].from.h).toBeCloseTo(16 / 9);
    c = duplicateShot(c, 0);
    expect(c.shots).toHaveLength(2);
    expect(c.shots[1].items.map((s) => s.id)).toEqual(["a", "b"]);
    c = patchShot(c, 1, { label: "B" });
    const moved = moveShot(c, 1, 0);
    expect(moved.shots.map((s) => s.label)).toEqual(["B", undefined]);
    expect(moved.shots.map((s) => s.start)).toEqual([0, 10]);
  });

  it("points a duplicated timeline at the copied items", () => {
    const c = setFx(setVideo(toLong(clip(), ["b"]), "a", { speed: 2 }), ["a"], { kind: "zoom" });
    const ids = new Map([["a", "a2"], ["b", "b2"]]);
    const d = remapClip(c, ids);
    expect(d.shots[0].items.map((s) => s.id)).toEqual(["a2"]);
    expect(d.shots[0].id).not.toBe(c.shots[0].id);
    expect(d.long[0].id).toBe("b2");
    expect(d.videos.a2?.speed).toBe(2);
    expect(d.fx?.a2?.kind).toBe("zoom");
  });

  it("copies everything a folder holds, nested folders included", () => {
    let n = 0;
    const base = { ref: "", src: "", x: 0, y: 0, w: 10, h: 10, rotation: 0, z: 0 };
    const stash = [
      { ...base, id: "x", kind: "text" as const, parent: "f" },
      { ...base, id: "g", kind: "frame" as const, folder: true, parent: "f" },
      { ...base, id: "y", kind: "image" as const, parent: "g" },
      { ...base, id: "z", kind: "image" as const },
    ];
    const { items, ids } = copyFolderContent("f", "f2", stash, () => `n${++n}`);
    expect(items.map((it) => it.parent)).toEqual(["f2", "f2", ids.get("g")]);
    expect(ids.size).toBe(3);
  });

  it("normalises a damaged clip", () => {
    expect(normalizeClip(null)).toBeNull();
    expect(normalizeClip({ shots: [] })).toBeNull();
    const n = normalizeClip({ shots: [{ id: "s", start: 3, from: F, to: F }] });
    expect(n?.shots[0].start).toBe(0);
    expect(n?.shots[0].items).toEqual([]);
    expect(n?.snap).toBe(true);
  });
});

describe("audio analysis", () => {
  it("normalises peaks", () => {
    const p = computePeaks(new Float32Array([0, 0.5, -1, 0.25]), 2);
    expect(p).toEqual([0.5, 1]);
  });

  it("finds the tempo of a click track", () => {
    const sr = 22050;
    const secs = 12;
    const s = new Float32Array(sr * secs);
    const bpm = 120;
    for (let b = 0; b * (60 / bpm) < secs; b++) {
      const at = Math.floor(b * (60 / bpm) * sr);
      for (let i = 0; i < 400 && at + i < s.length; i++) s[at + i] = Math.sin(i * 0.9) * Math.exp(-i / 80);
    }
    const a = analyse(s, sr);
    expect(a.bpm).not.toBeNull();
    expect(Math.abs((a.bpm ?? 0) - bpm)).toBeLessThan(4);
    expect(a.beats.length).toBeGreaterThan(18);
    const offBeat = a.beats.map((t) => Math.abs(t * 2 - Math.round(t * 2)) / 2);
    expect(Math.max(...offBeat.slice(1, -1))).toBeLessThan(0.05);
  });
});

describe("clip timing tools", () => {
  it("snaps to beats, cuts, the end and extra points", () => {
    let c = cutAt({ ...clip(20), beats: [1, 2, 3] }, 7);
    const pts = snapPoints(c, [12.5]);
    expect(pts).toEqual([0, 1, 2, 3, 7, 12.5, 20]);
    expect(snapTime(12.4, pts, 0.2)).toBe(12.5);
    expect(snapTime(6.9, pts, 0.2)).toBe(7);
    c = { ...c, beats: undefined };
    expect(snapPoints(c)).toEqual([0, 7, 20]);
  });

  it("nudges the nearest cut by one beat, or a step without beats", () => {
    let c = cutAt(cutAt({ ...clip(20), beats: [0, 2, 4, 6, 8, 10, 12] }, 4), 10);
    const r = nudgeCut(c, 9.5, 1)!;
    expect(r.at).toBe(12);
    expect(r.clip.shots[2].start).toBe(12);
    expect(nudgeCut(c, 3, -1)!.at).toBe(2);
    c = { ...c, beats: undefined };
    expect(nudgeCut(c, 3, 1, 0.5)!.at).toBeCloseTo(4.5);
    expect(nudgeCut(clip(), 3, 1)).toBeNull();
  });

  it("reads a tempo from taps and builds a grid on an anchor", () => {
    expect(tapTempo([0, 0.5])).toBeNull();
    expect(tapTempo([0, 0.5, 1, 1.5, 2.1])).toBe(120);
    const g = beatGrid(120, 1.25, 4);
    expect(g).toEqual([0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75]);
    expect(beatGrid(0, 0, 10)).toEqual([]);
    const c = setTempo(clip(4), 60, 0.5);
    expect(c.bpm).toBe(60);
    expect(c.beats).toEqual([0.5, 1.5, 2.5, 3.5]);
  });

  it("slides items of a shot together, kept inside the shot", () => {
    let c = setShotItemTiming(clip(20), 0, "a", { delay: 2, early: 10 }); // a: 2–10
    c = setShotItemTiming(c, 0, "b", { delay: 4, early: 4 }); // b: 4–16
    const moved = shiftShotItems(c, 0, ["a", "b"], 10);
    expect(shotItemSpan(moved, 0, moved.shots[0].items[0])).toEqual([6, 14]);
    expect(shotItemSpan(moved, 0, moved.shots[0].items[1])).toEqual([8, 20]);
    const back = shiftShotItems(c, 0, ["a"], -5);
    expect(back.shots[0].items[0]).toEqual({ id: "a", early: 12 });
  });

  it("slides Long items together inside the track", () => {
    let c = toLong(clip(20), ["a"], [2, 6]);
    c = toLong(c, ["b"], [10, 18]);
    const m = shiftLong(c, ["a", "b"], 5);
    expect(m.long.map((l) => [l.start, l.end])).toEqual([[4, 8], [12, 20]]);
  });
});

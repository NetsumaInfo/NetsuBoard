import { describe, expect, it } from "vitest";

import { diffText, diffBoard, unresolvedMediaItems } from "../../src/lib/collab/operations";
import type { BoardItem } from "../../src/components/reference/referenceShared";

function note(text: string): BoardItem {
  return {
    id: "note", kind: "text", ref: "", src: "", x: 0, y: 0, w: 100, h: 100,
    rotation: 0, z: 0, text,
  };
}

describe("collaboration operation diff", () => {
  it("diffs text by Unicode scalar value", () => {
    expect(diffText("note", "a👩🏽‍🎨z", "aé👩🏽‍🎨z")).toEqual([
      { type: "textInsert", itemId: "note", index: 1, text: "é" },
    ]);
  });

  it("never serializes transient renderer fields", () => {
    const previous = note("hello");
    const next = { ...previous, src: "blob:secret", loading: true, missing: { name: "x", size: 1, kind: "image" } };
    expect(diffBoard([previous], [next])).toEqual([]);
  });

  it("emits reordering independently from geometry", () => {
    const a = { ...note("a"), id: "a", z: 0 };
    const b = { ...note("b"), id: "b", z: 1 };
    expect(diffBoard([a, b], [{ ...b, z: 0 }, { ...a, z: 1 }])).toContainEqual({
      type: "moveItem", itemId: "b", before: "a",
    });
  });

  // Bring-to-front rewrites `z` and leaves the array alone; diffing array positions saw nothing.
  it("transmits a stacking change that leaves the array order untouched", () => {
    const a = { ...note("a"), id: "a", z: 0 };
    const b = { ...note("b"), id: "b", z: 1 };
    // `a` above `b` is expressed by moving `b` under it; the array is left in its original order.
    expect(diffBoard([a, b], [{ ...a, z: 2 }, b])).toContainEqual({
      type: "moveItem", itemId: "b", before: "a",
    });
  });

  it("does not publish the frame a sequence is currently showing", () => {
    const previous: BoardItem = {
      id: "seq", kind: "sequence", ref: "", src: "", x: 0, y: 0, w: 10, h: 10,
      rotation: 0, z: 0, frame: 3, seqPlay: true, fps: 12,
    };
    expect(diffBoard([previous], [{ ...previous, frame: 4 }])).toEqual([]);
    expect(diffBoard([previous], [{ ...previous, fps: 24 }])).toContainEqual(
      expect.objectContaining({ type: "setPlayback", itemId: "seq" }),
    );
  });

  it("keeps a media the document already holds when the file cannot be read", () => {
    const previous: BoardItem = {
      id: "shot", kind: "image", ref: "collab:" + "a".repeat(64), src: "", x: 0, y: 0,
      w: 10, h: 10, rotation: 0, z: 0,
    };
    const next = { ...previous, ref: "S:/moved/away.png" };
    const ops = diffBoard([previous], [next]);
    expect(ops.some((op) => op.type === "setMediaManifest")).toBe(false);
    expect(unresolvedMediaItems()).toEqual(["shot"]);
  });

  it("clears the media only when the item really has none left", () => {
    const previous: BoardItem = {
      id: "shot", kind: "image", ref: "https://example.com/a.png", src: "", x: 0, y: 0,
      w: 10, h: 10, rotation: 0, z: 0,
    };
    expect(diffBoard([previous], [{ ...previous, ref: "" }])).toContainEqual({
      type: "setMediaManifest", itemId: "shot", manifest: null,
    });
    expect(unresolvedMediaItems()).toEqual([]);
  });

  // Le document REFUSE une sortie au-delà de la durée, et un lot rejeté l'est en ENTIER : une borne
  // posée avant que la durée exacte ne soit connue faisait tomber le partage complet, donc publiait
  // un board qui semblait réinitialisé.
  it("never emits an out point beyond the media duration", () => {
    const clip: BoardItem = {
      id: "clip", kind: "video", ref: "C:/a.mp4", src: "", x: 0, y: 0, w: 10, h: 10,
      rotation: 0, z: 0, trimIn: 2, trimOut: 140, dur: 132.1,
    };
    const setTrim = diffBoard([], [clip]).find((op) => op.type === "setTrim");
    expect(setTrim).toMatchObject({ trim: { start: 2, end: 132.1, duration: 132.1 } });
  });

  it("carries the loop range of a shared clip on first publication", () => {
    const clip: BoardItem = {
      id: "clip", kind: "video", ref: "C:/a.mp4", src: "", x: 0, y: 0, w: 10, h: 10,
      rotation: 0, z: 0, trimIn: 77.3, trimOut: 132.1, dur: 240,
    };
    expect(diffBoard([], [clip])).toContainEqual({
      type: "setTrim", itemId: "clip", trim: { start: 77.3, end: 132.1, duration: 240 },
    });
  });

  // Un trait au crayon ne porte aucun champ modifiable dans le document : le CHANGER s'exprime par
  // une suppression suivie d'un ajout sur le MÊME identifiant. Le natif doit donc accepter cette
  // paire — il la refusait, et c'est tout le lot qui tombait : le changement ne s'appliquait jamais
  // et la barre restait bloquée sur « synchronisation en attente ».
  it("expresses a pen stroke edit as delete then add on the same id", () => {
    const draw = (shapes: BoardItem["shapes"]): BoardItem => ({
      id: "draw", kind: "draw", ref: "", src: "", x: 0, y: 0, w: 0, h: 0, rotation: 0, z: 0, shapes,
    });
    const stroke = { id: "s1", t: "pen" as const, c: "#fff", w: 4, p: [0, 0, 10, 10] };
    const ops = diffBoard([draw([stroke])], [draw([{ ...stroke, c: "#f00" }])]);
    const strokeOps = ops.filter((op) => op.type === "deleteStroke" || op.type === "addStroke");
    expect(strokeOps.map((op) => op.type)).toEqual(["deleteStroke", "addStroke"]);
    expect(strokeOps.every((op) => "strokeId" in op && op.strokeId === "s1")).toBe(true);
  });
});

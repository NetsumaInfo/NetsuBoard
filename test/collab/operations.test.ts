import { describe, expect, it } from "vitest";

import { diffText, diffBoard } from "../../src/lib/collab/operations";
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
});

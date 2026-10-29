// Folders: a frame folded into a card whose content lives one level down. The store shows one
// level and parks the others; these tests hold the round trips that must never lose an item.

import { describe, expect, it } from "vitest";
import {
  FOLDER_W,
  foldFrame,
  folderChildren,
  folderCover,
  parkInto,
  sceneItems,
  splitLevel,
  switchLevel,
  unfoldFrame,
} from "@/components/reference/boardFolders";
import type { BoardItem } from "@/components/reference/referenceShared";

const item = (id: string, x: number, y: number, extra: Partial<BoardItem> = {}): BoardItem =>
  ({ id, kind: "image", ref: id, src: `blob:${id}`, x, y, w: 100, h: 100, rotation: 0, z: 1, ...extra });
const frame = (id: string, x: number, y: number, extra: Partial<BoardItem> = {}): BoardItem =>
  ({ ...item(id, x, y), kind: "frame", ref: "", src: "", w: 640, h: 420, z: 0, text: id, ...extra });

describe("folders", () => {
  it("folds a frame's content one level down and unfolds it back", () => {
    const f = frame("f", 0, 0);
    const level = [f, item("a", 50, 80), item("b", 300, 200), item("out", 2000, 0)];
    const folded = foldFrame(f, level, []);
    expect(folded.items.map((it) => it.id)).toEqual(["f", "out"]);
    expect(folded.items[0]).toMatchObject({ folder: true, w: FOLDER_W, openW: 640 });
    expect(folded.stash.map((it) => [it.id, it.parent])).toEqual([["a", "f"], ["b", "f"]]);

    const unfolded = unfoldFrame(folded.items[0], folded.items, folded.stash);
    expect(unfolded.stash).toEqual([]);
    expect(unfolded.items.map((it) => it.id).sort()).toEqual(["a", "b", "f", "out"]);
    const back = unfolded.items.find((it) => it.id === "f")!;
    expect(back.folder).toBeUndefined();
    expect(unfolded.items.every((it) => it.parent === undefined)).toBe(true);
  });

  it("saves every level and reopens on the top level", () => {
    const f = frame("f", 0, 0);
    const folded = foldFrame(f, [f, item("a", 50, 80)], []);
    const inside = switchLevel(folded.items, folded.stash, null, "f");
    expect(inside.items.map((it) => it.id)).toEqual(["a"]);
    const saved = sceneItems(inside.items, inside.stash, "f");
    expect(saved.find((it) => it.id === "a")?.parent).toBe("f");
    const reopened = splitLevel(saved, null);
    expect(reopened.items.map((it) => it.id)).toEqual(["f"]);
    expect(reopened.stash.map((it) => it.id)).toEqual(["a"]);
  });

  it("drops the content of a deleted folder at save, and rescues items of a missing one at load", () => {
    const stash = [item("a", 0, 0, { parent: "gone" })];
    expect(sceneItems([item("top", 0, 0)], stash, null).map((it) => it.id)).toEqual(["top"]);
    const loaded = splitLevel([item("a", 0, 0, { parent: "gone" })], null);
    expect(loaded.items.map((it) => [it.id, it.parent])).toEqual([["a", undefined]]);
  });

  it("parks dropped items in a folder card and picks the cover", () => {
    const card = frame("f", 0, 0, { folder: true, w: FOLDER_W });
    const next = parkInto("f", ["a", "f"], [card, item("a", 10, 10)], [])!;
    expect(next.items.map((it) => it.id)).toEqual(["f"]);
    const kids = folderChildren("f", next.stash);
    expect(folderCover(card, kids)?.id).toBe("a");
    expect(folderCover({ ...card, cover: "gone" }, kids)?.id).toBe("a");
  });

  it("keeps a nested folder's content when the outer one unfolds", () => {
    const inner = frame("in", 0, 0, { folder: true, w: FOLDER_W, h: 220, parent: "out" });
    const outer = frame("out", 0, 0, { folder: true, w: FOLDER_W, h: 220 });
    const stash = [inner, item("deep", 0, 0, { parent: "in" })];
    const up = unfoldFrame(outer, [outer], stash);
    expect(up.items.map((it) => it.id).sort()).toEqual(["in", "out"]);
    expect(up.stash.map((it) => it.id)).toEqual(["deep"]);
    expect(sceneItems(up.items, up.stash, null).map((it) => it.id).sort()).toEqual(["deep", "in", "out"]);
  });
});

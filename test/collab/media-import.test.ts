import { describe, expect, it, vi } from "vitest";

import type { BoardItem } from "../../src/components/reference/referenceShared";

const importMedia = vi.fn();

vi.mock("../../src/lib/collab/client", () => ({
  importMedia: (...args: unknown[]) => importMedia(...args),
  collabErrorMessage: (error: unknown, fallback: string) =>
    (error as { message?: string })?.message ?? fallback,
}));

const { importBoardAssets } = await import("../../src/lib/collab/media");

function item(partial: Partial<BoardItem> & Pick<BoardItem, "id" | "kind" | "ref">): BoardItem {
  return { src: "", x: 0, y: 0, w: 10, h: 10, rotation: 0, z: 0, ...partial };
}

describe("collaboration asset import", () => {
  it("never asks the file importer for a YouTube id or a remote URL", async () => {
    importMedia.mockClear();
    const result = await importBoardAssets("p".repeat(32), [
      item({ id: "yt", kind: "youtube", ref: "rMF4IgukUy4" }),
      item({ id: "web", kind: "image", ref: "https://example.com/a.png" }),
    ]);
    expect(importMedia).not.toHaveBeenCalled();
    expect(result.missing).toEqual([]);
  });

  it("reports the native cause instead of an unreadable object", async () => {
    importMedia.mockClear();
    importMedia.mockRejectedValue({ code: "storage", message: "os error 2" });
    const result = await importBoardAssets("p".repeat(32), [
      item({ id: "shot", kind: "image", ref: "S:/gone/away.png" }),
    ]);
    expect(result.missing).toEqual([{ ref: "S:/gone/away.png", cause: "os error 2" }]);
  });

  it("retries a dead reference only once per session", async () => {
    importMedia.mockClear();
    importMedia.mockRejectedValue({ code: "storage", message: "os error 2" });
    const items = [item({ id: "shot", kind: "image", ref: "S:/gone/away.png" })];
    const cache = new Map();
    const failures = new Map<string, string>();
    await importBoardAssets("p".repeat(32), items, cache, failures);
    await importBoardAssets("p".repeat(32), items, cache, failures);
    expect(importMedia).toHaveBeenCalledTimes(1);
  });
});

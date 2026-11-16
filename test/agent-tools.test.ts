// AI agent tools (agentTools.ts): what an MCP client asks must land in the board store exactly like
// a hand edit — undoable, on the right items, and refused with a clear error when it cannot apply.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Ingest tools wait for the board to stop reshaping new media (2.5 s of stillness) before placing.
vi.setConfig({ testTimeout: 30000 });

vi.stubGlobal("window", { innerWidth: 1000, innerHeight: 800, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => true });
// A web image "loads" unless its address says it is dead (stands in for the browser's <img>).
vi.stubGlobal("Image", class {
  naturalWidth = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(v: string) {
    setTimeout(() => {
      if (v.includes("dead")) this.onerror?.();
      else { this.naturalWidth = 10; this.onload?.(); }
    }, 0);
  }
});
vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });

vi.mock("@/components/reference/boardRender", async (importOriginal) => ({
  exportLayout: (await importOriginal<typeof import("@/components/reference/boardRender")>()).exportLayout,
  renderBoardCanvas: vi.fn(async () => ({ width: 320, height: 200, toDataURL: () => "data:image/png;base64,QUJD" })),
  renderBoardSvg: vi.fn(async () => "<svg/>"),
}));
vi.mock("@/components/reference/boardMediaActions", () => ({
  convertToEmbed: vi.fn(), downloadMediaFromEmbed: vi.fn(async () => true), downloadYoutube: vi.fn(async () => true),
  recoverMedia: vi.fn(async () => true), reloadMedia: vi.fn(async () => false), revertSequence: vi.fn(),
}));
vi.mock("@/components/reference/boardUpscale", () => ({ quickUpscale: vi.fn(async () => true) }));
vi.mock("@/components/reference/boardPaletteActions", () => ({ extractPaletteToBoard: vi.fn(async () => undefined) }));
vi.mock("@/components/reference/note/noteExport", () => ({
  markdownToBlocks: vi.fn(async (md: string) => [{ type: "paragraph", content: md }]),
  blocksToMarkdown: vi.fn(async () => "# md"),
  blocksToPlain: vi.fn((blocks: { content: string }[]) => blocks.map((b) => b.content).join("\n")),
}));

const { runAgentTool, AGENT_TOOL_NAMES } = await import("@/components/reference/agentTools");
const { useBoard } = await import("@/components/reference/useReferenceBoard");
const { quickUpscale } = await import("@/components/reference/boardUpscale");
const { frameContentIds } = await import("@/components/reference/boardFrames");
const { nr } = await import("@/lib/bridge");
// The core downloads a web image unless the address is dead.
nr.reference!.fetchAsset = vi.fn(async (url: string) => (url.includes("dead") ? { ok: false, error: "Error: HTTP 404" } : { ok: true, path: `C:/assets/${url.split("/").pop()}`, kind: "image" as const }));
type BoardItem = import("@/components/reference/referenceShared").BoardItem;
type BoardHandle = import("@/components/reference/ReferenceBoard").BoardHandle;

const fresh = (extra: Partial<BoardItem>) => {
  const { id: _id, ...rest } = img("x", 0, 0, extra);
  return useBoard.getState().addItem(rest);
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const img = (id: string, x: number, y: number, extra: Partial<BoardItem> = {}): BoardItem =>
  ({ id, kind: "image", ref: `C:/m/${id}.png`, src: `blob:${id}`, x, y, w: 100, h: 100, rotation: 0, z: 1, natW: 200, natH: 100, ...extra });

const handle = {
  addPaths: vi.fn((paths: string[]) => {
    paths.forEach((p) => fresh({ ref: p }));
  }),
  addUrl: vi.fn(async (url: string) => {
    if (!url.startsWith("http")) return false;
    const title = decodeURIComponent(url.split("/").pop() ?? "").replace(/\.\w+$/, "");
    fresh({ ref: url, sourceUrl: url, title, natW: 300, natH: 200, w: 300, h: 200 });
    return true;
  }),
  addFrame: vi.fn(() => fresh({ kind: "frame", ref: "", text: "Frame" })),
  addLinkCard: vi.fn((url: string) => /^https?:/.test(url) && !!fresh({ kind: "embed", ref: url })),
  fit: vi.fn(), fitSelection: vi.fn(), zoomBy: vi.fn(),
  copySelection: vi.fn(async () => undefined), pasteItems: vi.fn(() => 0),
} as unknown as BoardHandle;

const goBoard = vi.fn();
const persistence = {
  list: vi.fn(async () => [{ id: "s1", name: "One" }]), recentProjects: vi.fn(async () => []),
  open: vi.fn(async () => undefined), openProject: vi.fn(async () => true), save: vi.fn(async () => ({ ok: true })),
  remove: vi.fn(async () => ({ ok: true })),
};
const ctx = { board: { current: handle }, persistence, project: { save: vi.fn() }, goBoard } as never;
const run = (tool: string, args: Record<string, unknown> = {}) => runAgentTool(tool, args, ctx);

beforeEach(async () => {
  useBoard.getState().loadScene({ id: "s0", name: "Test", items: [img("a", 0, 0), img("b", 300, 50), img("c", 600, 200)] });
  useBoard.setState({ past: [], future: [], selectedIds: [], selectedId: null, view: { tx: 0, ty: 0, scale: 1 } });
  await tick();
  vi.clearAllMocks();
});

describe("agent tools", () => {
  it("rejects unknown tools", async () => {
    expect(await run("nope")).toMatchObject({ ok: false, error: expect.stringContaining("Unknown tool") });
    expect(AGENT_TOOL_NAMES.length).toBeGreaterThan(30);
  });

  it("reads the board without display URLs", async () => {
    const state = await run("board_state");
    expect(state).toMatchObject({ ok: true, result: { name: "Test", counts: { image: 3 }, viewCenter: { x: 500, y: 400 } } });
    const items = (await run("list_items")).result as Record<string, unknown>[];
    expect(items.map((it) => it.id)).toEqual(["a", "b", "c"]);
    expect(items.every((it) => !("src" in it))).toBe(true);
    expect((await run("find_items", { query: "B.PNG" })).result).toMatchObject([{ id: "b" }]);
    expect(await run("get_item", { id: "zz" })).toMatchObject({ ok: false });
  });

  it("returns a screenshot as an MCP image", async () => {
    const shot = await run("screenshot", { ids: ["a"] });
    expect(shot.image).toEqual({ data: "QUJD", mimeType: "image/png" });
    expect(shot.result).toMatchObject({ width: 320, height: 200 });
  });

  it("adds text at the given place, styled, as one undo step", async () => {
    const res = await run("add_text", { text: "Hello", x: 10, y: 20, color: "#ff0000", bold: true });
    expect(goBoard).toHaveBeenCalled();
    const id = (res.result as { added: { id: string }[] }).added[0].id;
    const it = useBoard.getState().items.find((x) => x.id === id)!;
    expect(it).toMatchObject({ kind: "text", text: "Hello", x: 10, y: 20, color: "#ff0000", bold: true });
    await tick();
    useBoard.getState().undo();
    expect(useBoard.getState().items.some((x) => x.id === id)).toBe(false);
  });

  it("centres new items in the view when no place is given", async () => {
    const res = await run("add_markdown_block", { markdown: "# Title", w: 200, h: 100 });
    const id = (res.result as { added: { id: string }[] }).added[0].id;
    expect(useBoard.getState().items.find((x) => x.id === id)).toMatchObject({ x: 400, y: 350, text: "# Title", noteStyle: "postit" });
  });

  it("writes a note sheet from Markdown", async () => {
    const res = await run("add_note_sheet", { markdown: "body", title: "T" });
    const id = (res.result as { added: { id: string }[] }).added[0].id;
    expect(useBoard.getState().items.find((x) => x.id === id)).toMatchObject({ doc: [{ content: "body" }], text: "body", title: "T" });
    await run("set_text", { id, text: "new" });
    expect(useBoard.getState().items.find((x) => x.id === id)).toMatchObject({ doc: [{ content: "new" }], text: "new" });
  });

  it("adds media from paths and moves them to x/y", async () => {
    const res = await run("add_media", { paths: ["C:/in/one.png"], x: 1000, y: 2000 });
    expect(handle.addPaths).toHaveBeenCalledWith(["C:/in/one.png"], undefined);
    expect((res.result as { added: { x: number; y: number }[] }).added[0]).toMatchObject({ x: 1000, y: 2000 });
    expect((await run("add_media", { urls: ["ftp://x"] })).result).toMatchObject({ refused: ["ftp://x"] });
    expect(await run("add_media", {})).toMatchObject({ ok: false });
  });

  it("wraps items in a titled frame", async () => {
    const res = await run("add_frame", { ids: ["a", "b"], title: "Refs", color: "#00ff00" });
    const frame = useBoard.getState().items.find((it) => it.kind === "frame")!;
    expect(frame).toMatchObject({ x: -28, y: -52, w: 456, h: 230, z: 0, color: "#00ff00" });
    expect((res.result as { added: { kind: string; text: string }[] }).added[0]).toMatchObject({ kind: "frame", text: "Refs" });
  });

  it("adds a palette from colours", async () => {
    const res = await run("add_palette", { colors: ["#111111", "#222222", "#333333"], x: 0, y: 500 });
    expect((res.result as { added: Record<string, unknown>[] }).added[0]).toMatchObject({ kind: "palette", colors: ["#111111", "#222222", "#333333"], x: 0, y: 500 });
  });

  it("patches several items in one undo step and removes fields set to null", async () => {
    useBoard.getState().patchItem("a", { opacity: 0.5 });
    await tick();
    const depth = useBoard.getState().past.length;
    await run("update_items", { updates: [{ id: "a", patch: { x: 50, opacity: null, src: "evil" } }, { id: "b", patch: { rotation: 45 } }] });
    await tick();
    const [a, b] = useBoard.getState().items;
    expect(a).toMatchObject({ x: 50, src: "blob:a" });
    expect(a.opacity).toBeUndefined();
    expect(b.rotation).toBe(45);
    expect(useBoard.getState().past.length).toBe(depth + 1);
    expect(await run("update_items", { updates: [{ id: "ghost", patch: {} }] })).toMatchObject({ ok: false, error: expect.stringContaining("ghost") });
  });

  it("moves by offset or to a place, defaulting to the selection", async () => {
    await run("move_items", { ids: ["a", "b"], dx: 10, dy: -5 });
    expect(useBoard.getState().items.slice(0, 2).map((it) => [it.x, it.y])).toEqual([[10, -5], [310, 45]]);
    useBoard.getState().selectMany(["c"]);
    await run("move_items", { x: 0, y: 0 });
    expect(useBoard.getState().items[2]).toMatchObject({ x: 0, y: 0 });
    useBoard.getState().select(null);
    expect(await run("move_items", { dx: 1 })).toMatchObject({ ok: false });
  });

  it("resizes media on their native ratio", async () => {
    await run("resize_item", { id: "a", w: 400 });
    expect(useBoard.getState().items[0]).toMatchObject({ w: 400, h: 200 });
    await run("resize_item", { id: "a", scale: 0.5 });
    expect(useBoard.getState().items[0]).toMatchObject({ w: 200, h: 100 });
    await run("resize_item", { id: "a", w: 50, h: 50, keepRatio: false });
    expect(useBoard.getState().items[0]).toMatchObject({ w: 50, h: 50 });
  });

  it("rotates, duplicates, deletes", async () => {
    await run("rotate_items", { ids: ["a"], rotation: -90 });
    expect(useBoard.getState().items[0].rotation).toBe(270);
    const dup = await run("duplicate_items", { ids: ["b"] });
    expect((dup.result as { added: unknown[] }).added).toHaveLength(1);
    await run("delete_items", { ids: ["a", "c"] });
    expect(useBoard.getState().items.map((it) => it.id)).not.toContain("a");
    expect(useBoard.getState().items).toHaveLength(2);
  });

  it("arranges and tidies a selection of at least two items", async () => {
    await run("arrange_items", { ids: ["a", "b", "c"], mode: "top" });
    expect(useBoard.getState().items.map((it) => it.y)).toEqual([0, 0, 0]);
    expect(await run("arrange_items", { ids: ["a"], mode: "left" })).toMatchObject({ ok: false });
    expect(await run("tidy_items", { ids: ["a", "b", "c"], layout: "row", gap: 10 })).toMatchObject({ ok: true });
  });

  it("selects, and undoes through the board tool", async () => {
    expect((await run("select", { all: true })).result).toMatchObject({ selection: ["a", "b", "c"] });
    expect((await run("select", { ids: [] })).result).toMatchObject({ selection: [] });
    await run("move_items", { ids: ["a"], dx: 100 });
    await tick();
    await run("board", { action: "undo" });
    expect(useBoard.getState().items[0].x).toBe(0);
    await run("board", { action: "rename", name: "Renamed" });
    expect(useBoard.getState().sceneName).toBe("Renamed");
  });

  it("draws shapes and links items", async () => {
    const res = await run("draw", { action: "add", shapes: [{ t: "rect", p: [0, 0, 50, 50], c: "#fff" }] });
    expect((res.result as { added: string[] }).added).toHaveLength(1);
    expect(((await run("draw", { action: "list" })).result as unknown[]).length).toBe(1);
    await run("links", { action: "chain", ids: ["a", "b", "c"] });
    const links = (await run("links", { action: "list" })).result as { from: string; to: string }[];
    expect(links.map((l) => [l.from, l.to])).toEqual([["a", "b"], ["b", "c"]]);
    await run("links", { action: "unlink", ids: ["b"] });
    expect(((await run("links", { action: "list" })).result as unknown[]).length).toBe(0);
    await run("draw", { action: "clear" });
    expect(((await run("draw", { action: "list" })).result as unknown[]).length).toBe(0);
  });

  it("runs media actions and reports their failure", async () => {
    expect(await run("media", { action: "upscale", id: "a" })).toMatchObject({ ok: true });
    expect(quickUpscale).toHaveBeenCalledWith("a");
    expect(await run("media", { action: "reload", id: "a" })).toMatchObject({ ok: false });
  });

  it("lists, opens and saves scenes", async () => {
    expect((await run("scenes", { action: "list" })).result).toMatchObject({ scenes: [{ id: "s1" }] });
    await run("scenes", { action: "open", id: "s1" });
    expect(persistence.open).toHaveBeenCalledWith("s1");
    await run("scenes", { action: "save", name: "Mine" });
    expect(persistence.save).toHaveBeenCalledWith("Mine");
  });

  it("reads and writes board preferences", async () => {
    const before = (await run("board_prefs")).result as Record<string, unknown>;
    expect(before).toHaveProperty("defaultFontSize");
    const after = (await run("board_prefs", { patch: { defaultFontSize: 33 } })).result as Record<string, unknown>;
    expect(after.defaultFontSize).toBe(33);
  });
});

// What an agent really does with the board: several tools in a row, building on what the previous
// ones answered. Each scenario is one prompt a user would give.
describe("agent scenarios", () => {
  const ids = (res: { result?: unknown }) => ((res.result as { added: { id: string }[] }).added).map((it) => it.id);
  const item = (id: string) => useBoard.getState().items.find((it) => it.id === id)!;
  const inside = (frameId: string) => new Set(frameContentIds(item(frameId), useBoard.getState().items));

  it("finds dragon and castle references on the web, adds them and sorts them by theme", async () => {
    useBoard.getState().loadScene({ id: "s0", name: "Untitled", items: [] });
    // 1. The agent found these on the web and drops them in one call.
    const web = [
      "https://img.example/dragon-red.jpg", "https://img.example/castle-night.jpg",
      "https://img.example/dragon-ice.jpg", "https://img.example/castle-ruins.jpg", "https://img.example/dragon-gold.jpg",
    ];
    const added = await run("add_media", { urls: web });
    expect(added.ok).toBe(true);
    expect(ids(added)).toHaveLength(5);

    // 2. It reads what landed, then decides the groups from the titles.
    const listed = (await run("list_items", { kinds: ["image"] })).result as { id: string; title: string }[];
    const dragons = listed.filter((it) => it.title.startsWith("dragon")).map((it) => it.id);
    const castles = listed.filter((it) => it.title.startsWith("castle")).map((it) => it.id);
    expect([dragons.length, castles.length]).toEqual([3, 2]);

    // 3. One row per theme, in its own order (alphabetical), same height.
    const byTitle = (group: string[]) => [...group].sort((p, q) => item(p).title!.localeCompare(item(q).title!));
    await run("layout_items", { ids: byTitle(dragons), x: 0, y: 0, columns: 10, rowHeight: 150, gap: 20 });
    await run("layout_items", { ids: byTitle(castles), x: 0, y: 400, columns: 10, rowHeight: 150, gap: 20 });
    expect(byTitle(dragons).map((id) => item(id).title)).toEqual(["dragon-gold", "dragon-ice", "dragon-red"]);
    const row = byTitle(dragons).map(item);
    expect(row.map((it) => it.y)).toEqual([0, 0, 0]);
    expect(row.every((it) => it.h === 150 && it.w === 225)).toBe(true);
    expect(row[1].x).toBe(row[0].x + row[0].w + 20);

    // 4. A named frame around each theme.
    const fd = ids(await run("add_frame", { ids: dragons, title: "Dragons" }))[0];
    const fc = ids(await run("add_frame", { ids: castles, title: "Châteaux" }))[0];
    expect(item(fd).text).toBe("Dragons");
    expect(item(fc).text).toBe("Châteaux");
    for (const id of dragons) expect(inside(fd).has(id)).toBe(true);
    for (const id of castles) expect(inside(fc).has(id)).toBe(true);
    for (const id of castles) expect(inside(fd).has(id)).toBe(false);

    // 5. Names the board and saves it.
    await run("board", { action: "rename", name: "Fantasy refs" });
    await run("scenes", { action: "save", name: "Fantasy refs" });
    expect(persistence.save).toHaveBeenCalledWith("Fantasy refs");
    expect((await run("board_state")).result).toMatchObject({ name: "Fantasy refs", counts: { image: 5, frame: 2 } });
  });

  it("renames every image after what it shows, then sorts by name", async () => {
    const names: Record<string, string> = { a: "Forêt", b: "Montagne", c: "Océan" };
    const res = await run("update_items", { updates: Object.entries(names).map(([id, title]) => ({ id, patch: { title } })) });
    expect(res.ok).toBe(true);
    expect(useBoard.getState().items.map((it) => it.title)).toEqual(["Forêt", "Montagne", "Océan"]);
    expect(((await run("find_items", { query: "montagne" })).result as { id: string }[]).map((it) => it.id)).toEqual(["b"]);
    await run("move_items", { ids: ["a"], dx: 2000 });
    await run("tidy_items", { ids: ["c", "a", "b"], layout: "row", sort: "name", gap: 10 });
    const xs = ["a", "b", "c"].map((id) => item(id).x);
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
  });

  it("writes a research note and links it to its sources", async () => {
    const md = "# Palette\n- rouge brique\n- bleu nuit\n\nSources : a, b";
    const sheet = ids(await run("add_note_sheet", { markdown: md, title: "Recherche", x: 0, y: 400 }))[0];
    expect(item(sheet)).toMatchObject({ title: "Recherche", x: 0, y: 400 });
    expect(await run("links", { action: "to", ids: ["a", "b"], target: sheet })).toMatchObject({ ok: true, result: { count: 2 } });
    const links = (await run("links", { action: "list" })).result as { from: string; to: string }[];
    expect(links.map((l) => `${l.from}->${l.to}`).sort()).toEqual([`a->${sheet}`, `b->${sheet}`]);
    await run("add_palette", { colors: ["#8b3a2b", "#1c2541"], x: 0, y: 700 });
    expect((await run("board_state")).result).toMatchObject({ counts: { image: 3, text: 1, palette: 1 } });
  });

  it("puts everything away in folders and walks through them", async () => {
    const f = ids(await run("add_frame", { ids: ["a", "b"], title: "Lot 1" }))[0];
    expect(await run("folder", { action: "toggle", id: f })).toMatchObject({ ok: true });
    const top = ((await run("list_items")).result as { id: string }[]).map((it) => it.id);
    expect(top).toContain(f);
    expect(top).not.toContain("a");
    expect(((await run("list_items", { allLevels: true })).result as { id: string }[]).map((it) => it.id)).toContain("a");
    await run("folder", { action: "enter", id: f });
    expect(((await run("list_items")).result as { id: string }[]).map((it) => it.id).sort()).toEqual(["a", "b"]);
    await run("folder", { action: "leave", depth: 0 });
    expect((await run("board_state")).result).toMatchObject({ folderPath: [] });
  });

  it("undoes a whole agent session step by step, then redoes it", async () => {
    const snapshot = () => JSON.stringify(useBoard.getState().items.map(({ src: _s, ...rest }) => rest));
    const original = snapshot();
    const steps: [string, Record<string, unknown>][] = [
      ["add_text", { text: "Titre", x: 0, y: -200 }],
      ["move_items", { ids: ["a"], dx: 500 }],
      ["update_items", { updates: [{ id: "b", patch: { opacity: 0.3 } }] }],
      ["rotate_items", { ids: ["c"], rotation: 30 }],
      ["layout_items", { ids: ["c", "b", "a"], x: 0, y: 0, columns: 3 }],
      ["delete_items", { ids: ["b"] }],
    ];
    for (const [tool, args] of steps) {
      expect(await run(tool, args), tool).toMatchObject({ ok: true });
      await tick();
    }
    expect((await run("board", { action: "undo", times: steps.length })).ok).toBe(true);
    expect(snapshot()).toBe(original);
    expect((await run("board", { action: "redo", times: steps.length })).ok).toBe(true);
    expect(useBoard.getState().items.map((it) => it.id)).not.toContain("b");
  });

  it("refuses bad arguments with a readable error and leaves the board untouched", async () => {
    const bad: [string, Record<string, unknown>, RegExp][] = [
      ["arrange_items", { ids: ["a", "b"], mode: "diagonal" }, /mode must be one of/],
      ["tidy_items", { ids: ["a", "b"], layout: "spiral" }, /layout must be one of/],
      ["tidy_items", { ids: ["a", "b"], layout: "row", sort: "colour" }, /sort must be one of/],
      ["normalize_items", { ids: ["a", "b"], mode: 3 }, /mode must be one of/],
      ["reset_transform", { ids: ["a"], kind: "everything" }, /kind must be one of/],
      ["layout_items", {}, /order/],
      ["update_items", { updates: "x" }, /updates/],
      ["move_items", { ids: "a" }, /ids|select/i],
      ["set_text", { id: 42 }, /No item/],
      ["folder", { action: "explode" }, /Unknown folder action/],
      ["draw", { action: "paint" }, /Unknown draw action/],
      ["links", { action: "to", ids: ["a"] }, /target/],
      ["media", { action: "melt", id: "a" }, /Unknown media action/],
      ["scenes", { action: "open" }, /id/],
      ["add_item", { item: { x: 1 } }, /kind/],
      ["add_palette", {}, /colors/],
      ["add_link", { url: "javascript:alert(1)" }, /http/],
    ];
    for (const [tool, args, error] of bad) {
      const res = await run(tool, args);
      expect(res.ok, `${tool} ${JSON.stringify(args)}`).toBe(false);
      expect(res.error, tool).toMatch(error);
    }
    expect(useBoard.getState().items.map((it) => [it.id, it.x, it.y])).toEqual([["a", 0, 0], ["b", 300, 50], ["c", 600, 200]]);
  });

  it("answers every declared tool without throwing, even with no arguments", async () => {
    for (const name of AGENT_TOOL_NAMES) {
      const res = await run(name, {});
      expect(typeof res.ok, name).toBe("boolean");
      if (!res.ok) expect(res.error, name).toBeTruthy();
    }
  }, 60000);
});

describe("agent drawing and seeing", () => {
  const shapes = () => useBoard.getState().items.find((it) => it.kind === "draw")?.shapes ?? [];

  it("circles items, points arrows between them and writes labels", async () => {
    const res = await run("draw", { action: "add", shapes: [
      { t: "ellipse", around: ["a", "b"], pad: 10, color: "#ef4444", width: 5 },
      { t: "arrow", from: "a", to: "c" },
      { t: "rect", box: { x: 0, y: 300, w: 200, h: 80 } },
      { t: "text", x: 20, y: 320, text: "Ici", size: 40 },
    ] });
    expect(res.ok).toBe(true);
    const [ring, arrow, rect, label] = shapes();
    expect(ring).toMatchObject({ t: "ellipse", p: [-10, -10, 410, 160], c: "#ef4444", w: 5 });
    // a (0,0 100×100) → c (600,200 100×100): leaves a's right edge, lands on c's left edge (8 px gap).
    expect(arrow).toMatchObject({ t: "arrow", h2: "arrow" });
    expect(arrow.p.map(Math.round)).toEqual([108, 69, 592, 231]);
    expect(rect.p).toEqual([0, 300, 200, 380]);
    expect(label).toMatchObject({ t: "text", p: [20, 320], w: 40, text: "Ici" });
    expect((await run("draw", { action: "add", shapes: [{ t: "rect" }] })).error).toMatch(/give p, box, around/);
    expect((await run("draw", { action: "add", shapes: [{ t: "ellipse", around: ["ghost"] }] })).ok).toBe(false);
  });

  it("maps board coordinates to screenshot pixels", async () => {
    const shot = await run("screenshot", {});
    const r = shot.result as { mapping: { originX: number; originY: number; scale: number }; items: { id: string; px: number; py: number; pw: number }[] };
    // Content spans x 0..700 (+3 % margin each side) rendered 320 px wide.
    expect(r.mapping.originX).toBe(-21);
    expect(r.mapping.scale).toBeCloseTo(320 / 742, 4);
    const a = r.items.find((it) => it.id === "a")!;
    expect(a.px).toBe(Math.round(21 * r.mapping.scale));
    expect(a.pw).toBe(Math.round(100 * r.mapping.scale));
  });

  it("removes a dead web image and says so", async () => {
    const res = await run("add_media", { urls: ["https://img.example/ok.jpg", "https://img.example/dead.jpg"] });
    const out = res.result as { added: { id: string }[]; failed: { url: string }[]; remoteOnly: string[] };
    expect(out.added).toHaveLength(1);
    expect(out.failed.map((x) => x.url)).toEqual(["https://img.example/dead.jpg"]);
    expect(out.remoteOnly).toEqual([]);
    expect(out.added[0]).toMatchObject({ ref: "C:/assets/ok.jpg", url: "https://img.example/ok.jpg" });
    expect(useBoard.getState().items.some((it) => it.ref.includes("dead"))).toBe(false);
  });
});

describe("agent text sizing", () => {
  it("sizes a big title to its text instead of wrapping it", async () => {
    const res = await run("add_text", { text: "Moodboard fantasy", fontSize: 64, x: 0, y: -200 });
    const it = useBoard.getState().items.find((x) => x.id === (res.result as { added: { id: string }[] }).added[0].id)!;
    expect(it.w).toBeGreaterThan(17 * 64 * 0.6);
    expect(it.h).toBeLessThan(64 * 2);
    const long = await run("add_text", { text: "x".repeat(200), fontSize: 20 });
    const box = useBoard.getState().items.find((x) => x.id === (long.result as { added: { id: string }[] }).added[0].id)!;
    expect(box.w).toBeLessThanOrEqual(900);
    expect(box.h).toBeGreaterThan(40);
  });
});

describe("agent video and home screen", () => {
  const vid = (extra: Partial<BoardItem> = {}) =>
    useBoard.getState().addItem({ ...img("v", 0, 0), id: "v", kind: "video", ref: "C:/m/clip.mp4", dur: 12, natW: 1280, natH: 720, ...extra });
  const yt = () => useBoard.getState().addItem({ ...img("y", 0, 0), id: "y", kind: "youtube", ref: "abc", dur: 100 });
  const item = (id: string) => useBoard.getState().items.find((it) => it.id === id)!;

  it("sets in/out with checks, and clears an end with null", async () => {
    vid();
    expect((await run("video", { action: "trim", id: "v", in: 2, out: 6 })).result).toMatchObject({ in: 2, out: 6 });
    expect((await run("video", { action: "trim", id: "v", in: 5, out: 3 })).error).toMatch(/after in/);
    expect((await run("video", { action: "trim", id: "v", out: 13 })).error).toMatch(/past the end/);
    expect((await run("video", { action: "trim", id: "v", in: -1 })).error).toMatch(/≥ 0/);
    await run("video", { action: "trim", id: "v", out: null });
    expect(item("v").trimOut).toBeUndefined();
    expect(item("v").trimIn).toBe(2);
    expect((await run("video", { action: "trim", id: "a", in: 1 })).error).toMatch(/not a video/);
  });

  it("sets the play mode; YouTube cannot pingpong", async () => {
    vid();
    yt();
    expect((await run("video", { action: "play_mode", id: "v", mode: "pingpong" })).result).toMatchObject({ playMode: "pingpong" });
    expect((await run("video", { action: "play_mode", id: "y", mode: "pingpong" })).error).toMatch(/YouTube/);
    expect((await run("video", { action: "play_mode", id: "v", mode: "reverse" })).error).toMatch(/mode must be one of/);
  });

  it("cuts a video into new trimmed items beside it", async () => {
    vid({ x: 0, w: 320 });
    const res = await run("video", { action: "cuts", id: "v", cuts: [{ in: 0, out: 3, title: "A" }, { in: 8, out: 11, title: "B" }] });
    const added = (res.result as { added: { id: string }[] }).added.map((x) => item(x.id));
    expect(added.map((x) => [x.kind, x.trimIn, x.trimOut, x.title])).toEqual([["video", undefined, 3, "A"], ["video", 8, 11, "B"]]);
    expect(added[0].x).toBe(360);
    expect((await run("video", { action: "cuts", id: "v", cuts: [{ in: 3, out: 1 }] })).ok).toBe(false);
  });

  it("refuses stills from a YouTube item and contact sheets without a duration", async () => {
    yt();
    vid({ dur: undefined });
    expect((await run("video", { action: "still", id: "y", at: 1 })).error).toMatch(/local video/);
    expect((await run("video", { action: "contact_sheet", id: "v" })).error).toMatch(/duration/);
  });

  it("lists boards sorted, renames and deletes, never the open one", async () => {
    persistence.list.mockResolvedValue([
      { id: "s1", name: "Zebra", updatedAt: 1000 }, { id: "s2", name: "alpha", updatedAt: 3000 }, { id: "s0", name: "Test", updatedAt: 2000 },
    ] as never);
    const byName = (await run("scenes", { action: "list", sort: "name" })).result as { scenes: { name: string }[] };
    expect(byName.scenes.map((x) => x.name)).toEqual(["alpha", "Test", "Zebra"]);
    const byDate = (await run("scenes", { action: "list" })).result as { scenes: { id: string }[] };
    expect(byDate.scenes.map((x) => x.id)).toEqual(["s2", "s0", "s1"]);
    expect((await run("scenes", { action: "delete", id: "s0" })).error).toMatch(/open/);
    expect((await run("scenes", { action: "delete", id: "s1" })).ok).toBe(true);
    expect(persistence.remove).toHaveBeenCalledWith("s1");
    await run("scenes", { action: "rename", id: "s0", name: "Nouveau nom" });
    expect(useBoard.getState().sceneName).toBe("Nouveau nom");
    expect(persistence.save).toHaveBeenCalledWith("Nouveau nom");
    expect((await run("scenes", { action: "list", sort: "size" })).error).toMatch(/sort must be one of/);
  });
});

describe("agent placement and board map", () => {
  const ids = (res: { result?: unknown }) => ((res.result as { added: { id: string }[] }).added).map((it) => it.id);
  const item = (id: string) => useBoard.getState().items.find((it) => it.id === id)!;
  const meets = (p: BoardItem, q: BoardItem) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;

  it("never stacks new items without a place", async () => {
    useBoard.getState().loadScene({ id: "s0", name: "Test", items: [] });
    const made: string[] = [];
    for (let i = 0; i < 6; i++) made.push(...ids(await run("add_text", { text: `Note ${i}` })));
    made.push(...ids(await run("add_media", { paths: ["C:/x/1.png", "C:/x/2.png"] })));
    made.push(...ids(await run("add_palette", { colors: ["#000", "#fff", "#f00"] })));
    const all = made.map(item);
    for (const p of all) for (const q of all) if (p.id !== q.id) expect(meets(p, q), `${p.id} on ${q.id}`).toBe(false);
    expect((await run("board_state")).result).toMatchObject({ overlaps: [] });
  });

  it("reports an overlap the agent made on purpose", async () => {
    const res = await run("add_text", { text: "Sur a", x: 10, y: 10 });
    expect((res.result as { overlaps: Record<string, string[]> }).overlaps).toEqual({ [ids(res)[0]]: ["a"] });
  });

  it("draws the board as lines and a character map, and applies edited lines", async () => {
    useBoard.getState().patchItem("b", { x: 50, y: 50 });
    const map = (await run("board_map")).result as { lines: string; map: string; overlaps: string[][] };
    expect(map.lines.split("\n")).toHaveLength(3);
    expect(map.lines).toMatch(/\[A\] a image "a.png" @ 0,0 100x100/);
    expect(map.map).toContain("#");
    expect(map.overlaps).toEqual([["a", "b"]]);
    const edited = map.lines.replace(/(\bb image "b\.png" @ )50,50/, "$1300,0");
    const res = await run("apply_layout", { lines: edited + "\ngarbage line\nzzzz @ 1,1" });
    expect(res.result).toMatchObject({ applied: 3, skipped: ["garbage line", "unknown id zzzz"] });
    expect(item("b")).toMatchObject({ x: 300, y: 0 });
    expect(((await run("board_map")).result as { map: string }).map).not.toContain("#");
    await tick();
    await run("board", { action: "undo" });
    expect(item("b")).toMatchObject({ x: 50, y: 50 });
  });
});

describe("agent layouts never pile items", () => {
  const item = (id: string) => useBoard.getState().items.find((it) => it.id === id)!;
  const meets = (p: BoardItem, q: BoardItem) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;

  it("aligning a row to the left stacks it as a column, not a pile", async () => {
    await run("arrange_items", { ids: ["a", "b", "c"], mode: "left" });
    const [a, b, c] = ["a", "b", "c"].map(item);
    expect([a.x, b.x, c.x]).toEqual([0, 0, 0]);
    expect(meets(a, b) || meets(b, c) || meets(a, c)).toBe(false);
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.h);
  });

  it("a frame around scattered items gathers them instead of swallowing the one between", async () => {
    // a (0,0) and c (600,200) are far apart, b sits between them.
    const res = await run("add_frame", { ids: ["a", "c"], title: "Paire" });
    const frame = item((res.result as { added: { id: string }[] }).added[0].id);
    const box = { x: frame.x, y: frame.y, w: frame.w, h: frame.h } as BoardItem;
    expect(meets(box, item("b"))).toBe(false);
    expect(meets(box, item("a")) && meets(box, item("c"))).toBe(true);
  });

  it("counts a rotated item by its real footprint", async () => {
    useBoard.getState().patchItem("b", { x: 130, y: -50, w: 300, h: 40, rotation: 90 });
    // Rotated 90° around its centre (280,-30): it spans x 260–300, y -180–120, clear of a (0–100).
    expect(((await run("board_state")).result as { overlaps: string[][] }).overlaps).toEqual([]);
    useBoard.getState().patchItem("b", { x: -60, y: -50 });
    expect(((await run("board_state")).result as { overlaps: string[][] }).overlaps).toEqual([["a", "b"]]);
  });
});

describe("agent arranging inside a frame", () => {
  const item = (id: string) => useBoard.getState().items.find((it) => it.id === id)!;
  const within = (p: BoardItem, f: BoardItem) => p.x >= f.x && p.y >= f.y && p.x + p.w <= f.x + f.w && p.y + p.h <= f.y + f.h;

  it("keeps framed items in their frame through align, tidy and normalize", async () => {
    const res = await run("add_frame", { ids: ["a", "b"], title: "Cadre" });
    const fid = (res.result as { added: { id: string }[] }).added[0].id;
    for (const [tool, args] of [
      ["arrange_items", { ids: ["a", "b"], mode: "left" }],
      ["tidy_items", { ids: ["a", "b"], layout: "row", gap: 30 }],
      ["normalize_items", { ids: ["a", "b"], mode: "area" }],
    ] as const) {
      expect((await run(tool, args)).ok, tool).toBe(true);
      expect(within(item("a"), item(fid)) && within(item("b"), item(fid)), tool).toBe(true);
    }
    expect(((await run("board_state")).result as { overlaps: string[][] }).overlaps).toEqual([]);
  });
});

describe("agent batch and checkpoints", () => {
  const items = () => useBoard.getState().items;
  const item = (id: string) => items().find((it) => it.id === id)!;
  const depth = () => useBoard.getState().past.length;
  const idsOf = (res: { result?: unknown }) => (res.result as { ids: string[] }).ids;

  it("runs several tools as ONE undo step and chains the ids they make", async () => {
    await tick();
    const before = depth();
    const res = await run("batch", {
      ops: [
        { tool: "add_text", args: { text: "One", x: 1000, y: 0 } },
        { tool: "update_items", args: { ids: ["$0"], patch: { color: "#ff0000" } } },
        { tool: "move_items", args: { ids: ["a"], dx: 10 } },
        { tool: "draw", args: { action: "add", shapes: [{ t: "arrow", from: "a", to: "b" }] } },
      ],
    });
    expect(res.ok).toBe(true);
    expect((res.result as { ops: number }).ops).toBe(4);
    const made = (res.result as { results: { result: { ids: string[] } }[] }).results[0].result.ids[0];
    expect(item(made)).toMatchObject({ text: "One", color: "#ff0000" });
    expect(idsOf(res)).toContain(made);
    await tick();
    expect(depth()).toBe(before + 1);
    useBoard.getState().undo();
    expect(items().filter((it) => it.kind !== "draw").map((it) => it.id)).toEqual(["a", "b", "c"]);
    expect(item("a").x).toBe(0);
    expect(items().find((it) => it.kind === "draw")?.shapes?.length ?? 0).toBe(0);
  });

  it("reverts everything when one op fails, and says which", async () => {
    await tick();
    const before = depth();
    const res = await run("batch", {
      ops: [
        { tool: "move_items", args: { ids: ["a"], dx: 500 } },
        { tool: "add_text", args: { text: "Never", x: 2000, y: 0 } },
        { tool: "update_items", args: { updates: [{ id: "ghost", patch: {} }] } },
      ],
    });
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/Op 2 \(update_items\) failed:.*ghost/) });
    await tick();
    expect(item("a").x).toBe(0);
    expect(items().length).toBe(3);
    expect(depth()).toBe(before);
    expect(useBoard.getState().future).toEqual([]);
    expect(await run("batch", { ops: [{ tool: "batch", args: {} }] })).toMatchObject({ ok: false, error: expect.stringContaining("cannot run inside a batch") });
    expect(await run("batch", { ops: [{ tool: "nope" }] })).toMatchObject({ ok: false, error: expect.stringContaining("Unknown tool") });
    expect(await run("batch", { ops: [{ tool: "move_items", args: { ids: ["$3"] } }] })).toMatchObject({ ok: false });
  });

  it("saves, lists, restores (one undo step) and drops a checkpoint", async () => {
    expect((await run("checkpoint", { action: "save", name: "start" })).result).toMatchObject({ saved: { name: "start", items: 3 } });
    await run("delete_items", { ids: ["a"] });
    await run("add_text", { text: "Extra", x: 900, y: 900 });
    await tick();
    expect(items().length).toBe(3);
    const before = depth();
    const res = await run("checkpoint", { action: "restore", name: "start" });
    expect(res.result).toMatchObject({ restored: { name: "start" }, items: 3 });
    await tick();
    expect(items().map((it) => it.id)).toEqual(["a", "b", "c"]);
    expect(depth()).toBe(before + 1);
    useBoard.getState().undo();
    expect(items().some((it) => it.id === "a")).toBe(false);
    expect((await run("checkpoint", { action: "list" })).result).toMatchObject({ checkpoints: [{ name: "start" }] });
    expect(await run("checkpoint", { action: "restore", name: "ghost" })).toMatchObject({ ok: false, error: expect.stringContaining("start") });
    expect((await run("checkpoint", { action: "drop", name: "start" })).result).toMatchObject({ dropped: true, checkpoints: [] });
  });

  it("refuses to restore a checkpoint onto another board", async () => {
    await run("checkpoint", { action: "save", name: "other" });
    useBoard.getState().loadScene({ id: "s9", name: "Elsewhere", items: [img("z", 0, 0)] });
    expect(await run("checkpoint", { action: "restore", name: "other" })).toMatchObject({ ok: false, error: expect.stringContaining("another board") });
    await run("checkpoint", { action: "drop", name: "other" });
  });

  it("backs a .netsu project up through the core, or a saved board as a dated copy", async () => {
    const api = nr.reference as unknown as Record<string, ReturnType<typeof vi.fn>>;
    api.backupProject = vi.fn(async () => ({ ok: true, dir: "C:/p/backup-x-2026-11-16-2100", files: ["C:/p/backup-x-2026-11-16-2100/x.netsu"] }));
    useBoard.setState({ filePath: "C:/p/x.netsu" });
    const file = await run("scenes", { action: "backup" });
    expect(api.backupProject).toHaveBeenCalledWith("C:/p/x.netsu");
    expect(file.result).toMatchObject({ backup: "C:/p/backup-x-2026-11-16-2100" });

    api.backupProject = vi.fn(async () => ({ ok: false, error: "disk full" }));
    expect(await run("scenes", { action: "backup" })).toMatchObject({ ok: false, error: "disk full" });

    useBoard.setState({ filePath: null });
    api.loadScene = vi.fn(async () => ({ id: "s0", name: "Test", items: [] }));
    api.saveScene = vi.fn(async () => ({ ok: true, id: "n1" }));
    const scene = await run("scenes", { action: "backup" });
    expect(persistence.save).toHaveBeenCalled();
    expect(scene.result).toMatchObject({ id: "n1", backup: expect.stringMatching(/^Test backup \d{4}-\d{2}-\d{2}-\d{4}$/) });
    expect(api.saveScene.mock.calls[0][0]).not.toHaveProperty("id");
  });
});

describe("agent text tools", () => {
  const items = () => useBoard.getState().items;
  const item = (id: string) => items().find((it) => it.id === id)!;
  const addText = async (value: string, extra: Record<string, unknown> = {}) =>
    ((await run("add_text", { text: value, ...extra })).result as { ids: string[] }).ids[0];

  it("update_items takes ids + patch, or the selection, besides updates", async () => {
    await tick();
    const depth = useBoard.getState().past.length;
    const res = await run("update_items", { ids: ["a", "b"], patch: { opacity: 0.4, rotation: 10 } });
    expect(res.result).toMatchObject({ ids: ["a", "b"], updated: [{ id: "a" }, { id: "b" }] });
    await tick();
    expect(item("a")).toMatchObject({ opacity: 0.4, rotation: 10 });
    expect(item("b").opacity).toBe(0.4);
    expect(useBoard.getState().past.length).toBe(depth + 1);
    useBoard.getState().selectMany(["c"]);
    await run("update_items", { patch: { opacity: 0.9 } });
    expect(item("c").opacity).toBe(0.9);
    expect(await run("update_items", {})).toMatchObject({ ok: false, error: expect.stringContaining("ids + patch") });
    expect(await run("update_items", { ids: ["ghost"], patch: {} })).toMatchObject({ ok: false });
  });

  it("fit sizes a text note to its text, in add_text and update_items", async () => {
    const id = await addText("Hello\nWorld wide", { fontSize: 40, fit: true, w: 9999, h: 9999, x: 0, y: 500 });
    const first = item(id);
    expect(first.w).toBeLessThan(400);
    expect(first.w).toBeGreaterThan(80);
    expect(first.h).toBeCloseTo(2 * 40 * 1.2 + 24, 0);
    // Longer text, then fit again: the box grows to the text.
    await run("update_items", { ids: [id], patch: { text: "Hello\nWorld wide and longer than before" }, fit: true });
    expect(item(id).w).toBeGreaterThan(first.w);
    // Inside a patch, and not for a picture.
    const res = await run("update_items", { updates: [{ id, patch: { fontSize: 20, fit: true } }, { id: "a", patch: { fit: true } }] });
    expect(item(id).h).toBeCloseTo(2 * 20 * 1.2 + 24, 0);
    expect(res.result).toMatchObject({ fitSkipped: ["a"] });
    expect(item("a")).not.toHaveProperty("fit");
  });

  it("stores valign and padding on a text note and refuses a bad valign", async () => {
    const id = await addText("Centred", { valign: "middle", padding: 30, x: 0, y: 700 });
    expect(item(id)).toMatchObject({ valign: "middle", padding: 30 });
    await run("update_items", { ids: [id], patch: { valign: "bottom", padding: null } });
    expect(item(id)).toMatchObject({ valign: "bottom" });
    expect(item(id).padding).toBeUndefined();
    expect(await run("update_items", { ids: [id], patch: { valign: "side" } })).toMatchObject({ ok: false, error: expect.stringContaining("valign") });
    expect(await run("add_text", { text: "x", valign: "side" })).toMatchObject({ ok: false });
  });

  it("style_items applies a style, or a theme spread by index", async () => {
    const one = await addText("One", { x: 0, y: 600 });
    const two = await addText("Two", { x: 400, y: 600 });
    const three = await addText("Three", { x: 800, y: 600 });
    await tick();
    const depth = useBoard.getState().past.length;
    const res = await run("style_items", { ids: [one, two, three], theme: "pastel" });
    expect(res.result).toMatchObject({ ids: [one, two, three], theme: "pastel" });
    await tick();
    expect(useBoard.getState().past.length).toBe(depth + 1);
    expect(new Set([one, two, three].map((id) => item(id).bg)).size).toBe(3);
    expect(item(one).color).toBe("#1f2937");
    await run("style_items", { ids: [one, two], theme: "neon", bold: true, fontSize: 50 });
    expect(item(one)).toMatchObject({ bg: "#0a0a0f", color: "#39ff14", bold: true, fontSize: 50 });
    expect(item(two).color).toBe("#ff00ff");
    useBoard.getState().selectMany([three]);
    await run("style_items", { align: "center", valign: "middle" });
    expect(item(three)).toMatchObject({ align: "center", valign: "middle" });
    expect(await run("style_items", { ids: [one] })).toMatchObject({ ok: false });
    expect(await run("style_items", { ids: [one], theme: "gold" })).toMatchObject({ ok: false, error: expect.stringContaining("theme") });
  });

  it("text_fit equalises sizes and fills each box", async () => {
    const small = await addText("Small", { fontSize: 20, x: 0, y: 600 });
    const big = await addText("Big", { fontSize: 60, x: 400, y: 600 });
    await run("text_fit", { action: "same_size", ids: [small, big] });
    expect(item(small).fontSize).toBe(20);
    expect(item(big).fontSize).toBe(20);
    await run("text_fit", { action: "same_size", ids: [small, big], fontSize: 33 });
    expect(item(big).fontSize).toBe(33);

    useBoard.getState().patchItem(small, { w: 600, h: 200 });
    useBoard.getState().patchItem(big, { w: 300, h: 80 });
    const res = await run("text_fit", { action: "fit_box", ids: [small, big, "a"] });
    expect(res.result).toMatchObject({ ids: [small, big], skipped: ["a"] });
    // The text fills its box: a bigger box gets a bigger size, and the text still fits.
    expect(item(small).fontSize!).toBeGreaterThan(item(big).fontSize!);
    for (const id of [small, big]) expect(item(id).fontSize! * 1.2).toBeLessThanOrEqual(item(id).h - 24 + 1);
    expect(await run("text_fit", { action: "fit_box", ids: ["a"] })).toMatchObject({ ok: false });
    expect(await run("text_fit", { action: "grow", ids: [small] })).toMatchObject({ ok: false });
  });
});

describe("agent timeline and frame layout", () => {
  const items = () => useBoard.getState().items;
  const item = (id: string) => items().find((it) => it.id === id)!;
  const shapes = () => items().find((it) => it.kind === "draw")?.shapes ?? [];
  type Made = { ids: string[]; cards: string[]; numbers: string[]; frame?: string; arrow: string };

  it("builds numbered steps as equal coloured cards, big numbers and an arrow, in one undo step", async () => {
    await tick();
    const depth = useBoard.getState().past.length;
    const res = await run("timeline", {
      steps: [{ text: "Plan" }, { text: "Shoot", color: "#123456" }, { text: "Edit the footage and grade it" }],
      x: 0, y: 1000, cardW: 300, fontSize: 30, title: "Workflow",
    });
    const made = res.result as Made;
    expect(made.cards).toHaveLength(3);
    expect(made.numbers).toHaveLength(3);
    expect(made.ids).toHaveLength(7);
    await tick();
    expect(useBoard.getState().past.length).toBe(depth + 1);
    const cards = made.cards.map(item);
    expect(new Set(cards.map((c) => `${c.w}x${c.h}`)).size).toBe(1);
    expect(cards.map((c) => c.text)).toEqual(["Plan", "Shoot", "Edit the footage and grade it"]);
    expect(cards[1].bg).toBe("#123456");
    expect(made.numbers.map((id) => item(id).text)).toEqual(["1", "2", "3"]);
    // Each number sits above its card, in the card's colour and much bigger than the card text.
    made.numbers.forEach((id, i) => {
      const n = item(id);
      expect(n.y + n.h).toBeLessThanOrEqual(cards[i].y);
      expect(n.color).toBe(cards[i].bg);
      expect(n.fontSize!).toBeGreaterThan(cards[i].fontSize! * 2);
    });
    // A left-to-right arrow under the cards, on the drawing layer.
    const arrow = shapes().find((s) => s.id === made.arrow)!;
    expect(arrow.t).toBe("arrow");
    expect(arrow.p[1]).toBeGreaterThan(Math.max(...cards.map((c) => c.y + c.h)));
    expect(arrow.p[2]).toBeGreaterThan(arrow.p[0]);
    // The frame wraps everything and carries its title.
    const frame = item(made.frame!);
    expect(frame).toMatchObject({ kind: "frame", text: "Workflow" });
    for (const it of [...cards, ...made.numbers.map(item)]) expect(it.x).toBeGreaterThanOrEqual(frame.x);
    expect(frame.fontSize).toBeGreaterThan(30);
    expect(res.result).not.toHaveProperty("overlaps");
    useBoard.getState().undo();
    expect(items().filter((it) => it.kind !== "draw")).toHaveLength(3);
    expect(shapes()).toHaveLength(0);
  });

  it("places a timeline on free space without a position, and checks its steps", async () => {
    const res = await run("timeline", { steps: [{ text: "Only" }] });
    const made = res.result as Made;
    expect(made.frame).toBeUndefined();
    expect(res.result).not.toHaveProperty("overlaps");
    expect(await run("timeline", { steps: [] })).toMatchObject({ ok: false });
    expect(await run("timeline", { steps: [{ color: "red" }] })).toMatchObject({ ok: false, error: expect.stringContaining("text") });
  });

  it("relayout_frame lays the content out again and refits the frame", async () => {
    const fr = ((await run("add_frame", { ids: ["a", "b", "c"], title: "Set" })).result as { ids: string[] }).ids[0];
    await run("relayout_frame", { id: fr, mode: "col", gap: 20 });
    const ys = ["a", "b", "c"].map((id) => item(id).y);
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[1]).toBeLessThan(ys[2]);
    expect(new Set(["a", "b", "c"].map((id) => item(id).x)).size).toBe(1);
    const inside = (id: string) => item(id).x >= item(fr).x && item(id).y >= item(fr).y && item(id).x + item(id).w <= item(fr).x + item(fr).w && item(id).y + item(id).h <= item(fr).y + item(fr).h;
    expect(["a", "b", "c"].every(inside)).toBe(true);
    const res = await run("relayout_frame", { id: fr, mode: "row", gap: 30 });
    expect(new Set(["a", "b", "c"].map((id) => item(id).y)).size).toBe(1);
    expect(item("b").x - (item("a").x + item("a").w)).toBe(30);
    expect(res.result).toMatchObject({ frame: { id: fr }, ids: [fr, "a", "b", "c"] });
    // An explicit order wins over reading order.
    await run("relayout_frame", { id: fr, mode: "row", gap: 30, ids: ["c", "a", "b"] });
    expect(item("c").x).toBeLessThan(item("a").x);
    expect(["a", "b", "c"].every(inside)).toBe(true);
    expect(await run("relayout_frame", { id: "a" })).toMatchObject({ ok: false, error: expect.stringContaining("not a frame") });
    const empty = ((await run("add_frame", { x: 5000, y: 5000 })).result as { ids: string[] }).ids[0];
    expect(await run("relayout_frame", { id: empty })).toMatchObject({ ok: false });
  });

  it("answers creating and modifying tools with ids and the overlaps they leave", async () => {
    const dup = await run("move_items", { ids: ["a"], x: 300, y: 50 });
    expect(dup.result).toMatchObject({ ids: ["a"], overlaps: { a: ["b"] } });
    expect((await run("resize_item", { id: "c", scale: 2 })).result).toMatchObject({ ids: ["c"] });
    expect((await run("rotate_items", { ids: ["c"], by: 5 })).result).toMatchObject({ ids: ["c"] });
    expect((await run("arrange_items", { ids: ["b", "c"], mode: "top" })).result).toMatchObject({ ids: ["b", "c"], arranged: [{}, {}] });
    expect((await run("layout_items", { ids: ["a", "b", "c"], columns: 3 })).result).toMatchObject({ ids: ["a", "b", "c"] });
    const on = await run("add_text", { text: "T", x: item("a").x + 5, y: item("a").y + 5 });
    expect(on.result).toMatchObject({ ids: [expect.any(String)], overlaps: { [(on.result as { ids: string[] }).ids[0]]: expect.arrayContaining(["a"]) } });
  });
});

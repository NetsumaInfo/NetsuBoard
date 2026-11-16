#!/usr/bin/env node
// NetsuBoard MCP server (stdio). An AI agent — Claude Code, Codex, any MCP client — launches it:
//
//   claude mcp add netsuboard -- node "<install>/resources/core/mcp.js"
//
// It speaks MCP (JSON-RPC 2.0, one message per line) on stdin/stdout and forwards every tool call
// to the running core (`agent:call`), which hands it to the board window. The tools are declared
// here; they are carried out in src/components/reference/agentTools.ts. No dependency: the
// protocol subset a tool server needs is four methods.
//
// The core's port and session secret are read from NR_HOME/agent-endpoint.json on every call, so
// the server keeps working across app restarts without being relaunched.

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const NR_HOME = process.env.NR_HOME
  || (process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "NetsuBoard")
    : path.join(os.homedir(), ".netsuboard"));
const ENDPOINT = path.join(NR_HOME, "agent-endpoint.json");
const PROTOCOL = "2025-06-18";

// ── Schemas ─────────────────────────────────────────────────────────────────
const str = (description, extra) => ({ type: "string", description, ...extra });
const num = (description, extra) => ({ type: "number", description, ...extra });
const bool = (description) => ({ type: "boolean", description });
const ids = (description = "Item ids. Omitted = the current selection.") => ({ type: "array", items: { type: "string" }, description });
const obj = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const anyObj = (description) => ({ type: "object", description, additionalProperties: true });
const pos = {
  x: num("Board x of the top-left corner. Omitted = centre of the view."),
  y: num("Board y of the top-left corner. Omitted = centre of the view."),
};
const textStyle = {
  fontSize: num("Font size in px."),
  fontFamily: str("CSS font family."),
  color: str("Text colour (CSS)."),
  bg: str("Background colour, or \"transparent\"."),
  highlight: str("Highlight behind the text, or \"transparent\"."),
  align: str("Alignment.", { enum: ["left", "center", "right", "justify"] }),
  bold: bool("Bold."),
  italic: bool("Italic."),
  underline: bool("Underline."),
  strike: bool("Strikethrough."),
  lineHeight: num("Line height multiplier."),
  valign: str("Vertical alignment of the text in its box.", { enum: ["top", "middle", "bottom"] }),
  padding: num("Inner margin in px on every side (default 12)."),
  fit: bool("Size the box to the text, on its own lines without wrapping (ignores w/h)."),
};
const { fit: _fit, ...styleOnly } = textStyle;
const point = { description: "An item id (its centre) or a board point {x, y}.", anyOf: [{ type: "string" }, { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] }] };
const shapeSchema = {
  type: "object",
  description: [
    "One drawing shape, in BOARD coordinates (same as item x/y; get them from list_items or the screenshot mapping).",
    "Place it the easy way: rect/ellipse/diamond → `around` (item ids to circle, `pad` margin) or `box` {x,y,w,h};",
    "line/arrow → `from` and `to` (item ids or points); text → `x`,`y` (top-left) + `text` + `size` (font px).",
    "Or raw `p`: [x1,y1,x2,y2] corners for rect/ellipse/diamond, start/end for line/arrow, [x1,y1,x2,y2,…] for a pen stroke.",
    "Style: color, width (stroke px, default pen), fill (shapes), dash (\"dashed\"|\"dotted\"), op (0..1).",
    "To connect items with arrows that FOLLOW them when moved, use the links tool instead.",
  ].join(" "),
  additionalProperties: true,
  properties: {
    t: str("Shape type.", { enum: ["pen", "line", "arrow", "rect", "ellipse", "diamond", "text"] }),
    around: { type: "array", items: { type: "string" }, description: "Item ids the rect/ellipse/diamond surrounds." },
    pad: num("Margin around `around` (default 24)."),
    box: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }, required: ["x", "y", "w", "h"] },
    from: point, to: point,
    x: num("Text: left."), y: num("Text: top."), text: str("Text content."), size: num("Text: font size px."),
    p: { type: "array", items: { type: "number" }, description: "Raw points." },
    color: str("Stroke colour."), width: num("Stroke width px."), fill: str("Fill colour."),
  },
  required: ["t"],
};

const TOOLS = [
  // Reading
  ["board_state", "Overview of the open board: scene name and file, view (camera), selection, item counts by kind, folder path, background, freeze and draw modes, undo depth. Call it first.", obj({})],
  ["list_items", "List the items of the board level on screen with their geometry and main fields (no binary data). Use `kinds` to filter and `full` for every field.", obj({
    kinds: { type: "array", items: str("Item kind.", { enum: ["image", "video", "youtube", "embed", "text", "frame", "sequence", "palette"] }) },
    ids: ids("Only these ids."),
    full: bool("Return every stored field."),
    allLevels: bool("Include items parked in folders (other levels)."),
  })],
  ["get_item", "Every stored field of one item. Text notes with a sheet also return their content as Markdown.", obj({ id: str("Item id.") }, ["id"])],
  ["screenshot", "See the board: renders it (or some items) to an image, with `mapping` (pixel = (board - origin) × scale) and every item's pixel box, so you can check a result and aim the next shape. Take one after drawing or arranging.", obj({
    ids: ids("Only these items. Omitted = the whole level."),
    width: num("Output width in px (default 1280, max 4096)."),
    format: str("Image format.", { enum: ["png", "jpeg"] }),
    view: bool("Render only what the window shows (the camera), not the whole content."),
  })],
  ["board_map", "The board as editable text: one line per item — `[symbol] <id> <kind> \"label\" @ x,y WxH [in:<frame id>]` — plus a character map of where everything sits (each item drawn with its symbol, frames as borders, '#' where items overlap) and the list of overlapping pairs. Cheap: use it to plan a layout, then send edited lines to apply_layout.", obj({
    columns: num("Width of the character map (20–160, default 96)."),
  })],
  ["apply_layout", "Move and resize many items at once from text lines \"<id> @ x,y [WxH]\" (the board_map format; anything else on a line is ignored). One undo step. Returns the overlaps left.", obj({
    lines: str("One line per item: <id> @ x,y [WxH]."),
  }, ["lines"])],
  ["find_items", "Search items by text (note text, frame titles, titles, link URLs, file names). Case-insensitive.", obj({ query: str("Text to find.") }, ["query"])],

  // Adding
  ["add_media", "Add images, videos, GIFs, PDFs or documents from local file paths, and/or web URLs (images, YouTube, social posts, web pages). Media are placed at the view centre then moved to x/y when given.", obj({
    paths: { type: "array", items: { type: "string" }, description: "Absolute local file paths." },
    urls: { type: "array", items: { type: "string" }, description: "Web URLs (direct media, YouTube, posts, pages)." },
    ...pos,
    asEmbed: bool("Keep generic web pages as live embeds instead of link cards."),
    // Answer: added, refused (not a link), failed (dead or blocked, removed), remoteOnly (shown from
    // the web after three spaced download retries; offline with the site, skipped by exports).
  })],
  ["add_folder", "Import a whole folder from disk: one frame per sub-folder, content arranged.", obj({ path: str("Absolute folder path.") }, ["path"])],
  ["add_sequence", "Add an image sequence (flip-book) from ordered image paths.", obj({ paths: { type: "array", items: { type: "string" } }, fps: num("Frames per second (default 12).") }, ["paths"])],
  ["add_video_cut", "Add a trimmed clip of a local video.", obj({ path: str("Video path."), in: num("Start (s)."), out: num("End (s)."), title: str("Title.") }, ["path", "in", "out"])],
  ["add_text", "Add a free text element (plain text, styled).", obj({ text: str("The text."), ...pos, w: num("Width."), h: num("Height."), ...textStyle }, ["text"])],
  ["add_markdown_block", "Add a Markdown text block (rendered Markdown card).", obj({ markdown: str("Markdown source."), ...pos, w: num("Width."), h: num("Height."), bg: str("Accent/background colour."), fontSize: num("Font size.") }, ["markdown"])],
  ["add_note_sheet", "Add a note sheet (a rich document card opened full size to write in). Content is given as Markdown.", obj({ markdown: str("Markdown content."), title: str("Title."), ...pos, w: num("Width."), h: num("Height.") }, ["markdown"])],
  ["add_frame", "Add a frame (titled zone that carries its content when moved). With `ids`, the frame wraps those items; scattered items are gathered first so the frame never swallows others.", obj({
    title: str("Frame title."), ids: ids("Items to wrap. Omitted = an empty frame at x/y."), ...pos,
    w: num("Width (empty frame)."), h: num("Height (empty frame)."), color: str("Outline colour."),
    fillMode: str("Fill.", { enum: ["none", "tint", "solid"] }), fillColor: str("Fill colour for solid."),
    titleSize: num("Title font size in px. Omitted = sized to the content (a notch above its largest text). Never leave a tiny title over large content."),
  })],
  ["add_link", "Add a web link card (page preview) or a YouTube player.", obj({ url: str("http(s) URL."), ...pos }, ["url"])],
  ["add_palette", "Add a colour palette block. Give `colors`, or `fromIds` to extract the colours of media items.", obj({
    colors: { type: "array", items: { type: "string" }, description: "Hex colours." },
    fromIds: ids("Extract from these media items."), ...pos, showHex: bool("Show the hex value under each swatch."),
  })],
  ["add_item", "Low-level: add any item with raw fields (kind, x, y, w, h and any BoardItem field). Use the dedicated tools when one fits.", obj({ item: anyObj("BoardItem fields; id and z are optional.") }, ["item"])],

  // Editing
  ["update_items", "Change any fields of one or several items in one undo step: geometry (x, y, w, h, rotation), text, style (fontSize, color, bg, bold, valign, padding…), opacity, flipH/flipV, crop {x,y,w,h in 0..1}, playMode (loop|pingpong|off), trimIn/trimOut, title, link {kind:url|file|item,target,label}, frame fill, palette colours, sequence fps/speed/seqPlay, grey, etc. Either `updates` (one patch per item) or `ids` + `patch` (the same patch for many; ids omitted = selection). `fit: true` (here, or inside a patch) then sizes plain-text notes to their text.", obj({
    updates: { type: "array", items: obj({ id: str("Item id."), patch: anyObj("Fields to set. null removes a field.") }, ["id", "patch"]) },
    ids: ids("For patch: the items. Omitted = the current selection."),
    patch: anyObj("Fields to set on every item of ids. null removes a field."),
    fit: bool("Size plain-text notes to their text after the patch."),
  })],
  ["style_items", "Apply the same style to many items (ids omitted = selection): any of the style fields below, `patch` for others, and/or a `theme` (dark, pastel, neon) that gives text notes a bg/color by their index in ids and frames an outline colour. One undo step.", obj({
    ids: ids(), theme: str("Preset.", { enum: ["dark", "pastel", "neon"] }), patch: anyObj("Extra fields to set."),
    ...styleOnly,
    opacity: num("Opacity 0..1."), fillMode: str("Frame fill.", { enum: ["none", "tint", "solid"] }), fillColor: str("Frame fill colour."),
  })],
  ["text_fit", "Text sizing across items. same_size: one font size for all the texts (`fontSize`, else the smallest). fit_box: the largest font size at which each text fills its own box without overflowing (`max` caps it).", obj({
    action: str("Action.", { enum: ["same_size", "fit_box"] }), ids: ids(), fontSize: num("For same_size."), max: num("For fit_box: size cap."),
  }, ["action"])],
  ["set_text", "Replace the text of a text element, Markdown block, note sheet (Markdown) or frame title.", obj({ id: str("Item id."), text: str("New text (Markdown for blocks and sheets).") }, ["id", "text"])],
  ["move_items", "Move items, by an offset (dx/dy) or to an absolute position (x/y of the group's top-left).", obj({ ids: ids(), dx: num("Offset x."), dy: num("Offset y."), x: num("Target x."), y: num("Target y.") })],
  ["resize_item", "Resize an item. `keepRatio` keeps the native aspect ratio (default true for media).", obj({ id: str("Item id."), w: num("Width."), h: num("Height."), scale: num("Multiply the current size."), keepRatio: bool("Keep the aspect ratio.") }, ["id"])],
  ["rotate_items", "Set the rotation (degrees) of items.", obj({ ids: ids(), rotation: num("Degrees."), by: num("Add degrees instead.") })],
  ["delete_items", "Delete items.", obj({ ids: ids() })],
  ["duplicate_items", "Duplicate items (links between them are kept).", obj({ ids: ids() })],
  ["order_items", "Change stacking: bring to front or send to back.", obj({ ids: ids(), to: str("Where.", { enum: ["front", "back"] }) }, ["to"])],
  ["arrange_items", "Align, distribute or lay out items. left/hcenter/right/top/vcenter/bottom align; hdist/vdist distribute; grid/block/pack/row/col lay out.", obj({
    ids: ids(), mode: str("Mode.", { enum: ["left", "hcenter", "right", "top", "vcenter", "bottom", "hdist", "vdist", "grid", "block", "pack", "row", "col"] }),
    settle: bool("Default true: items an alignment piles up are spread along the other axis, and a group that lands on its neighbours moves to free space."),
  }, ["mode"])],
  ["tidy_items", "Tidy items in one step: optional size uniformisation, then a layout.", obj({
    ids: ids(), layout: str("Layout.", { enum: ["grid", "block", "pack", "row", "col"] }),
    uniform: str("Make sizes uniform first.", { enum: ["none", "height", "width", "area"] }),
    gap: num("Spacing in px."),
    sort: str("Order before laying out.", { enum: ["none", "name"] }),
    settle: bool("Default true: move the group to free space if it lands on other items."),
  }, ["layout"])],
  ["layout_items", "Lay items out in YOUR order (sorting by subject, colour, date…): rows left to right, wrapping after `columns`, from x/y (default: their current top-left). `rowHeight` scales every item to the same height. One undo step.", obj({
    ids: ids("Item ids in the order to place them."), columns: num("Items per row (default: square grid)."),
    gap: num("Spacing in px."), rowHeight: num("Make every item this tall (ratio kept)."), ...pos,
  }, ["ids"])],
  ["normalize_items", "Make items the same height, width or area (centres kept).", obj({ ids: ids(), mode: str("Mode.", { enum: ["height", "width", "area"] }) }, ["mode"])],
  ["reset_transform", "Reset scale, rotation, flips and/or crop of items.", obj({ ids: ids(), kind: str("What to reset.", { enum: ["scale", "rotation", "flip", "crop", "all"] }) }, ["kind"])],
  ["group_sequence", "Group several images into one image sequence.", obj({ ids: ids() })],
  ["convert_note", "Switch a text element between plain text, Markdown block and note sheet.", obj({ id: str("Item id."), to: str("Target mode.", { enum: ["text", "block", "sheet"] }) }, ["id", "to"])],

  // Compound
  ["batch", "Run several tools in order as ONE undo step. If any op fails, everything the batch did is reverted and the answer says which op failed and why. Each op is {tool, args}; a string argument \"$<n>\" stands for the ids op n created or changed (a list under ids/fromIds/around, else the first id). Returns each op's result, and the ids and overlaps. Not allowed inside: batch, scenes, checkpoint, undo/redo.", obj({
    ops: { type: "array", items: obj({ tool: str("Tool name."), args: anyObj("That tool's arguments.") }, ["tool"]), description: "Ops, run in order (max 100)." },
  }, ["ops"])],
  ["checkpoint", "Named in-memory snapshots of the board (items, drawing, folders) to try something risky and come back: save, restore (one undo step), list, drop. Lost when the app closes; for a file on disk use scenes › backup.", obj({
    action: str("Action.", { enum: ["save", "restore", "list", "drop"] }), name: str("Checkpoint name."),
  }, ["action"])],
  ["timeline", "Create N numbered steps in one undo step: coloured cards of one size, a big coloured number above each, an arrow below on the drawing layer, optionally inside a titled frame. Returns the ids (cards, numbers, frame, arrow) and overlaps.", obj({
    steps: { type: "array", items: obj({ text: str("Step text."), color: str("Card colour (default: a rotating palette).") }, ["text"]) },
    ...pos, cardW: num("Card width (default 280)."), cardH: num("Card height (default: fits the longest text)."), fontSize: num("Card text size (default 28; numbers are 2.4x)."),
    title: str("A frame title: wraps everything in a titled frame."), titleSize: num("Frame title size."), arrowColor: str("Arrow colour."),
  }, ["steps"])],
  ["relayout_frame", "Lay a frame's content out again (grid, row or col, with a gap) from the frame's top-left, then refit the frame around it and move it to free space if it lands on others. With `ids`, they are placed in that order.", obj({
    id: str("Frame id."), mode: str("Layout.", { enum: ["grid", "row", "col"] }), columns: num("Grid columns (default square)."),
    gap: num("Spacing in px."), ids: ids("Content ids in the order to place them. Omitted = everything in the frame, in reading order."),
  }, ["id"])],

  // Selection and camera
  ["select", "Set the selection (empty list clears it).", obj({ ids: { type: "array", items: { type: "string" } }, all: bool("Select everything.") })],
  ["view", "Move the camera: fit everything, fit items, focus one item, zoom, or set the raw view.", obj({
    fit: bool("Fit the whole board."), ids: ids("Fit these items."), focus: str("Centre and zoom on this item."),
    zoom: num("Multiply the zoom."), tx: num("Raw translate x."), ty: num("Raw translate y."), scale: num("Raw scale."),
  })],

  // Folders
  ["folder", "Folder actions on frames: fold/unfold a frame into a folder card, enter or leave a folder, move items into a folder, set its cover, flatten all folders, or reveal an item wherever it lives.", obj({
    action: str("Action.", { enum: ["toggle", "enter", "leave", "move_into", "set_cover", "flatten", "reveal"] }),
    id: str("Folder (frame) id; for set_cover/reveal, the item id."), ids: ids("Items to move into the folder."),
    depth: num("For leave: level to go back to (0 = top)."),
  }, ["action"])],

  // Drawing
  ["draw", "Drawing layer: add shapes (circle items with `around`, arrows with `from`/`to`, labels with `text`), list, replace, delete or clear them, set the pen, toggle draw mode, or send the drawing behind items. Check the result with screenshot.", obj({
    action: str("Action.", { enum: ["list", "add", "replace", "delete", "clear", "pen", "mode", "back"] }),
    shapes: { type: "array", items: shapeSchema, description: "For add/replace." },
    ids: ids("Shape ids for delete."),
    pen: anyObj("For pen: color, width, tool, op, dash, head1, head2, route."),
    on: bool("For mode/back."),
  }, ["action"])],

  // Links (canvas-style arrows anchored to items)
  ["links", "Links between items (anchored arrows that follow the items): link items as a chain or a star (from the first), link several items to one target, remove the links of items, organise a linked group around its root, restyle or reverse links, delete links, or list them.", obj({
    action: str("Action.", { enum: ["chain", "star", "to", "unlink", "organise", "style", "reverse", "delete", "list"] }),
    ids: ids("Items (chain/star/to/unlink/organise root first) or link ids (style/reverse/delete)."),
    target: str("For to: the item the others link to."),
    mode: str("For organise.", { enum: ["tree-right", "tree-down", "radial"] }),
    patch: anyObj("For style: shape fields such as c (colour), w (width), label, dash, route, head1, head2."),
  }, ["action"])],

  // Video
  ["video", "Local videos and YouTube items: info (duration, in/out, play mode), contact_sheet (SEE the video: `count` frames between in/out tiled into one small image with timestamps, nothing written to disk or added to the board — use it to choose in/out), trim (set in/out in seconds; null clears one end), play_mode (loop|pingpong|off; YouTube cannot pingpong), cuts (new items, one per {in,out,title}, beside the source), still (one frame at `at` seconds → image item), to_sequence (frames between in/out → a new image sequence at `fps` beside the video, or the video itself becomes the sequence with `replace: true`; media › revert_sequence gives the video back). Stills and sequences need a local video: download a YouTube item first (media › download). Pause everything with board › freeze.", obj({
    action: str("Action.", { enum: ["info", "contact_sheet", "trim", "play_mode", "cuts", "still", "to_sequence"] }),
    count: num("For contact_sheet: frames (2–36, default 12)."), columns: num("For contact_sheet: tiles per row."), width: num("For contact_sheet: image width px (default 1024)."),
    id: str("Video or YouTube item id."),
    in: { type: ["number", "null"], description: "Start in seconds (null = from the beginning)." },
    out: { type: ["number", "null"], description: "End in seconds (null = to the end)." },
    mode: str("For play_mode.", { enum: ["loop", "pingpong", "off"] }),
    cuts: { type: "array", items: { type: "object", properties: { in: { type: "number" }, out: { type: "number" }, title: { type: "string" } }, required: ["in", "out"] } },
    replace: bool("For to_sequence: turn the video itself into the sequence."),
    at: num("For still: time in seconds."), fps: num("For to_sequence (default 12)."), max: num("For to_sequence: frame cap (default 120)."),
  }, ["action", "id"])],

  // Media
  ["media", "Media actions on an item: upscale (GPU shaders), convert to embed, download a YouTube/embed to a local file, reload, revert a sequence to its source, recover online media.", obj({
    action: str("Action.", { enum: ["upscale", "to_embed", "download", "reload", "revert_sequence", "recover"] }),
    id: str("Item id."),
  }, ["action", "id"])],

  // Board-wide
  ["board", "Board-wide actions: undo, redo, freeze/unfreeze playback, background (mode dots|solid, color, opacity), copy/cut/paste the selection, rename the board.", obj({
    action: str("Action.", { enum: ["undo", "redo", "freeze", "background", "copy", "cut", "paste", "rename"] }),
    times: num("For undo/redo: how many steps."), on: bool("For freeze."),
    background: anyObj("For background: { mode, color, opacity }."), name: str("For rename."),
  }, ["action"])],
  ["board_prefs", "Read or change the board preferences (defaults for notes and frames, navigation, folders, snapping…). Without `patch`, returns them.", obj({ patch: anyObj("Preference fields to set.") })],

  // Scenes and files
  ["scenes", "Boards on the home screen: list the saved boards (sorted by date or name) and recent .netsu projects, open one, create a new board, save, rename a saved board, delete one (not the open board), open a .netsu project, forget a recent project (the file stays on disk), or backup: save the open board, then keep a dated copy (a .netsu file and its journals go to a sibling folder backup-<name>-<YYYY-MM-DD-HHmm>; a saved board becomes a second board named \"<name> backup <date>\").", obj({
    action: str("Action.", { enum: ["list", "open", "new", "save", "backup", "rename", "delete", "open_project", "forget_recent"] }),
    sort: str("For list.", { enum: ["date", "name"] }), order: str("For list.", { enum: ["asc", "desc"] }),
    id: str("Scene id (open/rename/delete)."), name: str("Name (new/save/rename)."), path: str(".netsu path (open_project/forget_recent)."),
  }, ["action"])],
  ["export_image", "Render the board or items to an image file on disk.", obj({
    path: str("Destination path (.png, .jpg or .svg)."), ids: ids("Only these items. Omitted = the whole level."),
    width: num("Output width in px."), background: str("Background colour, or \"transparent\" (PNG)."),
  }, ["path"])],
];

const TOOL_DEFS = TOOLS.map(([name, description, inputSchema]) => ({ name, description, inputSchema }));
const TOOL_NAMES = new Set(TOOLS.map(([name]) => name));

const INSTRUCTIONS = [
  "NetsuBoard is an infinite reference board (images, videos, YouTube, links, notes, frames, drawing).",
  "Coordinates are board units; x/y is an item's top-left corner. Call board_state first, then list_items or screenshot to see the board.",
  "Every edit is one undo step for the user and syncs to shared boards. Tools that take `ids` act on the current selection when ids are omitted.",
  "Before a big change (re-laying out or restyling many items, deleting, converting), take a checkpoint (save) or scenes › backup so you can come back; group related edits in one batch so they undo together and a failure leaves nothing half-done.",
  "Text: pass fit:true to size a note to its text, text_fit to equalise or fill sizes, valign/padding to place text in its box; timeline builds numbered steps in one call.",
  "Never stack items on top of each other: without x/y, new items go to the nearest free spot; with x/y, check the `overlaps` field of the answer (and board_state.overlaps) and fix them with move_items or layout_items.",
  "Sizes are relative to the content around them: titles, labels and frame titles (fontSize on a frame) must read at the zoom the content is read at; never leave a small default size next to large items.",
  "The app must be open with Settings › AI agents turned on.",
].join(" ");

// ── Core bridge ─────────────────────────────────────────────────────────────
function readEndpoint() {
  try {
    return JSON.parse(fs.readFileSync(ENDPOINT, "utf8"));
  } catch {
    return null;
  }
}

function postRpc(port, channel, args) {
  const body = JSON.stringify({ channel, args });
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/rpc", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

async function callBoard(tool, args) {
  const ep = readEndpoint();
  if (!ep?.port) return { ok: false, error: "NetsuBoard is not running (no agent endpoint found). Open the app." };
  try {
    const res = await postRpc(ep.port, "agent:call", [ep.secret, tool, args]);
    if (!res?.ok) return { ok: false, error: res?.error || "RPC failed." };
    return res.result || { ok: false, error: "Empty answer." };
  } catch (error) {
    return { ok: false, error: `NetsuBoard is not reachable: ${String(error?.message || error)}` };
  }
}

function toContent(answer) {
  const content = [];
  if (answer.image?.data) content.push({ type: "image", data: answer.image.data, mimeType: answer.image.mimeType || "image/png" });
  const payload = answer.ok ? answer.result : { error: answer.error };
  if (payload !== undefined || !content.length) content.push({ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload ?? null, null, 1) });
  return { content, isError: !answer.ok };
}

// ── JSON-RPC over stdio ─────────────────────────────────────────────────────
function send(msg) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
}

async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => id !== undefined && send({ id, result });
  const fail = (code, message) => id !== undefined && send({ id, error: { code, message } });
  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "netsuboard", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOL_DEFS });
    case "tools/call": {
      const name = params?.name;
      if (!TOOL_NAMES.has(name)) return fail(-32602, `Unknown tool: ${name}`);
      return reply(toContent(await callBoard(name, params?.arguments || {})));
    }
    default:
      if (method?.startsWith("notifications/")) return undefined;
      return fail(-32601, `Method not found: ${method}`);
  }
}

if (require.main === module) {
  let buffer = "";
  let inFlight = 0;
  let ended = false;
  const settle = () => { if (ended && inFlight === 0) process.exit(0); };
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        send({ id: null, error: { code: -32700, message: "Parse error" } });
        continue;
      }
      inFlight++;
      void handle(msg)
        .catch((error) => {
          if (msg.id !== undefined) send({ id: msg.id, error: { code: -32603, message: String(error?.message || error) } });
        })
        .finally(() => { inFlight--; settle(); });
    }
  });
  process.stdin.on("end", () => { ended = true; settle(); });
}

module.exports = { TOOL_DEFS, handle, toContent };

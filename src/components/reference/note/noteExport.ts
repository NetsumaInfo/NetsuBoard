// Markdown / HTML export and Markdown import of a note, through a throwaway headless BlockNote
// editor (the serialisers need no view). Custom blocks (equation, callout, toggle, media…) are
// translated to equivalent standard blocks BEFORE conversion, otherwise the lossy serialisers would
// drop them. Writing to disk is the caller's job (e.g. through the core's file-export channel).
import { BlockNoteEditor } from "@blocknote/core";
import i18n from "@/i18n";
import { noteSchema } from "./noteSchema";

type AnyBlock = Record<string, any>;
export type NoteBlock = AnyBlock;

// Headless editor for conversions (the schema's custom blocks included).
function headless() {
  return BlockNoteEditor.create({ schema: noteSchema });
}

function textRun(text: string, styles: Record<string, boolean> = {}): AnyBlock {
  return { type: "text", text, styles };
}

// Inline content: custom mentions → standard text or link.
function mapInline(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.map((c) => {
    if (!c || typeof c !== "object") return c;
    const cc = c as AnyBlock;
    if (cc.type === "boardMention") return textRun(`@${cc.props?.label || ""}`);
    if (cc.type === "dateMention") return textRun(String(cc.props?.date || ""));
    if (cc.type === "linkMention") {
      const url = String(cc.props?.url || "");
      const title = String(cc.props?.title || url);
      return { type: "link", href: url, content: [textRun(title)] };
    }
    return c;
  });
}

function parseGalleryUrls(raw: unknown): string[] {
  try { const a = JSON.parse(String(raw ?? "[]")); return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
}

// One custom block → its standard equivalent(s). Standard blocks pass through with translated
// inline content; children are handled recursively.
function mapBlock(blk: AnyBlock): AnyBlock[] {
  const props = (blk.props || {}) as AnyBlock;
  const children = Array.isArray(blk.children) ? prepareForExport(blk.children) : [];
  const inline = mapInline(blk.content);
  switch (blk.type) {
    case "equation": {
      const tex = String(props.tex || "").trim();
      return tex ? [{ type: "paragraph", content: [textRun(`$$${tex}$$`)], children }] : [];
    }
    case "callout": {
      const emoji = String(props.emoji || "");
      const content = [textRun(emoji ? `${emoji} ` : ""), ...(Array.isArray(inline) ? inline : [])];
      return [{ type: "quote", content, children }];
    }
    case "toggle":
      return [{ type: "bulletListItem", content: inline, children }];
    case "divider":
      return [{ type: "paragraph", content: [textRun("---")], children }];
    case "youtube": {
      const id = String(props.videoId || "");
      const url = id ? `https://youtu.be/${id}` : "";
      return url ? [{ type: "paragraph", content: [{ type: "link", href: url, content: [textRun(url)] }], children }] : [];
    }
    case "embed": case "bookmark": case "video": case "audio": case "file": {
      const url = String(props.url || "");
      const name = String(props.name || props.title || "") || url;
      return url ? [{ type: "paragraph", content: [{ type: "link", href: url, content: [textRun(name)] }], children }] : [];
    }
    case "gallery":
      return parseGalleryUrls(props.urls).map((url) => ({ type: "image", props: { url } }));
    default:
      return [{ ...blk, content: inline, children }];
  }
}

function prepareForExport(blocks: unknown[]): NoteBlock[] {
  const out: AnyBlock[] = [];
  for (const b of blocks || []) {
    if (!b || typeof b !== "object") continue;
    out.push(...mapBlock(b as AnyBlock));
  }
  return out;
}

export async function blocksToMarkdown(blocks: unknown[]): Promise<string> {
  return headless().blocksToMarkdownLossy(prepareForExport(blocks) as never);
}

async function blocksToHtml(blocks: unknown[]): Promise<string> {
  return headless().blocksToHTMLLossy(prepareForExport(blocks) as never);
}

// Standalone HTML export: a complete styled document (dark, system font) with the title on top —
// opens as is in a browser, ready to share.
export async function blocksToStandaloneHtml(blocks: unknown[], title: string, language = "fr"): Promise<string> {
  const body = await blocksToHtml(blocks);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="${esc(language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0 auto; max-width: 760px; padding: 48px 24px 96px; background: #0a0b0e; color: #e3e4e8;
         font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  h1.doc-title { font-size: 2rem; margin: 0 0 1.5rem; }
  a { color: #4f86f7; }
  blockquote { border-inline-start: 3px solid #4f86f7; margin-inline: 0; padding-inline-start: 14px; color: #888d99; }
  code { background: rgba(227, 228, 232, 0.1); border-radius: 4px; padding: 1px 5px; font-size: 0.88em; }
  pre code { display: block; padding: 12px; overflow-x: auto; }
  img { max-width: 100%; border-radius: 8px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { border: 1px solid #262a34; padding: 6px 10px; text-align: left; }
  th { background: #1a1d25; }
  hr { border: none; border-top: 1px solid #262a34; }
</style>
</head>
<body>
<h1 class="doc-title">${esc(title)}</h1>
${body}
</body>
</html>`;
}

export async function markdownToBlocks(md: string): Promise<NoteBlock[]> {
  return (await headless().tryParseMarkdownToBlocks(md)) as unknown as NoteBlock[];
}

// Safe file name from a title (characters forbidden on Windows → _).
export function safeFileName(title: string): string {
  return (String(title || "").replace(/[\\/:*?"<>|]+/g, "_").trim() || i18n.t("note:untitled")).slice(0, 80);
}

// Native file picker: resolves [{ name (no extension), text }], or [] when cancelled.
export function pickMarkdownFiles(): Promise<{ name: string; text: string }[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,.txt";
    input.multiple = true;
    input.onchange = async () => {
      const out: { name: string; text: string }[] = [];
      for (const f of Array.from(input.files || [])) {
        out.push({ name: f.name.replace(/\.(md|markdown|txt)$/i, ""), text: await f.text() });
      }
      resolve(out);
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}

// Whole document as plain text, one line per block (children indented under their parent are
// flattened in reading order). Used as a search/fallback text; mentions render as "@label".
export function blocksToPlain(blocks: unknown[]): string {
  const lines: string[] = [];
  const inlineText = (content: unknown): string => {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.map((c) => {
      if (!c || typeof c !== "object") return "";
      const cc = c as AnyBlock;
      if (cc.type === "text") return String(cc.text || "");
      if (cc.type === "link") return inlineText(cc.content);
      if (cc.type === "boardMention") return `@${cc.props?.label || ""}`;
      if (cc.type === "dateMention") return String(cc.props?.date || "");
      if (cc.type === "linkMention") return String(cc.props?.title || cc.props?.url || "");
      return "";
    }).join("");
  };
  const cellsText = (content: unknown): string => {
    const rows = (content as AnyBlock | undefined)?.rows;
    if (!Array.isArray(rows)) return "";
    return rows.map((r: AnyBlock) => (r.cells || []).map((cell: unknown) => inlineText((cell as AnyBlock)?.content ?? cell)).join(" ")).join("\n");
  };
  const walk = (list: unknown[]) => {
    for (const b of list || []) {
      if (!b || typeof b !== "object") continue;
      const blk = b as AnyBlock;
      const content = blk.content;
      const text = content && !Array.isArray(content) && typeof content === "object" ? cellsText(content) : inlineText(content);
      if (blk.type === "equation") lines.push(String(blk.props?.tex || ""));
      else if (text) lines.push(text);
      if (Array.isArray(blk.children)) walk(blk.children);
    }
  };
  walk(blocks);
  return lines.join("\n");
}

// Markdown text block: the renderer (nesting, tasks, tables, escaping, links) and the mode model
// (which mode an item is in, what a switch writes, legacy post-it migration).

import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/components/reference/boardDocs";
import {
  BLOCK_ACCENTS, blockSource, legacyMarkdown, modePatch, noteMode, plainToMarkdown, postitEditableInline,
  sheetIsRich, toggleTaskLine,
} from "@/components/reference/blockModel";
import type { BoardItem } from "@/components/reference/referenceShared";

const item = (p: Partial<BoardItem>): BoardItem =>
  ({ id: "a", kind: "text", ref: "", src: "", x: 0, y: 0, w: 200, h: 100, rotation: 0, z: 1, ...p }) as BoardItem;

describe("block Markdown renderer", () => {
  it("nests lists by indentation", () => {
    const html = renderMarkdown("- a\n  - b\n    - c\n- d");
    expect(html).toBe("<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li><li>d</li></ul>");
  });

  it("nests an ordered list inside a bullet and starts a new list when the type changes", () => {
    expect(renderMarkdown("- a\n  1. x\n  2. y")).toBe("<ul><li>a<ol><li>x</li><li>y</li></ol></li></ul>");
    expect(renderMarkdown("- a\n1. b")).toBe("<ul><li>a</li></ul><ol><li>b</li></ol>");
  });

  it("copes with uneven indentation and tabs", () => {
    expect(renderMarkdown("- a\n   - b\n     - c\n   - d")).toBe("<ul><li>a<ul><li>b<ul><li>c</li></ul></li><li>d</li></ul></li></ul>");
    expect(renderMarkdown("- a\n\t- b")).toBe("<ul><li>a<ul><li>b</li></ul></li></ul>");
  });

  it("renders tasks as checkboxes carrying their source line", () => {
    const html = renderMarkdown("title\n\n- [ ] one\n- [x] two", { tasks: "interactive" });
    expect(html).toContain('class="md-task"><span class="md-box" role="checkbox" aria-checked="false" data-line="2"');
    expect(html).toContain('data-done="1"><span class="md-box" role="checkbox" aria-checked="true" data-line="3"');
  });

  it("writes task items as glyphs when not interactive", () => {
    expect(renderMarkdown("- [x] done")).toBe("<ul><li>☑ done</li></ul>");
  });

  it("ticks a task in the source", () => {
    const md = "a\n- [ ] one\n  - [x] two";
    expect(toggleTaskLine(md, 1)).toBe("a\n- [x] one\n  - [x] two");
    expect(toggleTaskLine(md, 2)).toBe("a\n- [ ] one\n  - [ ] two");
    expect(toggleTaskLine(md, 0)).toBe(md);
  });

  it("escapes HTML and drops unsafe links and images", () => {
    const html = renderMarkdown("<script>alert(1)</script> [x](javascript:alert(1)) ![pic](http://a/b.png) [ok](https://a.b/c?d=1&e=2)");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img");
    expect(html).toContain('<a href="https://a.b/c?d=1&amp;e=2">ok</a>');
  });

  it("keeps markup out of a task, a heading and a table cell", () => {
    expect(renderMarkdown("- [ ] <b>x</b>", { tasks: "interactive" })).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(renderMarkdown("# <i>t</i>")).toBe("<h1>&lt;i&gt;t&lt;/i&gt;</h1>");
    expect(renderMarkdown("| a |\n| - |\n| <u>x</u> |")).toContain("<td>&lt;u&gt;x&lt;/u&gt;</td>");
  });

  it("renders a pipe table with alignment", () => {
    const html = renderMarkdown("| Name | Qty |\n|:--|--:|\n| a | 1 |\n| b | 2 |\n\nafter");
    expect(html).toContain('<th>Name</th><th style="text-align:right">Qty</th>');
    expect(html).toContain('<td>b</td><td style="text-align:right">2</td>');
    expect(html).toContain("<p>after</p>");
  });

  it("does not take a rule or bold text for a list", () => {
    expect(renderMarkdown("---")).toBe("<hr>");
    expect(renderMarkdown("**bold** word")).toBe("<p><strong>bold</strong> word</p>");
  });

  it("renders inline styles and code blocks", () => {
    expect(renderMarkdown("*i* ~~s~~ `c`")).toBe("<p><em>i</em> <del>s</del> <code>c</code></p>");
    expect(renderMarkdown("```\n<a> & b\n```")).toBe("<pre><code>&lt;a&gt; &amp; b</code></pre>");
  });
});

describe("text element modes", () => {
  it("tells the three modes apart", () => {
    expect(noteMode(item({ text: "x" }))).toBe("text");
    expect(noteMode(item({ noteStyle: "postit", text: "x" }))).toBe("block");
    expect(noteMode(item({ doc: [] }))).toBe("sheet");
    expect(noteMode(item({ doc: [], noteStyle: "card" }))).toBe("sheet");
    expect(noteMode(item({ kind: "image" }))).toBe("text");
  });

  it("shows a legacy post-it as a block and keeps a rich one as a sheet", () => {
    const lines = [
      { type: "paragraph", content: [{ type: "text", text: "Idées", styles: {} }] },
      { type: "bulletListItem", content: [{ type: "text", text: "plan", styles: {} }] },
      { type: "checkListItem", props: { checked: true }, content: [{ type: "text", text: "story", styles: {} }] },
    ];
    const legacy = item({ noteStyle: "postit", doc: lines });
    expect(noteMode(legacy)).toBe("block");
    expect(blockSource(legacy)).toBe("Idées\n- plan\n- [x] story");
    expect(legacyMarkdown(lines)).toBe("Idées\n- plan\n- [x] story");
    expect(postitEditableInline([{ type: "image", props: {} }])).toBe(false);
    expect(noteMode(item({ noteStyle: "postit", doc: [{ type: "image", props: { url: "x" } }] }))).toBe("sheet");
  });

  it("flags sheets that Markdown would mutilate", () => {
    expect(sheetIsRich([{ type: "heading" }, { type: "bulletListItem", children: [{ type: "paragraph" }] }])).toBe(false);
    expect(sheetIsRich([{ type: "paragraph" }, { type: "image" }])).toBe(true);
    expect(sheetIsRich([{ type: "paragraph", children: [{ type: "callout" }] }])).toBe(true);
  });

  it("text -> block keeps the text and the sync marker", () => {
    const p = modePatch(item({ text: "# hi", bg: "#123456", fontSize: 40 }), "block");
    expect(p).toMatchObject({ noteStyle: "postit", text: "# hi", doc: undefined, bg: undefined, fontSize: 15 });
    expect(modePatch(item({ text: "x", bg: BLOCK_ACCENTS[1] }), "block").bg).toBe(BLOCK_ACCENTS[1]);
  });

  it("block -> text and block -> sheet", () => {
    const block = item({ noteStyle: "postit", text: "- a", bg: BLOCK_ACCENTS[0] });
    expect(modePatch(block, "text")).toMatchObject({ noteStyle: undefined, text: "- a", bg: undefined, doc: undefined });
    const blocks = [{ type: "bulletListItem" }];
    expect(modePatch(block, "sheet", { blocks, plain: "a" })).toMatchObject({ doc: blocks, noteStyle: undefined, text: "a" });
  });

  it("sheet -> block / text takes the converted text", () => {
    const sheet = item({ doc: [{ type: "paragraph" }], text: "plain" });
    expect(modePatch(sheet, "block", { markdown: "**md**" })).toMatchObject({ noteStyle: "postit", text: "**md**", doc: undefined });
    expect(modePatch(sheet, "text", { plain: "plain" })).toMatchObject({ text: "plain", doc: undefined });
  });

  it("a legacy post-it migrates to text with its Markdown", () => {
    const legacy = item({ noteStyle: "postit", doc: [{ type: "checkListItem", props: { checked: false }, content: [{ type: "text", text: "a", styles: {} }] }] });
    expect(modePatch(legacy, "text").text).toBe("- [ ] a");
  });

  it("no change when the mode is already the target", () => {
    expect(modePatch(item({ text: "x" }), "text")).toEqual({});
  });

  it("writes text lines as separate Markdown paragraphs", () => {
    expect(plainToMarkdown("a\nb")).toBe("a\n\nb");
  });
});

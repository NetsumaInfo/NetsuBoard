import { describe, expect, it } from "vitest";
import {
  csvDelimiter, docCardSize, docLongSide, docSaveExt, docTypeOf, extractCount, formatBytes, gridFrom,
  parseCsv, renderMarkdown, stepPage, tableHtml,
} from "@/components/reference/boardDocs";

describe("document type by extension", () => {
  it("maps names to types", () => {
    expect(docTypeOf("C:\a\Brief.PDF")).toBe("pdf");
    expect(docTypeOf("x", "application/pdf")).toBe("pdf");
    expect(docTypeOf("notes.docx")).toBe("docx");
    for (const n of ["a.txt", "a.log", "a.json", "a.srt", "a.ass"]) expect(docTypeOf(n)).toBe("text");
    expect(docTypeOf("README.md")).toBe("markdown");
    expect(docTypeOf("t.csv")).toBe("csv");
    expect(docTypeOf("t.tsv")).toBe("csv");
    for (const n of ["a.xlsx", "a.pptx", "a.doc", "a.odt", "a.zip", "a.rtf", "a.weird"]) expect(docTypeOf(n)).toBe("file");
    expect(docTypeOf("noext")).toBeNull();
    expect(docTypeOf("brief.pdf.png")).toBe("file");
  });

  it("picks a save extension the core accepts", () => {
    expect(docSaveExt("a.DOCX")).toBe("docx");
    expect(docSaveExt("a.exe")).toBe("bin");
    expect(docSaveExt("a")).toBe("bin");
  });
});

describe("document card sizing", () => {
  it("makes page cards bigger than a photo", () => {
    expect(docLongSide("pdf", 420)).toBe(560);
    expect(docLongSide("docx", 800)).toBe(800);
    expect(docLongSide("file", 420)).toBe(420);
  });
  it("scales a page to the requested long side, up as well as down", () => {
    expect(docCardSize(612, 792, 560)).toEqual({ w: 433, h: 560 });
    expect(docCardSize(100, 200, 560)).toEqual({ w: 280, h: 560 });
    expect(docCardSize(0, 0, 400)).toEqual({ w: 300, h: 400 });
  });
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
  });
});

describe("pages", () => {
  it("caps extraction and clamps the carousel", () => {
    expect(extractCount(250)).toBe(100);
    expect(extractCount(3)).toBe(3);
    expect(extractCount(NaN)).toBe(0);
    expect(stepPage(1, -1, 5)).toBe(1);
    expect(stepPage(5, 1, 5)).toBe(5);
    expect(stepPage(2, 1, 5)).toBe(3);
  });
  it("lays a grid from its top-left corner", () => {
    const g = gridFrom(5, 100, 50, { x: 10, y: 20 }, 10);
    expect(g[0]).toEqual({ x: 10, y: 20 });
    expect(g[1]).toEqual({ x: 120, y: 20 });
    expect(g[3]).toEqual({ x: 10, y: 80 });
    expect(g).toHaveLength(5);
  });
});

describe("csv", () => {
  it("parses RFC 4180 quoting", () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\n"two\nlines",z\n')).toEqual([
      ["a", "b"],
      ["x, y", 'he said "hi"'],
      ["two\nlines", "z"],
    ]);
  });
  it("keeps empty fields and drops the trailing blank line", () => {
    expect(parseCsv("a,,c\n,,\n")).toEqual([["a", "", "c"], ["", "", ""]]);
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv('"",x')).toEqual([["", "x"]]);
  });
  it("sniffs the delimiter", () => {
    expect(csvDelimiter("a.tsv", "a,b")).toBe("\t");
    expect(csvDelimiter("a.csv", "a;b;c\n1;2;3")).toBe(";");
    expect(csvDelimiter("a.csv", "a,b")).toBe(",");
    expect(parseCsv("a;b\n1;2", ";")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("escapes cells in the table", () => {
    const html = tableHtml([["h"], ["<b>x</b>", "extra"]]);
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>");
    expect(html.match(/<th>/g)).toHaveLength(2);
  });
});

describe("markdown", () => {
  it("renders the common blocks", () => {
    const html = renderMarkdown("# Title\n\ntext with **bold**, *it* and `code`\n\n- a\n- b\n\n1. one\n2. two\n\n> quote\n\n---\n\n```\nx < y\n```");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>it</em>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<ul><li>a</li><li>b</li></ul>");
    expect(html).toContain("<ol><li>one</li><li>two</li></ol>");
    expect(html).toContain("<blockquote>quote</blockquote>");
    expect(html).toContain("<hr>");
    expect(html).toContain("<pre><code>x &lt; y</code></pre>");
  });
  it("escapes raw HTML before anything else", () => {
    const html = renderMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });
  it("only links http, https and mailto, and never loads images", () => {
    expect(renderMarkdown("[ok](https://a.dev/x_y_z)")).toContain('<a href="https://a.dev/x_y_z">ok</a>');
    expect(renderMarkdown("[bad](javascript:alert(1))")).not.toContain("href");
    expect(renderMarkdown("[bad](data:text/html;base64,AAAA)")).not.toContain("href");
    const img = renderMarkdown("![logo](https://a.dev/x.png)");
    expect(img).not.toContain("<img");
    expect(img).toContain("logo");
  });
  it("keeps emphasis out of code spans and urls", () => {
    expect(renderMarkdown("`*a*`")).toBe("<p><code>*a*</code></p>");
    expect(renderMarkdown("[x](https://a.dev/*a*)")).toContain('href="https://a.dev/*a*"');
  });
});

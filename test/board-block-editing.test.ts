// Markdown block editor: the pure text transforms behind the shortcuts, the bar and the "/" menu,
// and the tap detector that opens the editor on a double-click.

import { describe, expect, it } from "vitest";
import {
  applyFormat, applySlash, autoFormat, continueList, filterSlash, indent, insertLink, moveLines, renumber,
  setBlock, slashContext, toggleInline, type Edit,
} from "@/components/reference/blockEditing";
import { DOUBLE_TAP_MS, isTap, registerTap } from "@/components/reference/blockGesture";

// "|" marks the caret, "[" "]" a selection.
function edit(src: string): Edit {
  const a = src.indexOf("«");
  if (a >= 0) {
    const b = src.indexOf("»", a);
    const value = src.slice(0, a) + src.slice(a + 1, b) + src.slice(b + 1);
    return { value, start: a, end: b - 1 };
  }
  const c = src.indexOf("|");
  return { value: src.replace("|", ""), start: c, end: c };
}
function show(e: Edit): string {
  if (e.start === e.end) return e.value.slice(0, e.start) + "|" + e.value.slice(e.start);
  return e.value.slice(0, e.start) + "«" + e.value.slice(e.start, e.end) + "»" + e.value.slice(e.end);
}

describe("lists on Enter", () => {
  it("continues bullets, numbers and tasks", () => {
    expect(show(continueList(edit("- a|"))!)).toBe("- a\n- |");
    expect(show(continueList(edit("* a|"))!)).toBe("* a\n* |");
    expect(show(continueList(edit("1. a|"))!)).toBe("1. a\n2. |");
    expect(show(continueList(edit("- [x] a|"))!)).toBe("- [x] a\n- [ ] |");
    expect(show(continueList(edit("  - a|"))!)).toBe("  - a\n  - |");
  });
  it("splits the line at the caret and renumbers what follows", () => {
    expect(show(continueList(edit("1. ab|cd\n2. e"))!)).toBe("1. ab\n2. |cd\n3. e");
  });
  it("ends the list on an empty item, one level at a time", () => {
    expect(show(continueList(edit("- a\n- |"))!)).toBe("- a\n|");
    expect(show(continueList(edit("- a\n  - |"))!)).toBe("- a\n- |");
  });
  it("leaves plain lines and selections to the browser", () => {
    expect(continueList(edit("text|"))).toBeNull();
    expect(continueList(edit("«- a»"))).toBeNull();
    expect(continueList(edit("|- a"))).toBeNull();
  });
});

describe("renumber", () => {
  it("fixes a broken sequence and keeps the first number", () => {
    expect(renumber(edit("1. a\n1. b\n5. c|")).value).toBe("1. a\n2. b\n3. c");
    expect(renumber(edit("3. a\n9. b|")).value).toBe("3. a\n4. b");
  });
  it("numbers nested levels apart and restarts after a break", () => {
    expect(renumber(edit("1. a\n  1. x\n  1. y\n1. b|")).value).toBe("1. a\n  1. x\n  2. y\n2. b");
    expect(renumber(edit("1. a\n\ntext\n4. b|")).value).toBe("1. a\n\ntext\n4. b");
  });
  it("keeps the caret on the same text", () => {
    expect(show(renumber(edit("1. a\n1. b|")))).toBe("1. a\n2. b|");
  });
});

describe("indent", () => {
  it("indents and outdents every line of a selection", () => {
    expect(indent(edit("«- a\n- b»"), false).value).toBe("  - a\n  - b");
    expect(indent(edit("«  - a\n  - b»"), true).value).toBe("- a\n- b");
  });
  it("shifts a list item from anywhere on its line", () => {
    expect(show(indent(edit("- a|b"), false))).toBe("  - a|b");
    expect(show(indent(edit("  - a|b"), true))).toBe("- a|b");
  });
  it("types two spaces on a plain line", () => {
    expect(show(indent(edit("a|"), false))).toBe("a  |");
  });
  it("renumbers a numbered list after a shift", () => {
    expect(indent(edit("1. a\n2. b|\n3. c"), false).value).toBe("1. a\n  2. b\n2. c");
  });
});

describe("inline marks", () => {
  it("wraps and unwraps a selection", () => {
    expect(show(toggleInline(edit("a «b» c"), "**"))).toBe("a **«b»** c");
    expect(show(toggleInline(edit("a **«b»** c"), "**"))).toBe("a «b» c");
    expect(show(toggleInline(edit("«**b**»"), "**"))).toBe("«b»");
  });
  it("opens a pair around an empty caret", () => {
    expect(show(toggleInline(edit("a |"), "`"))).toBe("a `|`");
  });
  it("does not take the edge of bold for italic", () => {
    expect(toggleInline(edit("**«b»**"), "*").value).toBe("***b***");
  });
  it("links: selection becomes the text, the url is selected", () => {
    expect(insertLink(edit("see «here» ok")).value).toBe("see [here](url) ok");
    expect(show(insertLink(edit("see «here» ok")))).toBe("see [here](«url») ok");
    expect(show(insertLink(edit("«https://a.io»")))).toBe("[|](https://a.io)");
    expect(insertLink(edit("|")).value).toBe("[text](url)");
  });
});

describe("block formats", () => {
  it("sets and toggles headings", () => {
    expect(show(setBlock(edit("tit|le"), "h2"))).toBe("## tit|le");
    expect(setBlock(edit("## title|"), "h2").value).toBe("title");
    expect(setBlock(edit("## title|"), "h1").value).toBe("# title");
    expect(setBlock(edit("# title|"), "paragraph").value).toBe("title");
  });
  it("turns lines into lists and back", () => {
    expect(setBlock(edit("«a\nb»"), "bullet").value).toBe("- a\n- b");
    expect(setBlock(edit("«a\nb»"), "numbered").value).toBe("1. a\n2. b");
    expect(setBlock(edit("«a\nb»"), "task").value).toBe("- [ ] a\n- [ ] b");
    expect(setBlock(edit("«- a\n- b»"), "bullet").value).toBe("a\nb");
    expect(setBlock(edit("- a|"), "numbered").value).toBe("1. a");
    expect(setBlock(edit("«a\nb»"), "quote").value).toBe("> a\n> b");
  });
  it("skips blank lines inside a selection", () => {
    expect(setBlock(edit("«a\n\nb»"), "numbered").value).toBe("1. a\n\n2. b");
  });
  it("inserts a divider and a table on their own lines", () => {
    expect(applyFormat(edit("text|"), "divider").value).toBe("text\n---\n");
    expect(applyFormat(edit("|"), "divider").value).toBe("---\n");
    expect(applyFormat(edit("t|"), "table").value).toContain("| --- | --- |");
  });
});

describe("move lines", () => {
  it("swaps with the neighbour and follows the caret", () => {
    expect(show(moveLines(edit("a\nb|\nc"), -1))).toBe("b|\na\nc");
    expect(show(moveLines(edit("a|\nb\nc"), 1))).toBe("b\na|\nc");
    expect(moveLines(edit("|a\nb"), -1).value).toBe("a\nb");
    expect(moveLines(edit("a\nb|"), 1).value).toBe("a\nb");
  });
});

describe("typing conveniences", () => {
  it("turns [] and 1) into list markers", () => {
    expect(show(autoFormat(edit("[] |"))!)).toBe("- [ ] |");
    expect(show(autoFormat(edit("  [] |"))!)).toBe("  - [ ] |");
    expect(show(autoFormat(edit("1) |"))!)).toBe("1. |");
    expect(autoFormat(edit("a [] |"))).toBeNull();
  });
});

describe('"/" menu', () => {
  it("is open only on a slash that starts the line", () => {
    expect(slashContext("/he", 3)).toEqual({ from: 0, query: "he" });
    expect(slashContext("a\n  /", 5)).toEqual({ from: 4, query: "" });
    expect(slashContext("a /he", 5)).toBeNull();
    expect(slashContext("/a b", 4)).toBeNull();
  });
  it("filters as you type", () => {
    expect(filterSlash("tab").map((c) => c.id)).toEqual(["table"]);
    expect(filterSlash("").length).toBeGreaterThan(8);
    expect(filterSlash("zzz")).toEqual([]);
  });
  it("replaces the typed command with the block", () => {
    const r = applySlash("x\n/h2", { from: 2, query: "h2" }, 5, "h2");
    expect(r.value).toBe("x\n## ");
    expect(r.start).toBe(r.value.length);
  });
});

describe("double tap", () => {
  const tap = (t: number, x = 10, y = 10, id = "a") => ({ id, x, y, t });
  it("two close taps on one item are a double tap, and reset", () => {
    const first = registerTap(null, tap(0));
    expect(first.double).toBe(false);
    const second = registerTap(first.next, tap(200, 12, 11));
    expect(second.double).toBe(true);
    expect(second.next).toBeNull();
    expect(registerTap(second.next, tap(300)).double).toBe(false);
  });
  it("is not a double tap when slow, far, or on another item", () => {
    const a = tap(0);
    expect(registerTap(a, tap(DOUBLE_TAP_MS + 1)).double).toBe(false);
    expect(registerTap(a, tap(100, 40, 10)).double).toBe(false);
    expect(registerTap(a, tap(100, 10, 10, "b")).double).toBe(false);
  });
  it("a press that moved is no tap", () => {
    expect(isTap({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(true);
    expect(isTap({ x: 0, y: 0 }, { x: 9, y: 0 })).toBe(false);
  });
});

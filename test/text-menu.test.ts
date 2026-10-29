// Right-click menu rules: which menu opens for a target, which entries show and which are greyed,
// and the note sheet's block helpers.

import { describe, expect, it } from "vitest";
import { resolveMenu, textMenuPlan, type TextTarget } from "../src/components/common/textMenuPolicy";
import { clipboardUrl, isConvertible, stripBlockIds } from "../src/components/reference/note/noteMenuModel";

const base: TextTarget = {
  field: "input", readOnly: false, secret: false, empty: false, hasSelection: true, canPaste: true, selectable: false,
};
const plan = (over: Partial<TextTarget>) => textMenuPlan({ ...base, ...over });
const byAction = (over: Partial<TextTarget>) => Object.fromEntries(plan(over).map((p) => [p.action, p.disabled]));

describe("resolveMenu", () => {
  const ctx = { editable: false, inOwnMenu: false, extension: false, selectionHere: false };

  it("gives an editable field the text menu, even inside a surface with its own menu", () => {
    expect(resolveMenu({ ...ctx, editable: true })).toBe("text");
    expect(resolveMenu({ ...ctx, editable: true, inOwnMenu: true })).toBe("text");
  });

  it("leaves a surface with its own menu alone", () => {
    expect(resolveMenu({ ...ctx, inOwnMenu: true })).toBe("own");
    expect(resolveMenu({ ...ctx, inOwnMenu: true, selectionHere: true })).toBe("own");
  });

  it("offers Copy over a selection on a bare surface, nothing otherwise", () => {
    expect(resolveMenu({ ...ctx, selectionHere: true })).toBe("selection");
    expect(resolveMenu(ctx)).toBe("none");
  });

  it("opens the menu on a read-only extension surface even without a selection", () => {
    expect(resolveMenu({ ...ctx, extension: true })).toBe("selection");
  });
});

describe("textMenuPlan", () => {
  it("lists every entry of an input, without plain paste", () => {
    expect(plan({}).map((p) => p.action)).toEqual(["cut", "copy", "paste", "selectAll"]);
  });

  it("adds plain paste to rich fields", () => {
    expect(plan({ field: "editable" }).map((p) => p.action)).toEqual(["cut", "copy", "paste", "pastePlain", "selectAll"]);
  });

  it("greys Cut and Copy without a selection", () => {
    const d = byAction({ hasSelection: false });
    expect(d.cut).toBe(true);
    expect(d.copy).toBe(true);
    expect(d.paste).toBe(false);
  });

  it("greys Cut and Paste in a read-only field but keeps Copy", () => {
    const d = byAction({ field: "editable", readOnly: true });
    expect(d.cut).toBe(true);
    expect(d.paste).toBe(true);
    expect(d.pastePlain).toBe(true);
    expect(d.copy).toBe(false);
  });

  it("greys Paste when the clipboard cannot be read", () => {
    expect(byAction({ canPaste: false }).paste).toBe(true);
  });

  it("greys Select all in an empty field", () => {
    expect(byAction({ empty: true }).selectAll).toBe(true);
  });

  it("never offers Cut or Copy on a password field", () => {
    expect(plan({ secret: true }).map((p) => p.action)).toEqual(["paste", "selectAll"]);
  });

  it("gives a read-only surface Copy and Select all only", () => {
    const p = plan({ field: "none", readOnly: true, hasSelection: false, selectable: true });
    expect(p).toEqual([{ action: "copy", disabled: true }, { action: "selectAll", disabled: false }]);
    expect(plan({ field: "none", selectable: false }).map((x) => x.action)).toEqual(["copy"]);
  });
});

describe("note menu model", () => {
  it("converts text blocks only", () => {
    expect(isConvertible("paragraph")).toBe(true);
    expect(isConvertible("codeBlock")).toBe(true);
    expect(isConvertible("image")).toBe(false);
    expect(isConvertible("gallery")).toBe(false);
  });

  it("strips ids from a block and its children", () => {
    const copy = stripBlockIds({
      id: "a", type: "paragraph", props: { x: 1 },
      children: [{ id: "b", type: "paragraph", children: [{ id: "c", type: "paragraph", children: [] }] }],
    });
    expect(JSON.stringify(copy)).not.toMatch(/"id"/);
    expect(copy).toMatchObject({ type: "paragraph", props: { x: 1 } });
  });

  it("keeps a block without children childless", () => {
    expect("children" in stripBlockIds({ id: "a", type: "image" })).toBe(false);
  });

  it("accepts a lone http(s) address from the clipboard", () => {
    expect(clipboardUrl(" https://example.com/a?b=1 ")).toBe("https://example.com/a?b=1");
    expect(clipboardUrl("two words https://example.com")).toBeNull();
    expect(clipboardUrl("ftp://example.com")).toBeNull();
  });
});

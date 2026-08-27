import { describe, expect, it } from "vitest";

import { displaySrc, isCollabRef, isCoreFileRef, isRemoteRef } from "../../src/components/reference/referenceShared";

// A `collab:` locator is served by the shell's own protocol. It is neither a remote link nor a file
// the core service can open, and every "is this local?" test that forgot the third case sent it to
// the core: a dead address, then an item declared missing, then a re-download of its source page.
describe("collaborative media locators", () => {
  it("is neither remote nor core-readable", () => {
    const ref = `collab:${"a".repeat(64)}`;
    expect(isCollabRef(ref)).toBe(true);
    expect(isRemoteRef(ref)).toBe(false);
    expect(isCoreFileRef(ref)).toBe(false);
  });

  it("keeps disk paths and remote links apart", () => {
    expect(isCoreFileRef("C:\clips\reel.mp4")).toBe(true);
    expect(isCoreFileRef("https://example.com/a.mp4")).toBe(false);
    expect(isCoreFileRef("")).toBe(false);
    expect(isCoreFileRef(undefined)).toBe(false);
  });

  it("has no display address of its own: the projection supplies it", () => {
    expect(displaySrc("video", `collab:${"a".repeat(64)}`)).toBe("");
    expect(displaySrc("video", "https://example.com/a.mp4")).toBe("https://example.com/a.mp4");
  });
});

// Live-site toolbar helpers: address validation and the per-host ad-block allowlist.

import { describe, expect, it } from "vitest";
import { hostMatches, hostOf, normalizeNavUrl, toggleAllowed } from "@/components/reference/liveSiteUrl";

describe("normalizeNavUrl", () => {
  it("keeps http(s) and adds https to a bare domain", () => {
    expect(normalizeNavUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(normalizeNavUrl("http://example.com")).toBe("http://example.com/");
    expect(normalizeNavUrl("example.com/page")).toBe("https://example.com/page");
    expect(normalizeNavUrl("  example.com  ")).toBe("https://example.com/");
  });

  it("rejects other schemes, spaces and non-addresses", () => {
    expect(normalizeNavUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeNavUrl("file:///c:/secret.txt")).toBeNull();
    expect(normalizeNavUrl("data:text/html,hi")).toBeNull();
    expect(normalizeNavUrl("two words")).toBeNull();
    expect(normalizeNavUrl("")).toBeNull();
    expect(normalizeNavUrl("nodotshere")).toBeNull();
  });
});

describe("ad-block allowlist", () => {
  it("matches a host and its subdomains, not look-alikes", () => {
    const list = ["example.com"];
    expect(hostMatches(list, "example.com")).toBe(true);
    expect(hostMatches(list, "www.example.com")).toBe(true);
    expect(hostMatches(list, "cdn.example.com")).toBe(true);
    expect(hostMatches(list, "notexample.com")).toBe(false);
    expect(hostMatches(list, "example.com.evil.net")).toBe(false);
    expect(hostMatches([""], "example.com")).toBe(false);
    expect(hostMatches(list, "")).toBe(false);
  });

  it("adds and removes without duplicates", () => {
    const one = toggleAllowed([], "WWW.Example.com", true);
    expect(one).toEqual(["example.com"]);
    expect(toggleAllowed(one, "example.com", true)).toEqual(["example.com"]);
    expect(toggleAllowed(one, "example.com", false)).toEqual([]);
  });

  it("extracts a clean host", () => {
    expect(hostOf("https://www.ArtStation.com/x")).toBe("artstation.com");
    expect(hostOf("not a url")).toBe("");
  });
});

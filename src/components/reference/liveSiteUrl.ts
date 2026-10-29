// Pure helpers of the live-site toolbar: address validation and the per-host ad-block allowlist.
// The allowlist lives in the renderer (localStorage) and is pushed to the Rust side on open and on
// every change (`nr.liveSite.allow`); Rust applies the same host-or-subdomain rule.

const ALLOW_KEY = "nb.liveSite.adblockAllow";

/** Turns what was typed in the address field into an http(s) URL, or null when it is not one. */
export function normalizeNavUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[^/]*:\d+(\/|$)/.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname || (!url.hostname.includes(".") && url.hostname !== "localhost")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Host without `www.`, lower case; empty when the URL cannot be parsed. */
export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./i, "").toLowerCase(); } catch { return ""; }
}

/** An entry covers its own host and every subdomain of it. */
export function hostMatches(list: readonly string[], host: string): boolean {
  const h = host.replace(/^www\./i, "").toLowerCase();
  if (!h) return false;
  return list.some((entry) => {
    const e = entry.trim().replace(/^www\./i, "").toLowerCase();
    return !!e && (h === e || h.endsWith(`.${e}`));
  });
}

/** The list with `host` added or removed (never duplicated, never empty entries). */
export function toggleAllowed(list: readonly string[], host: string, allowed: boolean): string[] {
  const h = host.replace(/^www\./i, "").toLowerCase();
  const rest = list.filter((e) => e !== h);
  return allowed && h ? [...rest, h] : rest;
}

export function loadAllowlist(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(ALLOW_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveAllowlist(list: readonly string[]): void {
  try { localStorage.setItem(ALLOW_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
}

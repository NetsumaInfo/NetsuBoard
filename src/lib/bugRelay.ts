// Convex relay coordinates attached to a bug report. The core cannot find them on its own: the site
// URL is baked into the RENDERER at build time (`VITE_CONVEX_SITE_URL`) and the session lives in the
// webview's localStorage (crossDomain plugin — no cookie outside the Convex domain).
// `authClient` is imported dynamically: statically it would pull better-auth into the entry chunk of
// every renderer, for a feature that does not exist without a deployment.

import { convexSiteUrl } from "./convexEnv";

export type BugRelay = { site: string; cookie: string };

export function bugRelayConfigured(): boolean {
  return !!convexSiteUrl;
}

export async function bugRelay(): Promise<BugRelay | null> {
  if (!convexSiteUrl) return null;
  try {
    const { authClient } = await import("./authClient");
    return { site: convexSiteUrl, cookie: authClient.getCookie() || "" };
  } catch {
    // Session unreadable: send anyway, the relay accepts anonymous reports. The session only names
    // the tester in the embed and gives them their own hourly cap.
    return { site: convexSiteUrl, cookie: "" };
  }
}

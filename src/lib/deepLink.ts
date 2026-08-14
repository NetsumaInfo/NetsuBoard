import { authClient } from "@/lib/authClient";
import { stampAuth } from "@/lib/offlineAuth";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Desktop OAuth return: the crossDomain plugin (Convex server) redirects to
// `netsuboard://auth?ott=<token>` (one-time token, 3 min). We trade it for a session:
// POST /cross-domain/one-time-token/verify → the client fetch plugin stores the session cookie
// (localStorage "netsuboard_cookie") → useConvexAuth flips to authenticated.
async function completeAuth(url: string): Promise<void> {
  try {
    const ott = new URL(url).searchParams.get("ott");
    if (!ott) {
      console.warn("[auth] deep link without ott:", url);
      return;
    }
    const res = (await authClient.$fetch("/cross-domain/one-time-token/verify", {
      method: "POST",
      body: { token: ott },
    })) as { error?: unknown };
    if (res?.error) {
      console.error("[auth] token verification failed", res.error);
      return;
    }
    await authClient.getSession(); // hydrates the session (useConvexAuth signal)
    stampAuth();
    console.info("[auth] session established through the deep link");
  } catch (e) {
    console.error("[auth] deep-link completion", e);
  }
}

function handleUrls(urls: string[]): void {
  for (const url of urls) {
    if (url.startsWith("netsuboard://auth")) void completeAuth(url);
  }
}

let started = false;

// Listens to `netsuboard://` links: on a cold start (getCurrent) and while running (onOpenUrl).
export async function initAuthDeepLink(): Promise<void> {
  if (!isTauri || started) return;
  started = true;
  try {
    const dl = await import("@tauri-apps/plugin-deep-link");
    const initial = await dl.getCurrent(); // cold start (the URL launched the app)
    if (initial) handleUrls(initial);
    await dl.onOpenUrl(handleUrls); // macOS / plugin cold start

    // WARM return (app already open): Windows relaunches the exe, and the single-instance callback
    // (lib.rs) re-emits the URL here. That is THE nominal path on Windows when the app is running.
    const { listen } = await import("@tauri-apps/api/event");
    await listen<string>("nb-deep-link", (e) => {
      if (typeof e.payload === "string") handleUrls([e.payload]);
    });
  } catch (e) {
    console.error("[auth] deep-link init", e);
  }
}

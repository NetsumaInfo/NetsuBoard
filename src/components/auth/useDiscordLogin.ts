import { useCallback, useState } from "react";
import { authClient } from "@/lib/authClient";
import i18n from "@/i18n";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// OAuth return: we aim at the HTTPS page `/auth/done` of the Convex site (not the scheme directly) →
// the browser shows a real page which relaunches the app through `netsuboard://auth?ott=…` and then
// invites closing the tab (no more "loading forever"). Falls back to the scheme if the site is unset.
const SITE = import.meta.env.VITE_CONVEX_SITE_URL as string | undefined;
const AUTH_CALLBACK = SITE ? `${SITE}/auth/done` : "netsuboard://auth";

/**
 * Starts the Discord login: opens the SYSTEM BROWSER on the authorization URL (never the webview →
 * the app is never left). The session completes on the deep-link return, reactively.
 */
export function useDiscordLogin() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async () => {
    setError(null);
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setError(i18n.t("auth:login.offlineNeedsNet"));
      return;
    }
    setBusy(true);
    let handedOff = false;
    try {
      // disableRedirect: returns the URL instead of navigating the webview.
      const res = await authClient.signIn.social({
        provider: "discord",
        callbackURL: AUTH_CALLBACK,
        disableRedirect: true,
      });
      const url = (res as { data?: { url?: string } }).data?.url;
      if (!url) throw new Error(i18n.t("auth:login.authUrlMissing"));
      if (isTauri) {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(url);
      } else {
        window.open(url, "_blank", "noopener");
      }
      // busy stays true: "waiting for Discord…" until the deep-link return (the gate renders the app).
      handedOff = true;
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      if (!handedOff) setBusy(false);
    }
  }, []);

  // Resets the wait ("try again" if the user comes back without having approved).
  const reset = useCallback(() => {
    setBusy(false);
    setError(null);
  }, []);

  return { login, busy, error, reset };
}

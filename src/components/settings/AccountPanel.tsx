// Settings › Account: the only door to the Discord sign-in once the gate has been passed. The login
// screen promises "you can connect your account later in the settings" (`auth:login.skipHint`) and
// the skip choice is persisted — without this page that promise led nowhere and a skipped account
// could never be connected again, short of clearing the localStorage.
//
// LAZILY loaded by `AppSettings`: this file pulls `convex/react` and the Better Auth client, which
// must stay out of the entry chunk of an app that opens without a backend.

import { useEffect, useState } from "react";
import { LogOut, RefreshCw, UserRound } from "lucide-react";
import { siDiscord } from "simple-icons";
import { useTranslation } from "react-i18next";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { convexConfigured } from "@/lib/convexEnv";
import { authClient } from "@/lib/authClient";
import { clearAuthStamp } from "@/lib/offlineAuth";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useDiscordLogin } from "@/components/auth/useDiscordLogin";
import { AvatarDecoration } from "./AvatarDecoration";
import { CollabSection } from "./CollabSection";
import { useDiscordProfile } from "./useDiscordProfile";

// Better Auth user document (Discord fields: name = handle, image = avatar, email).
type AuthUser = { name?: string | null; email?: string | null; image?: string | null } | null | undefined;

// The offline grace is dropped with the session: kept, it would let a signed-out install run for
// another 7 days as if it were signed in.
async function signOut() {
  clearAuthStamp();
  try { await authClient.signOut(); } catch { /* best-effort */ }
}

export function AccountPanel() {
  const { t } = useTranslation("settings");
  // Outside the Convex provider (no deployment configured): no hooks, plain message.
  if (!convexConfigured) {
    return (
      <section>
        <h2 className="text-sm font-medium">{t("account.title")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("account.notConfigured")}</p>
      </section>
    );
  }
  return <AccountInner />;
}

function AccountInner() {
  const { t } = useTranslation(["settings", "auth", "common"]);
  const { isLoading, isAuthenticated } = useConvexAuth();
  const user = useQuery(api.auth.getCurrentUser) as AuthUser;
  const profile = useDiscordProfile(); // avatar + Nitro decoration (via the OAuth token)
  const { login, busy, error, reset } = useDiscordLogin();
  const pending = isLoading || user === undefined;

  // A query that never resolves left this card spinning forever with nothing to act on — the worst
  // possible state, because it looks identical to a slow network and to a blocked one. The backend
  // is reached over a WebSocket to *.convex.cloud plus HTTPS to *.convex.site; a firewall, a proxy
  // or a captive network stops either silently. After the delay the user gets a cause and a retry.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!pending) {
      setTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setTimedOut(true), 8000);
    return () => window.clearTimeout(timer);
  }, [pending]);

  return (
    <section>
      <h2 className="text-sm font-medium">{t("settings:account.title")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("settings:account.subtitle")}</p>

      <div className="mt-4 rounded-lg border border-border p-4">
        {pending && timedOut ? (
          <div className="space-y-3">
            <p className="text-sm text-destructive">{t("settings:account.unreachable")}</p>
            <p className="text-xs text-muted-foreground">{t("settings:account.unreachableHint")}</p>
            <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
              <RefreshCw className="size-3.5" /> {t("settings:account.retry")}
            </Button>
          </div>
        ) : pending ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" /> {t("common:status.loading")}
          </div>
        ) : !isAuthenticated || !user ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("settings:account.none")}</p>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button
              size="sm"
              onClick={busy ? reset : () => void login()}
              className="gap-2 bg-[#5865F2] text-white hover:bg-[#4752c4]"
            >
              <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
                <path d={siDiscord.path} fill="currentColor" />
              </svg>
              {busy ? t("auth:login.waitingDiscord") : t("auth:login.signInDiscord")}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="relative size-12 shrink-0">
              {user.image ? (
                <img
                  src={user.image}
                  alt=""
                  className="size-12 rounded-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <UserRound className="size-6" />
                </div>
              )}
              {/* Discord avatar decoration (Nitro frame) laid over it, as in the client. */}
              <AvatarDecoration url={profile?.decorationUrl} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.name || t("settings:account.discordUser")}</p>
              {/* The ACCOUNT is identified by its e-mail, not by a Discord handle: this card answers
                  "which account am I signed in as", and a renamed Discord pseudonym must not change
                  that answer. The handle belongs to the friends section, where it is what people
                  type to add each other. */}
              {user.email && <p className="truncate text-xs text-muted-foreground">{user.email}</p>}
            </div>
            <Button variant="outline" size="sm" onClick={() => void signOut()}>
              <LogOut className="size-3.5" /> {t("settings:account.signOut")}
            </Button>
          </div>
        )}
      </div>

      {/* Friends and this device only exist for a signed-in account: the section returns null otherwise. */}
      <CollabSection />
    </section>
  );
}

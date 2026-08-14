import { useEffect, useState, type ReactNode } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/convexApi";
import { convexConfigured } from "@/lib/convexEnv";
import { stampAuth, offlineGraceValid } from "@/lib/offlineAuth";
import { authWasSkipped, persistAuthSkip } from "@/lib/authBypass";
import { LoginScreen } from "./LoginScreen";
import { NoAccessScreen } from "./NoAccessScreen";
import { GateFrame } from "./GateFrame";

type AccessResult = {
  authenticated: boolean;
  hasAccess: boolean;
  role: string | null;
  userId?: string;
};

// Convex unreachable (network down): useConvexAuth stays stuck on isLoading → past this delay we
// fall back to the offline grace rather than spin forever.
const UNREACHABLE_MS = 8000;

function Checking() {
  return (
    <GateFrame>
      <div className="grid min-h-48 place-items-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    </GateFrame>
  );
}

/**
 * Optional Discord sign-in gate. The "skip" choice is persisted locally; a valid session also keeps
 * a 7-day offline grace. When Convex is not configured (dev, browser, no env) → renders the children
 * directly, so a board never becomes unopenable because a backend is missing.
 */
export function LoginGate({ children }: { children: ReactNode }) {
  const [skipped, setSkipped] = useState(authWasSkipped);
  if (!convexConfigured || skipped) return <>{children}</>;
  const skip = () => {
    persistAuthSkip();
    setSkipped(true);
  };
  return <LoginGateInner onSkip={skip}>{children}</LoginGateInner>;
}

function LoginGateInner({ children, onSkip }: { children: ReactNode; onSkip: () => void }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const access = useQuery(api.access.getAccess) as AccessResult | undefined;
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // Convex resolution dragging on → treat the network as unreachable.
  useEffect(() => {
    if (!isLoading) {
      setTimedOut(false);
      return;
    }
    const t = setTimeout(() => setTimedOut(true), UNREACHABLE_MS);
    return () => clearTimeout(t);
  }, [isLoading]);

  // Stamp the grace on every valid session (authenticated + access).
  useEffect(() => {
    if (isAuthenticated && access?.hasAccess) stampAuth();
  }, [isAuthenticated, access?.hasAccess]);

  const unreachable = !online || timedOut;

  // 1) Offline + recent login (< 7 days) → app usable (degraded mode).
  if (unreachable && !isAuthenticated && offlineGraceValid()) return <>{children}</>;

  // 2) Online, resolution in progress → checking.
  if (isLoading && !unreachable) return <Checking />;

  // 3) Active session.
  if (isAuthenticated) {
    if (access?.hasAccess) return <>{children}</>;
    if (access === undefined) {
      // Access not resolved yet: offline we trust the grace, otherwise we wait.
      if (unreachable && offlineGraceValid()) return <>{children}</>;
      return <Checking />;
    }
    return <NoAccessScreen role={access.role} onSkip={onSkip} />;
  }

  // 4) Offline, grace expired → login required (it will fail offline, with a dedicated message).
  if (unreachable) return <LoginScreen offline onSkip={onSkip} />;

  // 5) Online, no session → login.
  return <LoginScreen onSkip={onSkip} />;
}

// OFFLINE grace: after a successful (online) Discord login the instant is stamped. On later launches
// with NO network the app stays usable as long as that stamp is under 7 days old. Past that, a new
// login is required — which means going back online.
const KEY = "nr.auth.lastAuthAt";
const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export function stampAuth(now: number = Date.now()): void {
  try {
    localStorage.setItem(KEY, String(now));
  } catch {
    /* localStorage unavailable: the offline grace is simply inactive */
  }
}

export function clearAuthStamp(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}

function lastAuthAt(): number | null {
  try {
    const v = localStorage.getItem(KEY);
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// true = a recent login (< 7 days) allows offline use.
export function offlineGraceValid(now: number = Date.now()): boolean {
  const t = lastAuthAt();
  return t !== null && now - t >= 0 && now - t < OFFLINE_GRACE_MS;
}

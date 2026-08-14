// The account is OPTIONAL: NetsuBoard is a standalone board that must open without a network. The
// "skip" choice is persisted so the gate is asked once, not at every launch.
const AUTH_BYPASS_KEY = "nr.auth.skipped";

export function authWasSkipped(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(AUTH_BYPASS_KEY) === "1";
  } catch {
    return false;
  }
}

export function persistAuthSkip(): void {
  try {
    localStorage.setItem(AUTH_BYPASS_KEY, "1");
  } catch {
    /* best-effort */
  }
}

export function clearAuthSkip(): void {
  try {
    localStorage.removeItem(AUTH_BYPASS_KEY);
  } catch {
    /* noop */
  }
}

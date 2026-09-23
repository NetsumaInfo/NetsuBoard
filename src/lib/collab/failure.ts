// Stable codes for collaboration failures, and the sentence each one puts on screen.
//
// The native layer rejects with `{ code, message }` (`src-tauri/src/collab/error.rs`): the message
// is English developer text for the logs, the code is what the screen translates. Failures raised
// in the renderer carry a code the same way, so every surface says the same thing in the interface
// language. `errorText` reads the code; the developer message goes to the app console.

/** `CollabErrorCode` in Rust, serialized in snake_case. */
export type NativeCollabCode =
  | "authorization" | "conflict" | "corrupt" | "key_pending" | "network"
  | "read_only" | "storage" | "unavailable" | "validation";

/** Failures the renderer raises itself. */
export type RendererCollabCode = "sign_in" | "desktop_only" | "server";

export type CollabFailureCode = NativeCollabCode | RendererCollabCode;

const KEYS: Record<CollabFailureCode, string> = {
  authorization: "reference:collab.error.authorization",
  conflict: "reference:collab.error.conflict",
  corrupt: "reference:collab.error.corrupt",
  key_pending: "reference:collab.error.keyPending",
  network: "reference:collab.error.network",
  read_only: "reference:collab.error.readOnly",
  storage: "reference:collab.error.storage",
  unavailable: "reference:collab.error.unavailable",
  validation: "reference:collab.error.validation",
  sign_in: "reference:collab.signedOut",
  desktop_only: "reference:collab.error.desktopOnly",
  server: "reference:collab.error.server",
};

/** An Error whose `message` is for the logs and whose `code` picks the sentence on screen. */
export function collabFailure(code: CollabFailureCode, message: string): Error & { code: CollabFailureCode } {
  return Object.assign(new Error(message), { code });
}

// The Convex client prefixes every error thrown by a server function with this marker, followed by
// the backend's own English text: never something to show as is.
const CONVEX_SERVER_ERROR = /^\[CONVEX [AMQ]\(/;

/** The translation key for a collaboration failure, or null when `error` is not one. */
export function collabFailureKey(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code === "string" && Object.prototype.hasOwnProperty.call(KEYS, code)) {
    return KEYS[code as CollabFailureCode];
  }
  if (typeof message === "string" && CONVEX_SERVER_ERROR.test(message)) return KEYS.server;
  return null;
}

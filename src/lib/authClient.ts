import { createAuthClient } from "better-auth/react";
import {
  convexClient as convexAuthPlugin,
  crossDomainClient,
} from "@convex-dev/better-auth/client/plugins";

// Base = the Convex site (*.convex.site) hosting the Better Auth routes.
const siteUrl = import.meta.env.VITE_CONVEX_SITE_URL as string | undefined;

// crossDomainClient: the desktop webview is not on the Convex domain → the session token travels
// outside a cookie (stored in localStorage under the "netsuboard" prefix, distinct from NetsuRush's
// so the two applications never read each other's session). convexAuthPlugin: binds the Better Auth
// session to the JWT Convex validates.
export const authClient = createAuthClient({
  baseURL: siteUrl ?? "http://localhost",
  plugins: [convexAuthPlugin(), crossDomainClient({ storagePrefix: "netsuboard" })],
});

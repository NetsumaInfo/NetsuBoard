import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import type { AuthConfig } from "convex/server";

// JWT provider Convex reads to validate the `convex_jwt` Better Auth issues.
// issuer/applicationID are derived from CONVEX_SITE_URL (set automatically on the deployment).
export default {
  providers: [getAuthConfigProvider()],
} satisfies AuthConfig;

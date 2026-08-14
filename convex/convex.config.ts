import { defineApp } from "convex/server";
import betterAuth from "@convex-dev/better-auth/convex.config";

// Mounts the Better Auth component (isolated tables: user/session/account/verification).
// Auth lives INSIDE Convex → the Discord secret stays on the deployment, never in the Tauri bundle.
const app = defineApp();
app.use(betterAuth);

export default app;

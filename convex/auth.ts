import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth";
import { components } from "./_generated/api";
import { query } from "./_generated/server";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";

// Public URL of the Convex site (*.convex.site) — base of the Better Auth routes.
const siteUrl = process.env.SITE_URL as string;

// Component client: exposes the DB adapter plus the helpers (getAuthUser, registerRoutes…).
export const authComponent = createClient<DataModel>(components.betterAuth);

// Better Auth instance rebuilt per request (Convex functions carry no headers).
export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: siteUrl,
    database: authComponent.adapter(ctx),
    // Trusted origins (route CSRF + CORS): Convex site, the desktop scheme (deep-link return) and
    // the Tauri webview origins (Vite dev on 1430, tauri.localhost in release).
    // NetsuRush holds 1420 and the `netsurush://` scheme — the two applications must never share
    // either, or a login meant for one would complete in the other.
    trustedOrigins: [
      siteUrl,
      "netsuboard://",
      "http://localhost:1430",
      "http://tauri.localhost",
      "https://tauri.localhost",
      ...(process.env.WEB_ORIGIN ? [process.env.WEB_ORIGIN] : []),
    ],
    // Discord only. Secrets live on the Convex deployment, never in the app.
    socialProviders: {
      discord: {
        clientId: process.env.DISCORD_CLIENT_ID as string,
        clientSecret: process.env.DISCORD_CLIENT_SECRET as string,
        // Explicit authorization screen (otherwise `prompt=none` fails on the first login, the user
        // not being authorized yet).
        prompt: "consent",
      },
    },
    // Session kept 7 days, refreshed on each day of online use (see the renderer's offline grace).
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    // Built-in anti-bruteforce.
    rateLimit: { enabled: true },
    plugins: [
      // crossDomain: the OAuth return carries the token outside a cookie (desktop webview is not on
      // the Convex domain).
      crossDomain({ siteUrl }),
      // convex: issues the JWT Convex validates (issuer = auth.config.ts).
      convex({ authConfig }),
    ],
  });

// Current user (safe = undefined when signed out) — for the UI identity (Discord avatar/name).
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => authComponent.safeGetAuthUser(ctx),
});

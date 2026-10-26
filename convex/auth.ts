import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
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
    // Discord, next to the e-mail code below. Secrets live on the Convex deployment, never in the app.
    socialProviders: {
      discord: {
        clientId: process.env.DISCORD_CLIENT_ID as string,
        clientSecret: process.env.DISCORD_CLIENT_SECRET as string,
        // Explicit authorization screen (otherwise `prompt=none` fails on the first login, the user
        // not being authorized yet).
        prompt: "consent",
      },
    },
    // A Discord login and an e-mail login with the same verified address are one account.
    account: { accountLinking: { enabled: true, trustedProviders: ["discord", "email-otp"] } },
    // Session kept 30 days, refreshed on each day of online use (see the renderer's offline grace).
    session: {
      expiresIn: 60 * 60 * 24 * 30,
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
      // Sign-in by a code sent to the address: no password to store or reset. The first code creates
      // the account.
      emailOTP({
        otpLength: 6,
        expiresIn: 10 * 60,
        allowedAttempts: 5,
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type !== "sign-in") return;
          await sendSignInCode(email, otp);
        },
      }),
    ],
  });

// Resend through its HTTP API: no SDK in the bundle. RESEND_API_KEY and AUTH_EMAIL_FROM (a sender on
// a domain verified at Resend) live on the deployment.
async function sendSignInCode(email: string, otp: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM;
  if (!key || !from) throw new Error("e-mail sign-in is not configured");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Your NetsuBoard sign-in code",
      text: `Your NetsuBoard sign-in code: ${otp}\n\nIt expires in 10 minutes. If you did not ask for it, ignore this e-mail.`,
    }),
  });
  if (!res.ok) throw new Error(`Resend refused the e-mail (${res.status})`);
}

// Current user (safe = undefined when signed out) — for the UI identity (Discord avatar/name).
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => authComponent.safeGetAuthUser(ctx),
});

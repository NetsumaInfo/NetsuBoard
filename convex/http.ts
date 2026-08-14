import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent, createAuth } from "./auth";

// Mounts the Better Auth routes (`/api/auth/*`): social sign-in, OAuth callbacks, session…
// cors:true → OPTIONS preflight handlers plus CORS headers. Required: the desktop webview (origin
// localhost:1430 in dev, tauri.localhost in release) hits the Convex site cross-origin with a custom
// `Better-Auth-Cookie` header → without the preflight the POST fails (net::ERR_FAILED).
const http = httpRouter();
authComponent.registerRoutes(http, createAuth, { cors: true });

// OAuth landing page. Login redirects HERE (HTTPS) instead of straight to the `netsuboard://`
// scheme: the browser shows a real page (no more "loading forever"), which relaunches the app
// through the deep link and then invites closing the tab. The `?ott=<token>` crossDomain appends is
// passed to the scheme untouched.
http.route({
  path: "/auth/done",
  method: "GET",
  handler: httpAction(async (_ctx, req) => {
    const search = new URL(req.url).search; // e.g. ?ott=abc
    const deepLink = `netsuboard://auth${search}`;
    const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>NetsuBoard — connexion</title>
<style>
  :root { color-scheme: dark; }
  html,body { height:100%; margin:0; }
  body { display:flex; align-items:center; justify-content:center;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background:#0b0b0e; color:#e7e7ea; }
  .card { width:min(90vw,360px); padding:2rem; text-align:center;
    background:#141419; border:1px solid #26262e; border-radius:16px; }
  .badge { width:52px; height:52px; margin:0 auto 1rem; border-radius:14px;
    display:flex; align-items:center; justify-content:center;
    background:#5865F2; color:#fff; font-size:26px; }
  h1 { font-size:1.05rem; margin:0 0 .4rem; }
  p { font-size:.85rem; color:#a1a1aa; margin:0 0 1.25rem; line-height:1.5; }
  a { display:inline-block; padding:.55rem 1rem; border-radius:10px;
    background:#5865F2; color:#fff; text-decoration:none; font-size:.85rem; font-weight:600; }
</style>
</head>
<body>
  <div class="card">
    <div class="badge">&#10003;</div>
    <h1>Connexion r&eacute;ussie</h1>
    <p>Tu peux fermer cet onglet et revenir dans NetsuBoard.</p>
    <a href="${deepLink}">Rouvrir NetsuBoard</a>
  </div>
  <script>location.replace(${JSON.stringify(deepLink)});</script>
</body>
</html>`;
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }),
});

// Bug report relay. The application NEVER holds the Discord webhook URL: it POSTs here, and
// `BUG_WEBHOOK` (a deployment env var) stays server-side — rotating it therefore needs neither a
// build nor an update on the testers' machines. The body is forwarded AS IS (the multipart embed
// plus attachments built by the core): nothing to re-parse, nothing to re-cap here.
// Session: the desktop app has no cookies (webview outside the Convex domain), it sends the
// crossDomain plugin's `Better-Auth-Cookie` header, which `getSession` knows how to read. It is
// OPTIONAL: a bug must be able to surface while signed out (it is often the connection itself that
// broke). Without an account the hourly cap falls back to the calling IP, which serves as the quota
// key and is NOT stored with the report.
// Quota key of an anonymous send: a SALTED fingerprint of the calling IP. Salted and truncated
// because the point is to count, not to identify — the raw IP must neither reach the database nor be
// reconstructible from it. With no IP header, all anonymous senders share one counter.
async function anonQuotaKey(req: Request): Promise<string> {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
  const salt = process.env.BUG_QUOTA_SALT ?? process.env.BETTER_AUTH_SECRET ?? "netsuboard";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));
  const hex = Array.from(new Uint8Array(digest.slice(0, 8)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `ip:${hex}`;
}

http.route({
  path: "/bug/report",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const webhook = process.env.BUG_WEBHOOK;
    if (!webhook) return new Response("relay disabled", { status: 503 });

    const session = await createAuth(ctx)
      .api.getSession({ headers: req.headers })
      .catch(() => null);
    const userId = session?.user?.id;
    const quotaKey = userId ?? (await anonQuotaKey(req));

    const quota = await ctx.runQuery(internal.bugs.recentCount, { quotaKey });
    if (!quota.allowed) return new Response("rate limited", { status: 429 });

    const contentType = req.headers.get("content-type");
    const discord = await fetch(webhook, {
      method: "POST",
      headers: contentType ? { "content-type": contentType } : {},
      body: await req.arrayBuffer(),
    });
    if (!discord.ok) {
      const detail = await discord.text().catch(() => "");
      return new Response(`discord ${discord.status} ${detail.slice(0, 200)}`, { status: 502 });
    }

    // Metadata travels in HEADERS: the body is an opaque multipart we do not want to open here.
    const meta = (name: string) => req.headers.get(name) ?? undefined;
    await ctx.runMutation(internal.bugs.record, {
      reportId: meta("x-nr-report-id") ?? "NB-?",
      userId,
      userName: session?.user?.name,
      quotaKey,
      severity: meta("x-nr-severity"),
      category: meta("x-nr-category"),
      module: meta("x-nr-module"),
      appVersion: meta("x-nr-app-version"),
    });
    return new Response(null, { status: 204 });
  }),
});

export default http;

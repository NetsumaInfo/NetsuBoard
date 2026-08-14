# Convex, Discord sign-in and the bug relay — provisioning

Everything here is **optional**. With no `.env.local`, NetsuBoard boots straight to the board: no sign-in screen, and bug reports fall back to the direct webhook or to a local file. Follow this only to turn the account and the relay on.

Design rules this setup exists to keep:

- **No secret ever ships in the application.** The Discord client secret and the Discord webhook live on the Convex deployment. Only two public URLs are baked into the renderer.
- **NetsuBoard and NetsuRush share nothing.** Different Convex project, different Discord application, different scheme (`netsuboard://` vs `netsurush://`), different storage prefix. Sharing any of them means a login started in one app can complete in the other.

## 0. Check `.env.local` first — this repository shipped with the wrong one

> `.env.local` is **git-ignored**, so it does not show up in `git status` and it is not part of any diff. NetsuBoard was copied out of NetsuRush **with that file**, still pointing at `dev:usable-hummingbird-46` (project `netsurush`).
>
> Running `npx convex dev` in that state does not fail: it pushes NetsuBoard's schema onto **NetsuRush's** deployment and drops the indexes of every table this repository does not declare (`waitlist`, `ideas`, `ideaVotes`). Documents survive, indexes and functions do not. That happened once, on NetsuRush's dev deployment; it was repaired by running `npx convex dev --once` from the NetsuRush folder, which re-pushes its own schema.
>
> `CONVEX_DEPLOYMENT` must be **empty** until step 1 has created the netsuboard project. `run.bat` now refuses to start Convex against a deployment that is not this project's — use it rather than calling the CLI blind.

## 1. Create the Convex project

Through the launcher (entry `[2] Convex backend`, or `run.bat --convex`), which runs the guard first:

```bash
run.bat --convex
```

Or directly, once `.env.local` is known to be clean:

```bash
npx convex dev
```

Pick **create a new project** and name it `netsuboard` — do not reuse NetsuRush's. The command prints the two URLs, writes `CONVEX_DEPLOYMENT` into `.env.local`, generates `convex/_generated/`, and stays running to push `convex/` on every change.

## 2. Discord application

On the [Discord developer portal](https://discord.com/developers/applications), create an application, then under **OAuth2**:

- copy the **Client ID** and **Client Secret**;
- add exactly this redirect:

```
https://<deployment>.convex.site/api/auth/callback/discord
```

## 3. Deployment environment variables

Run these yourself — the values are secrets and must not pass through anything else.

```bash
npx convex env set SITE_URL "https://<deployment>.convex.site"
npx convex env set BETTER_AUTH_SECRET "<32+ random bytes, base64>"
npx convex env set DISCORD_CLIENT_ID "<client id>"
npx convex env set DISCORD_CLIENT_SECRET "<client secret>"
npx convex env set OPEN_BETA "true"
npx convex env set BUG_WEBHOOK "<Discord webhook URL>"
```

| Variable | Role | Missing → |
|---|---|---|
| `SITE_URL` | Base of the Better Auth routes | Sign-in broken |
| `BETTER_AUTH_SECRET` | Signs sessions and JWTs | Sign-in broken |
| `DISCORD_CLIENT_ID` / `_SECRET` | OAuth application | Sign-in broken |
| `OPEN_BETA` | `true` = every signed-in account gets in | Allowlist mode (see below) |
| `BUG_WEBHOOK` | Discord channel the relay forwards to | Relay answers `503`, the app falls back |
| `BUG_QUOTA_SALT` | Optional; salts the anonymous quota fingerprint | Falls back to `BETTER_AUTH_SECRET` |
| `WEB_ORIGIN` | Optional; extra trusted origin | Nothing else is trusted |

**Allowlist mode.** `npx convex env set OPEN_BETA false`, then grant per account:

```bash
npx convex run access:grantAccess '{"userId":"<better auth id>","role":"member"}'
```

## 4. Renderer variables

`.env.local` already exists (see step 0). Fill in the two public URLs (`npx convex dev` prints them, and writes `CONVEX_DEPLOYMENT` itself); `.env.example` is the reference for the shape:

```
VITE_CONVEX_URL=https://<deployment>.convex.cloud
VITE_CONVEX_SITE_URL=https://<deployment>.convex.site
```

They are **baked at build time**. Changing a deployment means rebuilding the installer — which is exactly why the webhook is *not* one of them.

## 5. Everyday use

`run.bat` entry `[1] Start NetsuBoard` starts the Convex watcher on its own (in a `NetsuBoard - Convex` window) when a deployment is configured, skips it when there is none, and **stops before Vite** when the deployment is not this project's. Entry `[2]` starts or creates it on its own.

## 6. Ship

```bash
npx convex deploy
```

Then build the installer. The `netsuboard://` scheme is registered by the NSIS installer in release; in dev the Rust shell registers it at startup (`register_all()` in `src-tauri/src/lib.rs`).

## What the sign-in flow actually does

1. `useDiscordLogin` asks Better Auth for the authorization URL and opens it in the **system browser** (never the webview — the app is never left).
2. Discord → `…convex.site/api/auth/callback/discord` → the HTTPS page `/auth/done`.
3. That page redirects to `netsuboard://auth?ott=<one-time token>`. On Windows, with the app already running, the second process hands the URL to the first through `single-instance`, which re-emits it as the `nb-deep-link` event.
4. `src/lib/deepLink.ts` trades the token for a session, stamps the offline grace, and `useConvexAuth` flips the gate.

If the custom scheme is ever blocked on a machine, the fallback is a loopback callback (`http://127.0.0.1:<port>`) — not implemented, but nothing in the flow prevents it.

## Free-plan quotas — what actually runs out

Convex quotas are counted **per team**, not per project: every project on the account shares one pool. For this workload the function-call budget (1 M/month) is unreachable; the ceiling that matters is **egress, 1 GB/month**, because bug reports carry logs and screenshots. At ~2 MB per report that is roughly 500 reports a month.

The Free plan is a **hard cap** — past it, writes fail. If reports must never be silently lost, use the Starter plan, where the same allowance continues pay-as-you-go (~$0.13 per extra GB of egress).

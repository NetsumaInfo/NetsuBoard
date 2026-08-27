# Convex, Discord sign-in and the bug relay — provisioning

Everything here is **optional for a solo board and required for collaboration**. With no `.env.local`,
NetsuBoard boots straight to a local board: no sign-in, invitations, shared recovery, or activity inbox;
bug reports fall back to the direct webhook or a local file.

Design rules this setup exists to keep:

- **No secret ever ships in the application.** The Discord client secret and the Discord webhook live on the Convex deployment. Only two public URLs are baked into the renderer.
- **NetsuBoard and NetsuRush share nothing.** Different Convex project, different Discord application, different scheme (`netsuboard://` vs `netsurush://`), different storage prefix. Sharing any of them means a login started in one app can complete in the other.
- **Convex receives encrypted recovery, not original media.** Membership, device proofs, wrapped keys,
  heads, checkpoints, and consolidated notices are expected. Plaintext board state, local paths, and
  image/video originals are not.

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

`src-tauri/build.rs` embeds the exact `VITE_CONVEX_URL` origin into the native binary from the build
environment or `.env.local`/`.env.production`. Rust refuses a different runtime hint, so changing the
deployment requires rebuilding the application. When no URL is embedded, only a loopback Convex
deployment is accepted by debug builds; release collaboration stays disabled instead of trusting a
renderer-supplied host.

They are **baked at build time**. Changing a deployment means rebuilding the installer — which is exactly why the webhook is *not* one of them.

## 5. Everyday use

`run.bat` entry `[1] Start NetsuBoard` starts the Convex watcher on its own (in a `NetsuBoard - Convex` window) when a deployment is configured, skips it when there is none, and **stops before Vite** when the deployment is not this project's. Entry `[2]` starts or creates it on its own.

## 6. Ship

```bash
npx convex deploy
```

Then build the installer. The `netsuboard://` scheme is registered by the NSIS installer in release; in dev the Rust shell registers it at startup (`register_all()` in `src-tauri/src/lib.rs`).

Before shipping a collaboration schema change, verify that production contains the indexes in
`convex/schema.ts`, especially project membership, device, head, upload-reservation, inbox, invitation
expiry, and media-request expiry indexes. Run `npx convex deploy` before distributing a renderer/native
build that calls new functions. A new client against an old deployment fails closed but cannot recover
or publish shared work.

## What the sign-in flow actually does

1. `useDiscordLogin` asks Better Auth for the authorization URL and opens it in the **system browser** (never the webview — the app is never left).
2. Discord → `…convex.site/api/auth/callback/discord` → the HTTPS page `/auth/done`.
3. That page redirects to `netsuboard://auth?ott=<one-time token>`. On Windows, with the app already running, the second process hands the URL to the first through `single-instance`, which re-emits it as the `nb-deep-link` event.
4. `src/lib/deepLink.ts` trades the token for a session, stamps the offline grace, and `useConvexAuth` flips the gate.

If the custom scheme is ever blocked on a machine, the fallback is a loopback callback (`http://127.0.0.1:<port>`) — not implemented, but nothing in the flow prevents it.

## Free-plan quotas and operational checks

Convex measures resource usage **per team**, not per project. As of August 2026, its published Free
limits include 1,000,000 function calls/month, 0.5 GiB database storage, 1 GiB database I/O/month,
1 GiB file storage, and 1 GiB data egress/month. Check the current official pricing and limits before
release; these values are not an application contract.

Collaboration is shaped to keep the free tier viable:

- live edits and original media use iroh, not Convex;
- one head/device, one checkpoint/project, one inbox row/recipient/project, and one media-request
  row/requester/project bound row counts;
- publication is debounced, transient retries back off, normal publication uses one roster query,
  and P2P roster checks are cached for thirty seconds;
- encrypted payloads move to file storage only above the inline threshold, and retained uploads carry
  an authenticated ownership receipt;
- lists and account/project/member/device counts are indexed and bounded.

The remaining quota drivers are encrypted recovery payload downloads, database I/O from roster and
recovery reads, and bug-report attachments. Original board videos must never appear in Convex storage.
On Free, sustained limit overruns may make function calls fail. This is why a locally acknowledged edit
stays in SQLite and the exact encrypted outbox until Convex confirms it.

During beta, inspect the dashboard after every multi-device test:

1. function calls and database I/O per active editing hour;
2. checkpoint/head file bytes and file-download egress;
3. one current head per proved device, no retained `projectPayloadUploads` rows, and at most 200
   `projectAuditEvents` rows per project;
4. one inbox row per recipient/project and coalesced media requests;
5. storage growth after project deletion, member removal, and failed upload tests.

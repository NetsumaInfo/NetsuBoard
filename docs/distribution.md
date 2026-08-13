# Distribution, setup and accounts

## Packaging — standalone Windows installer

`npm run package` (= `scripts/build.ps1`) produces an NSIS installer under `src-tauri/target/release/bundle/nsis/`. Chain: check the core and the locales → build the renderer → fetch a portable `node.exe` and the mpv runtime → stage `core/`, `scripts/`, the shaders and `dist/` into `src-tauri/resources/` → `tauri build`.

**Mandatory rule for every runtime dependency.** Adding a Node package, a binary, a DLL, a script or an asset must, **in the same change**, update: (1) the relevant manifest, (2) the staging in `scripts/build.ps1`, (3) the idempotent install/repair path in `scripts/setup.ps1`, (4) the post-install check that actually runs the dependency inside the packaged runtime (`core/setup.js`), and (5) `test/packaging.test.cjs`. A successful check in dev never proves the installer is complete: before publishing, build the installer, audit `src-tauri/resources/`, and validate the runtime from a clean or repaired install.

- **No `python/` is staged.** NetsuBoard embeds no ML sidecar; its runtime is ffmpeg, the shaders and `yt-dlp`. `src-tauri/resources/python/` still exists in the tree as NetsuRush residue and is not part of the product.
- **The core is bundled as a resource**, not as an `externalBin`: `bundle.resources: ["resources/**/*"]` with an anchor file so the glob also matches in dev. In release, the Rust shell launches `resources/bin/node.exe` on `resources/core/server.js` with paths resolved through `app.path().resource_dir()`. The spawn lives in `.setup()` (the handle is needed for `resource_dir`), the child is kept in managed state and killed on exit. Dev is unchanged (Node from `PATH`, code from the repo).
- **PowerShell files are written with a BOM.** The Windows PowerShell the core spawns reads a BOM-less `.ps1` as cp1252, which turns every accent into mojibake.
- **Writable home** = `%LOCALAPPDATA%\NetsuBoard`, overridable with `NR_HOME`. `loadConfig()` reads `NR_HOME/nr.config.json` first, then the legacy in-repo file. The NSIS installer is `installMode: currentUser` (no admin), so the code is installed read-only and the config plus the provisioned runtime live in the home folder, outside the install.

## First-run setup

`SetupGate` wraps the shell (not the detached window). At boot the renderer calls `setup:status`; if the runtime is incomplete it shows the install screen, and `setup:run` launches `scripts/setup.ps1`. Progress is streamed over SSE with `STAGE:`/`PROGRESS:`/`ERROR:` markers, and the config file is written at the end. **A restart is required afterwards**, since the config is read when the core starts. The browser mock always reports ready, so the gate never appears outside the app. `setup.ps1` is idempotent.

The runtime has **three** items, and **all three gate readiness**:

1. **ffmpeg + ffprobe** — decoding, thumbnails, frame extraction, and the `libplacebo` filter the upscaler runs on. The archive is a **release asset of the NetsuRush repository**, pinned by version and SHA-256 and served by GitHub's CDN; it is produced from an upstream build by [`scripts/ffmpeg-mirror.ps1`](../scripts/ffmpeg-mirror.ps1). The fallback is a BtbN zip, also on GitHub — no source outside a CDN, and no external extractor.
2. **The GLSL shaders** (ArtCNN, Anime4K) — a few hundred kilobytes of text, staged from `resources/vendor/shaders` or fetched by `scripts/fetch-shaders.ps1`.
3. **`yt-dlp.exe`** — standalone, carrying its own interpreter, so online links resolve with no Python environment. **Mandatory** since `setupRuntimeVersion` 5: online links are half of what lands on a reference board, and while it was best effort a skipped download produced an install that looked complete and failed months later on a bare `spawn yt-dlp.exe ENOENT`. Installs provisioned before the bump carry no `ytDlp` path and are sent back through the installer.

`probeRuntime` **looks at files**; it launches nothing. NetsuRush started Python and imported torch here — there is no interpreter to start any more. `quickSetupReady` short-circuits the full probe for an install that already carries `setupCompletedAt` and a matching `setupRuntimeVersion`, and it checks the **ffmpeg version** itself: putting that check only in `ffmpegReady` made it unreachable for exactly the installs a version bump must catch.

**First run is one screen.** Language is its first step (a grid of autonyms plus flags; clicking picks and advances), not a screen in front of it — there is **no separate language gate**, and reintroducing one would put a question before the one that matters. Without an explicit choice, i18n follows the system locale.

## Updates

The updater reads `latest.json` from the latest GitHub release; archives are signed and an unsigned release is refused. See [`releasing.md`](releasing.md).

- **The percentage is exact**: the store publishes the raw `downloaded / contentLength` float with no rounding and no artificial 99 % ceiling, and the UI renders it to one decimal — an integer percentage sits still for seconds on a large installer and then jumps. Progress events are coalesced to one store write per 80 ms so the title bar does not re-render per HTTP chunk.

## Authentication — none

NetsuBoard has **no account and no sign-in**. The Convex + Better Auth + Discord backend of NetsuRush was **not** copied: there is no `convex/` directory, no `src/lib/convexEnv.ts`, and no auth provider anywhere in the renderer. `src/components/auth/GateFrame.tsx` survives only as the layout wrapper `SetupGate` reuses; it authenticates nothing.

Two things to keep in mind before "restoring" anything:

- **Do not reintroduce a static import** of `convex/react` or `better-auth` from an entry point. In NetsuRush they landed in the entry chunk of every renderer, and making the three accesses dynamic cut ~140 KB raw / 48 KB gzipped from startup parsing.
- The OAuth flow relied on the `netsurush://` deep link, and `src-tauri/src/lib.rs` **no longer registers a deep-link handler** — the shell keeps `single-instance` only. Legacy provisioning notes: `legacy-netsurush/auth-setup.md`.

## Bug report relay (`core/bugreport.js`)

Reports reach a Discord channel. Two paths exist in the core; **only the direct one works here.**

- **Direct webhook** — `NR_BUG_WEBHOOK` (env) or `bugWebhook` (`nr.config.json`) posts straight to Discord. It is the only configured path in NetsuBoard, and `bug:status` reports whether it exists. Note that `scripts/setup.ps1` **rewrites `nr.config.json` wholesale**, so a hand-added `bugWebhook` does not survive a repair.
- **Convex relay** — the core still accepts a relay site from the renderer (`VITE_CONVEX_SITE_URL`, baked at build) and **validates it against `https://<name>.convex.site`**, because without that check a tampered renderer could redirect reports — logs and screenshots included — to any host. Nothing in NetsuBoard sets that variable, so the path is dead code today. If it is revived, remember that a Convex HTTP action caps the request at 20 MB where Discord allows 8 x 10 MB: the relay drops the attachments that do not fit **before** sending and says so in the embed, rather than losing the whole report to a rejection.

The report's content rules (taxonomy, redaction, attachment limits, the always-available local download) are invariants — see [`invariants.md`](invariants.md#console-log-and-bug-report).

## Discord Rich Presence (`core/discordRpc.js`)

Shows activity on the user's Discord profile. **Not verified in CI** (needs Discord running).

- **Hand-written IPC client, zero dependency.** The official `discord-rpc` repo is **deprecated C++** — a protocol reference only, never vendored. Pipes `\\?\pipe\discord-ipc-0..9` are probed 0→9 (Stable/PTB/Canary). A frame is `[op u32 LE][len u32 LE][json]` written in **one single `write`** — two writes interleave header and body and break the pipe. Op 0 is the handshake; **op 3 PING must be answered with op 4 PONG carrying the exact nonce**, or Discord disconnects. Partial frames are reassembled through a buffer.
- **`SET_ACTIVITY` is capped at 1 per 15 s and an overflow is dropped SILENTLY** (no error, no close), hence a throttle in the core that replays the **last** state. Sending must **disarm the in-flight timer**: its deadline came from an earlier send, so letting it live fires inside the window and the presence freezes (real bug). `pid` is mandatory, `activity:null` clears, `timestamps.start` is in **seconds**, and `details`/`state` must be 2..128 characters (omitted below 2 — an empty string is rejected).
- The application id is **public** (the OAuth client secret never leaves the server environment). Resolution order: config → environment variable → built-in default. Empty means an inert card.
- **Settings are persisted BY THE CORE** (`NR_HOME/discord-rpc.json`) as the single source of truth; the renderer reads them at mount and listens for a change event, falling back to `localStorage` only in the browser mock. Inputs are sanitised at **both** boundaries (disk and RPC): a `null` template caused a `.trim()` inside a timer callback, which **crashed the core**.
- **Connection**: a `probing` guard (the socket stays null during the probe, otherwise toggling twice opens two sockets), a teardown that **checks identity** (an orphan socket must not kill the live connection), a re-read of the enabled flag inside the connect callback (the probe is async), a 10 s handshake timeout, and a 1 s→30 s backoff **only while enabled**. Discord being absent is the nominal case: total silence.
- **The preview is the real render**: the core exposes the activity it would send, plus the application name and icon resolved from public endpoints **without a token**, fetched **core-side** (no CORS, once per session). Do not reimplement the render in the renderer — the clamps and omissions would diverge.
- `setPrefs` must **never** force a send: typing in a text field fires it per character, so forcing would drown Discord in dropped frames and the **final** text would be the one lost. The bypass is reserved for a fresh connection.
- The presence hook is mounted **once**, in the shell: the detached board shares the same renderer and would push a competing context.
- Content is opt-in per field: project name (**off by default**, privacy), elapsed time, custom templates. The core is stopped on `SIGINT`/`SIGTERM`.

# Invariants

Rules that break correctness when violated. Each one already fixed a real bug. Locked by tests where a test can express them.

## Board geometry and media identity

- **Geometry is in WORLD coordinates**, displayed through a `transform: translate()/scale()` layer. `referenceShared.ts` holds the `BoardItem` model and its helpers.
- **`ref` is persisted, `src` is not.** `ref` is the locator that survives (disk path, remote URL, YouTube id); `src` is the display URL **recomputed on load** by `displaySrc`. An objectURL or blob does not survive a reload — persisting one produces an item that is permanently broken after restart.
- **During a gesture the geometry lives in LOCAL state**, coalesced in rAF, so only the manipulated item re-renders; commit to the store on `pointerup`. `BoardItem` is `memo`, so panning does not re-render items.
- **Gestures are native pointer events** (`usePointerTransform.ts`), never a drag library.

## Local video playback

- **`<video>` in WebView2 does not read `.mkv`.** Route mp4/mov/webm to `/media` (Range, seek and loop all work), everything else to `/stream` (remux, stream-copy when the codec is already native).
- **A local cut is played as a PROXY, not the raw file.** A trimmed range of a local file — often `.mkv`/HEVC — showed the **start of the file**, because mid-file seeking fails over a stream copy. That reads as "the wrong media". Such items play an mp4 proxy of the exact range (whole loop, no seek), regenerated on each mount from the server cache, so nothing temporary is persisted.
- **YouTube plays through a plain `<video>`, not the embedded player.** The embedded player repaints its chrome on every seek and pause, which flashed on each loop; no `playerVars` removes it. `core/ytstream.js` resolves the stream with `yt-dlp` and relays it on `/ytstream?id=`, so the board reads it like any local video. The relay renews the URL itself on a 403 (YouTube URLs expire), which is what keeps `/ytstream?id=` a stable, persistable source.
- **The relayed format is capped**: `protocol^=https`, `avc1` preferred, 1080p maximum. WebView2 has no native HLS, so a manifest-only format is a dead `<video>`; a 4K VP9/AV1 stream falls back to software decoding, likewise dead. The same cap applies to downloads (`core/extract.js`). Locked by `test/ytstream.test.cjs`.
- **Never reach inside the YouTube iframe** the way AnimRef does (`contentDocument`, `--disable-site-isolation-trials`): those flags are process-wide, and `/media` + `/stream` serve arbitrary disk files relying on the browser's same-origin refusal.

## Video preview = short HEVC proxy, hardware encoded

Tauri's **WebView2 decodes HEVC** through `<video>` — verified `canPlayType('video/mp4;codecs="hvc1…"')` = `"probably"`, with `--enable-features=PlatformHEVCDecoderSupport` set in `src-tauri/src/lib.rs` before the webview is created. Raw h264/`.mp4` sources do not always play, so a short proxy is transcoded anyway.

`ffmpeg:proxy` transcodes a **short segment** (≤10s, looping) to **8-bit HEVC `.mp4`**, height snapped to a cell-size step (capped at 520p, low quality accepted for a fast encode).

### No encoder is hard-coded — read this before assuming a vendor

**HEVC is hardware-encoded on all three vendors.** `core/proxyEncoder.js#selectProxyEncoder` is a pure function (testable without ffmpeg) that picks, in order:

| Step | Encoder | Note |
|---|---|---|
| 1 | `hevc_nvenc` · `hevc_amf` · `hevc_qsv` | whichever **passed the probe** on this machine |
| 2 | `h264_nvenc` · `h264_amf` · `h264_qsv` | a player that accepts HEVC accepts H.264, so hardware beats format fidelity |
| 3 | `libx264` | universal CPU fallback |

**Falling to step 2 is never about the brand** — it means no HEVC encoder passed the probe on that machine (old GPU, driver refusal, ffmpeg build). An AMD or Intel machine whose HEVC encoder works stays on step 1, exactly like an NVIDIA one.

**Listing an encoder is not being able to use it.** A Windows ffmpeg build advertises `h264_qsv` and `h264_amf` even with no Intel or AMD GPU present, so `core/export/capabilities.js` probes in **two passes**: is the encoder alive at all (`canEncode(['-c:v', enc])`), then does it work **with the real profile and pixel format** (`hevc_nvenc` can be alive yet unable to do 10-bit, so `h265_main10` degrades to CPU instead of failing at export time).

**`libx265` is only ever used on an explicit CPU request, never automatically**: it is too slow for hover-to-play, and its HEVC may not decode in the packaged WebView2. `selectFastProxyEncoder` short-circuits the full probe for the first double-click (an optimistic guess from the GPU vendor list) — the encode is still protected by the CPU fallback if the driver refuses.

**The only genuinely NVIDIA-specific profiles** are `h264_high444`, `h265_rext444_8` and `h265_rext444_10`, flagged `nvencOnly` in the capability probe because no other vendor encodes HEVC RExt 4:4:4. They are not probed on AMF or QSV and go to the CPU there.

### Encoding arguments

- Short segment, NVENC: `-preset p1 -tune ull -rc-lookahead 0` (fastest cold start). AMF and QSV have their own equivalents in `proxyVideoArgs`; the CPU path uses `-preset ultrafast -tune zerolatency`.
- Full preview: `-preset p2 -cq 30 -b:v 0 -pix_fmt yuv420p -tag:v hvc1` + AAC, `-movflags +faststart`.
- **`-tag:v hvc1` is mandatory**, otherwise `<video>` refuses the file.
- **`-pix_fmt yuv420p` forces 8-bit** (anime sources are often 10-bit).
- Cached under `os.tmpdir()`, written as `.tmp` then **atomically renamed**; **`-f mp4` is mandatory** because the `.tmp` extension stops ffmpeg from guessing the muxer.
- Served over HTTP `/media`.

**GPU/CPU division of labour**: hardware encodes the proxies, the CPU stays reserved for thumbnails (still images) and light decoding as much as possible. Priority queue `proxyGate` (hover/click `high` > prewarm `low`), `PROXY_MAX=5` — sized on the ~8 parallel NVENC sessions measured on the reference machine, so it is a conservative bound elsewhere rather than a vendor assumption; thumbnails use `thumbGate` (`THUMB_MAX≈cores/2`, disk cache).

## Turbo upscaling — shaders only

`core/shaderUpscale.js` runs the ffmpeg `libplacebo` filter (Vulkan): one ffmpeg command per job, progress over `-progress pipe`. **No Python, no neural runtime, no weights.**

- Shader ids map either to a custom `.glsl` file (`custom_shader_path`) or to a built-in libplacebo scaler. Animation uses the ArtCNN and Anime4K GLSL networks; live action uses `lanczossharp`.
- The ArtCNN suffixes are **distinct weights, not a post-filter**: `_DS` doubles while denoising and sharpening, `_DN` doubles while denoising and softening. They do not combine with the neutral variant of the same network.
- `libplacebo` handles colour management itself — do **not** reintroduce the swscale workaround an AI path would need.
- The shaders come from the provisioned runtime (`NR_HOME/runtime/shaders`, staged from `resources/shaders` in release). Missing shaders make the upscaler unusable and `setupStatus` reports the install as not ready.
- **Never a `master` ffmpeg build**: its libplacebo/Vulkan sometimes fails to initialise, which breaks Turbo upscaling outright.

## Thumbnails — ONE cache for the whole app

`core/thumbs.js` is the single source, addressed by `(file, timestamp, preset)`. The timestamp is **always** `thumbTime(in, out)` (`src/lib/utils.ts`), so every consumer targets the same entry and therefore the same file on disk. Aiming at a different point on one side alone doubles every thumbnail.

Re-mounting an item without a flash relies on `lib/thumbCache.ts` serving the thumbnail synchronously, plus a proxy cache keyed by segment id.

## ffmpeg

- Cutting/extracting is **lossless**: `-c copy -avoid_negative_ts make_zero`. Never re-encode.
- `probe` returns duration and dimensions **only**. The full keyframe scan (`-skip_frame nokey`) was too slow on long files and was removed. Do not add it back.
- `ffprobe` keyframes, when needed: `pts_time` + `pict_type==I` (not the deprecated `pkt_pts_time`).
- **The version is PINNED** — `$FfmpegVersion` in `scripts/setup.ps1` is the single source, and the download URL carries it. The `ffmpeg-release-full.7z` alias is **forbidden**: it is a moving target that jumped a major version without a single repo change.
- `$FfmpegAccepted` (PowerShell) and `FFMPEG_ACCEPTED_VERSIONS` (`core/setup.js`) declare the **same** versions, equality locked by `test/packaging.test.cjs`: PowerShell provisions, Node checks at startup, and two diverging lists would loop the user back to the install screen forever.
- **An existing install is RE-READ, not assumed valid**: `ffmpegReady` compares the binary's reported version against the accepted list. `Test-Path` alone kept a legacy build forever. The setup therefore **replaces** a binary in place (Windows refuses to overwrite a running `.exe` but allows renaming it).
- **The version check lives in `quickSetupReady`, not only in `ffmpegReady`**: `setupStatus` reads `quickReady ? true : ffmpegReady(...)`, so an install carrying `setupCompletedAt` short-circuits the check. Putting it only in `ffmpegReady` made it unreachable for exactly the population a version bump must catch. To keep that startup path process-free, `setup.ps1` writes `ffmpegVersion` into the config and the check compares strings.
- **One ffmpeg invocation per probe**: read encoders from **stdout** and the version from **stderr** (the banner), so without `-hide_banner`. Both languages **parse then compare** — a regex on one side and a value comparison on the other diverge on edge cases.
- **Extraction: bsdtar first** (`System32\tar.exe`, shipped with Windows 10 1803+, reads 7z through libarchive), 7-Zip second — probed in `%ProgramFiles%` too, not just on `PATH`.
- **NVENC: modern API only** (`-preset p1..p7` + `-tune ull|hq`). ffmpeg 9.0 **removed** the deprecated presets (`llhq`, `llhp`, `bd`) and the `vbr_hq`/`cbr_hq` modes; reintroducing them breaks all hardware encoding. Locked by `test/packaging.test.cjs`.
- **The native player's ffmpeg is a different ffmpeg**: the `avcodec-*.dll` files next to libmpv follow mpv's release cadence, not this pin. `scripts/fetch-mpv.ps1` checks them **by pattern**; pinning a specific soname declared the runtime incomplete as soon as a newer mpv build arrived.

## `.netsu` projects

Full notes in `docs/modules.md`. The rules that break data if violated:

- **`page_size=8192` is set BEFORE the first write**, WAL on, `synchronous=NORMAL`, `rev` incremented per transaction. `seal(dest)` is checkpoint + `VACUUM INTO` — **never** `VACUUM` on the open database.
- **Export writes a `.part` inside the target folder then renames** (atomic on the same volume), so a half-written `.netsu` never exists.
- **The type is decided by the first bytes** (`SQLite format 3\0` vs `PK\x03\x04`), never by the extension: v1 ZIP archives already shared stay importable through the read-only legacy path.
- **A board bound to a file leaves the internal library** (`sceneId: null`). Two copies of one board would diverge.
- **Saving writes only what changed**: a thousand-item board with one moved item writes one `UPDATE`, and a save with no change writes zero rows. Locked by test.
- **A project only references rushes — no re-encoding on save.** The share path re-encodes per medium; doing that on a project save would cost tens of seconds every time.
- **Session registry keys on the resolved lowercase path**: two spellings of the same file on Windows would open two databases over one file.
- **On shutdown, open projects are closed** (`rpc.closeProjects`). Without that WAL checkpoint a `-wal` file stays next to every project and the next open replays a journal.

## Preferences shared across origins

`core/prefs.js` + `src/hooks/useSharedPrefs.ts`, tested by `test/shared-prefs.test.cjs`. `localStorage` is **per origin** — the Tauri window and the detached board window each had their own copy, so a setting changed in one did not exist in the other.

The core therefore owns a key→value bag (`NR_HOME/prefs.json`, atomic write, SSE `prefs:changed` broadcasting the **patch**) and the renderer mirrors **work** settings into it. **Window** settings (pinning, geometry) stay local. Loop guard: an `applying` flag plus a JSON comparison of the last push.

## Console log and bug report

Two sources merged into a renderer ring buffer: the UI, via `src/lib/appConsole.ts` patching `console.*`; and the core service, via `core/logbus.js` (ring of 800, console patch, `STAGE:/PROGRESS:/PHASE:` markers excluded) broadcast over SSE `console:log`. Tested by `test/bug-report.test.cjs`.

Log-quality rules, each fixing a silent information loss:

1. **Repetitions are counted, not stacked** (core and renderer, 15s window): a failing loop no longer evicts the useful history. The core re-broadcasts the **same** entry when its counter moves, and the renderer updates it in place.
2. **`unhandledRejection` / `uncaughtException` of the core are logged**, with the exit delayed by 150 ms on an uncaught exception so the SSE message gets out. An `Error` passed to `console.error` is formatted as `name: message + stack` — `JSON.stringify(Error)` produced `{}`.
3. **Resource load failures are captured in the capture phase** (`appConsole.captureResourceErrors`): the `error` event of an `<img>/<video>` does not bubble and reaches neither `console.error` nor `window.onerror`. `MediaError` codes are translated (network vs decode) — "the preview stays black" used to happen without a single log line.

Bug report (`components/settings/console/` → `bug:report` → `core/bugreport.js`): a sorted Discord embed plus attachments (log `.txt`, machine snapshot, screenshots). The webhook is configured **outside** the repo (`bugWebhook` in `NR_HOME/nr.config.json`, or `NR_BUG_WEBHOOK`); `bug:status` reports whether it exists. Discord's limits are enforced **before** sending (an overflow returns 400 = report lost without the tester knowing), hence `buildEmbed` being exported and tested.

- **Nothing the machine already knows is asked of the user**: `core/bugContext.js` reads GPU and driver, CPU, RAM, VRAM, OS, ffmpeg encoders, free disk, setup state. Probes are bounded (6s) so a slow measurement returns `null` instead of holding the form. Context is **re-collected at send time by the core**, never taken from the request. When the read fails (service down, not restarted after a `core/` change), the card opens a **manual** field.
- **Ids are stable slugs** (they travel to Discord); labels live in the locales.
- **Voice: plain words, informal register.** Labels stay **short** because segmented choices share the width. No explanatory copy, no "(optional)" suffixes.
- **Redaction before sending** (`redact`): paths reduced to the file name, `/Users|home/<x>`, e-mails, webhooks and tokens.
- **Attachments**: cumulative adding (a bare `<input file>` replaced the selection on every open), drag-and-drop, **Ctrl+V paste**, removal by thumbnail. **Limits come from the service** (`bug:status` → `maxAttachments`/`maxAttachmentMB`), not from renderer constants. `input.value` is cleared after each pick, otherwise re-picking the **same** file fires no event.
- **A "Download" button** always writes the full report locally, even when sending fails — without it, everything the tester just wrote is lost exactly when the app is misbehaving.

## Known violations left by the NetsuRush split

These are **defects**, documented so they are not mistaken for design. Each needs a code change.

- `core/config.js` still names its temporary directories `netsurush-session` and `netsurush-proxies`, and `core/server.js` calls `sessionCache.resetSync()` at startup. With both applications installed, starting one **purges the other's session cache**.
- `src-tauri/src/lib.rs` sweeps for a free core port from **8730**, the NetsuRush range, while `core/server.js` sweeps from 8760 when run alone.
- `src-tauri/src/lib.rs` still resolves its log directory to `%LOCALAPPDATA%\NetsuRush`, whereas `core/config.js` resolves `NR_HOME` to `%LOCALAPPDATA%\NetsuBoard`.
- `/healthz` still answers `app: "netsurush"`, which is exactly the field a port sweep uses to tell the two services apart.
- `core/shaderUpscale.js` still imports `importToMediaPool` from `core/resolve.js`.

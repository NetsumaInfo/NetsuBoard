# Agent Instructions

NetsuBoard is a standalone Windows desktop app (Tauri shell + Node "core" service): an infinite reference board — images, local videos, YouTube, embeds, notes, drawing — with a GPU shader upscaler. It drives no editing application and embeds no Python.

## The split from NetsuRush — read first

NetsuBoard was copied out of NetsuRush. Timeline transfer, After Effects export, NetsuBoost, voice, dictation, roto, the chat agent, collections, the media library, script, notebook, search, wallpaper, the outbox, the optimiser and Discord presence are **gone** from `core/`, `src/` and the RPC table. `App.tsx` renders one page, `ReferencePanel`.

What is still inherited and **live**: the Resolve bridge cut down to `resolve:status` / `resolve:import`, the Adobe CEP bridge (status, snapshot, launch, media import, panel install), host power (close/reopen an editing app to free RAM/GPU), the project snapshot that feeds it, the model manager, first-run setup, cache admin and export capabilities.

- Do **not** re-import a retired module from NetsuRush; the RPC table is the contract of what this product does.
- The two products stay related: NetsuBoard is [NetsuRush](https://github.com/NetsumaInfo/NetsuRush)'s reference board shipped as its own, far lighter application, under the same maintainer, and it downloads its ffmpeg runtime from a NetsuRush release asset (`docs/distribution.md`). **The board is one feature in two repositories**: when it is changed on one side — a fix, an optimisation, a removed page — the maintainer mirrors the change on the other side by hand. There is no shared code, submodule or sync job, so nothing propagates on its own; when you touch the board, say in the PR what the other repository needs. Everything else is separate: repository, Convex deployment, ports, home and caches.
- 19 of the 61 Node suites are still quarantined in `.github/workflows/ci.yml`; a failure inside that list is not yours.
- Known name/path collisions still in code (tmp caches, log directory) are listed at the end of `docs/invariants.md`. They are defects, not design.

## Language

- Code, identifiers, commit messages, PR titles/descriptions, issues: **English**.
- New comments and new docs: **English**. Existing French comments and docs stay; translate only a file you are already modifying.
- UI copy is never hard-coded: add keys to **all 6 locales** in `src/locales/<lang>/` and run `npm run check:i18n`. `fr` is the source language; the glossary is `src/locales/GLOSSARY.md`.

## Package Manager

- Use **npm**: `npm ci` (lockfile is `package-lock.json`). Node 22+. **No Python, no venv.**

## Commands

| Task | Command |
|---|---|
| Type-check + build renderer | `npm run build` |
| Type-check core service | `npm run check:core` |
| Locale parity | `npm run check:i18n` |
| One Node test | `node --test test/<name>.test.cjs` |
| All Node tests (red, see above) | `node --test test/*.test.cjs` |
| Rust shell check | `cargo check --locked` (in `src-tauri/`) |
| Core alone, headless | `npm run core` |

- 6 of the 61 Node suites also have an `npm run test:*` shortcut; the rest run with `node --test`.
- `.github/workflows/ci.yml` is the source of truth for what must pass.
- There is no ESLint and no formatter config: `tsc` is the lint.

## Runtime Constraints

- A dev instance is often already running (Vite on **:1430** + Tauri window). **Do not launch, close or rebuild the app**: no `npm run tauri dev`, no `npm run package`, no `cargo build`/`tauri build`. `cargo check` is the only Rust verification.
- NetsuRush holds :1420 and its own `NR_HOME`; the two apps run side by side. **Never align their ports, homes or cache directories.**
- `src/**` changes hot-reload. Changes to `core/**` or `src-tauri/**` need a **Tauri window restart** to respawn the core: request it, and state that until it happens the running core still executes the old code.
- Report anything that needs a running app as **not verified at runtime**, never as done.
- Turbo upscaling needs a GPU with Vulkan/`libplacebo`; without it the feature is hidden and everything else works.

## External References

| Need | File |
|---|---|
| Setup, branch and PR rules | `CONTRIBUTING.md` |
| Product vision, scope, risks | `docs/prd.md` |
| Runtime layout, IPC, UI system, theming | `docs/architecture.md` |
| Rules that break correctness if violated | `docs/invariants.md` |
| Per-module notes (board, `.netsu`, upscale) | `docs/modules.md` |
| Packaging, first-run setup, updates, bug relay | `docs/distribution.md` |
| Convex, Discord sign-in and relay provisioning | `docs/convex-setup.md` |
| Code structure and cleanliness rules | `docs/code-style.md` |
| GPU and encoder matrix | `docs/windows-compatibility.md` |
| Release process and signing key | `docs/releasing.md` |
| Security policy | `SECURITY.md` |
| Licensing (AGPL-3.0-only, third-party notices) | `LICENSE`, `LICENSES/`, `docs/licensing.md` |

## Key Conventions

- **Every new IPC channel is added in three places**: handler table in `core/rpc.js`, `NrApi` + implementation in `src/lib/coreClient.ts`, `mock` in `src/lib/bridge.ts`.
- `core/` is CommonJS; the repo root is `type: module` for the Vite renderer.
- Import alias `@/` → `src/`.
- **UI comes from shadcn/ui in its Base UI flavor** (`src/components/ui/`), never Radix, and never a hand-rolled equivalent of a component shadcn provides. Base UI uses a `render` prop, not `asChild`.
- **Tooltips**: always the project `Tooltip` component; never a native `title=`.
- **No JS-driven animation on the board** (no GSAP, no framer-motion `layout`/`AnimatePresence`): it competes with video decoding. Use CSS and `content-visibility`.
- **`ref` is persisted, `src` is recomputed**: never persist an objectURL. A trimmed local clip plays as a proxy, never as the raw file — details in `docs/invariants.md`.
- **Cutting and extraction are lossless** (`-c copy`). Encoders are **never hard-coded per vendor**: the proxy and export paths resolve a probed hardware encoder (NVENC, AMF or Quick Sync) and fall back to hardware H.264, then to `libx264`. Never trigger `libx265` automatically.
- **Upscaling is GLSL shaders through ffmpeg `libplacebo`.** No Python, no neural runtime, no weights — and no fallback to one.
- **Licence hygiene** (the app is AGPL-3.0-only and must stay redistributable): never copy GPL/AGPL code into the tree, even translated. Bundled shaders and assets must be permissively licensed.
- **Every runtime dependency added must also update packaging** — see the checklist in `docs/distribution.md`.
- Never commit: `dist/`, `nr.config.json`, `.env.local`, `.venv/`, `vendor/`, `*.node`.

## Commit Attribution

- Do **not** add `Co-Authored-By` or any other AI attribution trailer to commits.
- Keep one PR to one change; describe what changed, why, and which checks were actually run.

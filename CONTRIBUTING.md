# Contributing to NetsuBoard

Thanks for your interest in NetsuBoard.

Useful contributions include bug fixes, performance and accessibility work, translations, documentation, and features that make a reference board better to actually work with.

## Before you start

- Search existing issues before opening a new one.
- For a significant feature or any change to the workflow or architecture, open an issue first so the direction can be agreed.
- Keep one pull request focused on one change; avoid unrelated edits.

## Language

- Code, identifiers, commit messages, pull requests and issues: **English**.
- New comments and new documentation: **English**. Parts of the existing code and of `docs/` are written in French; leave them as they are and translate only a file you already need to modify.
- User-facing text is never hard-coded. Add keys to all six locales under `src/locales/` and run `npm run check:i18n`. `fr` is the source language for wording; see `src/locales/GLOSSARY.md`.

## Local setup

Requirements: Windows, Node.js 22+, Rust, and ffmpeg/ffprobe on your `PATH`. **No Python is required** — `yt-dlp` ships as a standalone executable.

```bash
git clone https://github.com/NetsumaInfo/NetsuBoard.git
cd NetsuBoard
npm ci
```

Then start development in two terminals:

```bash
npm run dev
```

```bash
npm run tauri dev
```

Vite must be listening on `http://localhost:1430` before Tauri starts. The Rust shell spawns the Node core itself, so there is nothing else to start.

NetsuBoard and [NetsuRush](https://github.com/NetsumaInfo/NetsuRush) are designed to run side by side: different Vite port (1430 vs 1420), different core port range, and a different working directory (`%LOCALAPPDATA%\NetsuBoard`). Do not align any of the three.

### The account is optional — nothing to configure to run the app

With no `.env.local`, NetsuBoard boots straight to the board: no sign-in screen, no network call, and CI stays secret-free. The Convex + Better Auth + Discord chain in `convex/` and `src/components/auth/` only wakes up when `VITE_CONVEX_URL` is set; it exists to name a tester on a bug report, not to unlock the product. Provisioning: [`docs/convex-setup.md`](docs/convex-setup.md).

Two rules if you touch it: keep every import of `convex/react` and `better-auth` **dynamic** (they cost ~140 KB of entry-chunk parsing), and never share a scheme, a storage prefix or a deployment with NetsuRush.

## The unfinished split

NetsuBoard was split out of NetsuRush and **the split is not finished**. The working tree still contains a large amount of inherited code the app never reaches: the Resolve bridge, the Adobe/CEP bridges, timeline transfer, voice, roto, the model catalogue and the Python sidecar plumbing whose `python/` tree no longer exists.

Consequences you will hit:

- `node --test test/*.test.cjs` is **red**: 23 of the 82 suites fail (152 assertions). They are named one by one in the `core` job of `.github/workflows/ci.yml`; the blocking job runs everything else and is green. Do not treat a failure inside that list as your fault — run the suites covering what you touched, and say in the PR which ones you ran and what they returned.
- `test/test_*.py` cannot run at all: they import from a `python/` directory that is gone.
- Documentation in `docs/legacy-netsurush/` describes that inherited code. It is kept for reference and is **not** a description of NetsuBoard.

Do not extend inherited modules. If a change forces you into one, say so in the issue first.

## Pull requests

1. Branch from `main` with a clear name, e.g. `fix/board-proxy-cache` or `feat/shape-inspector`.
2. Follow the existing conventions and architecture (`AGENTS.md` and `docs/code-style.md`).
3. Do not add a dependency without a clear need. A new runtime dependency must also update packaging — see `docs/distribution.md`.
4. Explain what changes, why, any trade-offs, and how you verified it.
5. List the checks you actually ran, and say clearly what you could not test.
6. Add screenshots or a short clip for visual changes.
7. Do not mix a broad refactor with a behaviour change in the same pull request.

## Checks

Run the checks matching the layers you touched:

| Layer | Command |
|---|---|
| Renderer (`src/`) | `npm run build` |
| Core service (`core/`) | `npm run check:core` |
| Text and translations | `npm run check:i18n` |
| Node tests, one suite | `node --test test/<name>.test.cjs` |
| Node tests, all (currently red) | `node --test test/*.test.cjs` |
| Rust shell (`src-tauri/`) | `cargo check --locked` |

Add targeted tests whenever the behaviour can be verified automatically; the invariants documented in `docs/invariants.md` are locked by tests, and a new invariant should be too. Changes to `core/**` or `src-tauri/**` require a full restart of the Tauri window before runtime testing — until that restart, the running core is still executing the old code.

By contributing you agree that your contribution is distributed under the project's [GNU AGPL v3.0](LICENSE) licence, and you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

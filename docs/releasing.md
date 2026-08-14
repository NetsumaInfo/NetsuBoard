# Publishing an update

The NetsuBoard updater reads `latest.json` from the latest release of the `NetsumaInfo/NetsuBoard` GitHub repository (`plugins.updater.endpoints` in `src-tauri/tauri.conf.json`). Archives are signed: the app refuses an unsigned release.

## Signing key

The local private key is `.tauri/netsuboard-updater.key` — a key pair **generated for NetsuBoard**, distinct from NetsuRush's. The folder is git-ignored. The inherited `netsurush-updater.key` is still on disk and is **not** used by this application; do not point the build at it.

The pair carries **no password**. Adding one later means setting `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` everywhere the installer is built.

**Back the private key up outside the development machine before any release**: losing it means existing installs can never accept a future update. Changing the key after a release is not possible without breaking every existing install — an installed app only accepts updates signed by the public key it shipped with.

The public key is stored in `src-tauri/tauri.conf.json`. Unlike the private key, it can be shared.

Before packaging, set `TAURI_SIGNING_PRIVATE_KEY` to the contents of the private key. If a future key is password-protected, also set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

## GitHub artefacts

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`. The three must match — the renderer reads the version from `package.json` (`__APP_VERSION__`) and the manifest generator keys the installer name on it.
2. Add an entry with a unique `id` to `src/data/releases.json`. `create-update-manifest.mjs` looks the release up **by version**; without a matching entry the manifest ships a placeholder note and today's date.
3. Run `npm run package`.
4. Run `npm run update:manifest`.
5. Create the `v<version>` tag and attach to the GitHub release: the NSIS `.exe` installer, its `.exe.sig` signature, and `latest.json`.

The `platforms.windows-x86_64.signature` field of `latest.json` holds the signature **contents**, not a link to the `.sig` file.

`src/data/releases.json` carries NetsuBoard's own history, starting at `netsuboard-0.1.0`. Notes are authored in **fr and en only** — they are content, not interface copy, so `check:i18n` does not police them. The **first** entry is what `UpdateBootstrap` shows once after an update, so it must describe the version being installed.

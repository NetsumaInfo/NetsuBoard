# Publishing an update

The NetsuBoard updater reads `latest.json` from the latest release of the `NetsumaInfo/NetsuBoard` GitHub repository (`plugins.updater.endpoints` in `src-tauri/tauri.conf.json`). Archives are signed: the app refuses an unsigned release.

## Signing key

The local private key is `.tauri/netsurush-updater.key` — **still the NetsuRush key pair**, inherited with the repository copy. The folder is git-ignored.

> **Decide this before the first NetsuBoard release.** Either keep this pair, which means the two applications share an update-signing identity, or generate a NetsuBoard pair (`npm run tauri signer generate`) and put the new public key in `src-tauri/tauri.conf.json`. Changing the key later is not possible without breaking every existing install: an installed app only accepts updates signed by the public key it shipped with.

**Back the private key up outside the development machine before any release**: losing it means existing installs can never accept a future update.

The public key is stored in `src-tauri/tauri.conf.json`. Unlike the private key, it can be shared.

Before packaging, set `TAURI_SIGNING_PRIVATE_KEY` to the contents of the private key. If a future key is password-protected, also set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

## GitHub artefacts

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`. The three must match — the renderer reads the version from `package.json` (`__APP_VERSION__`) and the manifest generator keys the installer name on it.
2. Add an entry with a unique `id` to `src/data/releases.json`. `create-update-manifest.mjs` looks the release up **by version**; without a matching entry the manifest ships a placeholder note and today's date.
3. Run `npm run package`.
4. Run `npm run update:manifest`.
5. Create the `v<version>` tag and attach to the GitHub release: the NSIS `.exe` installer, its `.exe.sig` signature, and `latest.json`.

The `platforms.windows-x86_64.signature` field of `latest.json` holds the signature **contents**, not a link to the `.sig` file.

> `src/data/releases.json` still carries the **NetsuRush** changelog (ids `netsurush-0.3.x`, entries about Resolve/Premiere transfers). It is displayed in the app. Replace it with NetsuBoard's own history before publishing — do not append a NetsuBoard entry to a NetsuRush list.

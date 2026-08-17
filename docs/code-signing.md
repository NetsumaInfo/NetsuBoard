# Code signing and Windows reputation

Two unrelated signatures exist in this project and they are constantly confused.

| | Updater signature | Authenticode signature |
|---|---|---|
| Key | `.tauri/netsuboard-updater.key` (minisign) | A code signing certificate from a CA |
| Checked by | The Tauri updater, inside the app | Windows, SmartScreen, Defender, Smart App Control |
| Covered by | [`releasing.md`](releasing.md) | This document |

An unsigned release is refused **by the updater**; it is accepted by Windows, which merely distrusts it. Publishing an updater-signed installer does nothing for SmartScreen.

## What signing does and does not buy

Signing does **not** remove the SmartScreen prompt on release day. Microsoft removed the EV instant-bypass in 2024, so OV, EV and Artifact Signing all build reputation the same way: organically, through download volume, over weeks. There is no submission form for consumer SmartScreen reputation and no way to buy it.

What it does buy, and why it is still the single highest-value change:

- **Reputation accumulates on the certificate, not only on the file hash.** Unsigned, every release starts from zero and the warning never stops. Signed with a stable certificate, each release inherits what the previous ones earned.
- The prompt names a **verified publisher** instead of an unknown one.
- Defender's machine-learning classifiers weight "unsigned" heavily. Signing is what moves `Trojan:Script/Wacatac.B!ml`-class false positives off this installer.
- Windows 11 **Smart App Control** blocks unsigned executables outright, regardless of SmartScreen.

## Choosing a certificate

| Option | Cost | Available to | Notes |
|---|---|---|---|
| **SignPath Foundation** | Free | OSI-licensed open source | Best fit on paper: this repository is public and AGPL-3.0-only. Requires a **verifiable CI build** (SignPath attests the binary came from the public source), MFA, a manual approval per release, and a published "Code signing policy" page. Disqualifying condition: **any commercial dual-licensing**. |
| **Azure Artifact Signing** (ex-Trusted Signing) | ~$9.99/month | Organizations in the US, Canada, EU, UK, AU, NZ, JP, KR, SG, CH, NO, IL. **Individuals: US and Canada only.** | Microsoft's recommended non-Store path. No hardware token, integrates with CI. From France it needs a **registered legal entity** (business identifier, business address, owned domain); the Azure billing account type must match the identity validation type. Validation takes 1–20 business days. |
| **OV certificate** | $150–300/year | Worldwide, individuals included | The fallback when the two above are closed. Since June 2023 the private key must live on an HSM or USB token (cloud HSM options exist for CI). |
| **EV certificate** | $400+/year | Worldwide | No SmartScreen advantage over OV since 2024. Not worth the premium here. |

Two rules that outlive the choice:

- **Never change certificate once reputation has started building.** Reputation is keyed on the certificate thumbprint; a renewal with a new thumbprint resets it to zero.
- **Sign after staging, never before.** `scripts/build.ps1` copies `core/`, `scripts/`, the shaders and `dist/` into `src-tauri/resources/` before `tauri build`. Modifying a file after it is signed breaks its signature.

## Two wiring shapes, and the trap between them

Where the signature happens decides whether the updater still works.

- **In-build** (Azure Artifact Signing, `signtool`): Tauri runs the signing tool on each binary *during* bundling, then computes the updater's minisign signature over the already-signed installer. Nothing else to do.
- **Post-build** (SignPath): the finished `.exe` is submitted, signed and returned. Authenticode **rewrites the bytes**, so the `.sig` that `tauri build` wrote over the unsigned file no longer matches. Left alone, every installed copy would refuse the update, because `create-update-manifest.mjs` reads that stale `.sig` off disk and copies it into `latest.json`.

  The signature must therefore be regenerated on the signed installer, **before** the manifest is built:

  ```powershell
  npx tauri signer sign <path-to-signed-setup.exe>
  ```

  `.github/workflows/release.yml` does this in order: build → SignPath → re-sign → manifest.

## SignPath, in practice

`.github/workflows/release.yml` builds the installer on a runner and submits it. The SignPath step is skipped while `vars.SIGNPATH_ORGANIZATION_ID` is unset, so the workflow is usable before the application is accepted — it then produces an unsigned installer, exactly like a local `npm run package`.

To turn it on, set these on the repository:

| Kind | Name |
|---|---|
| Secret | `SIGNPATH_API_TOKEN` |
| Secret | `TAURI_SIGNING_PRIVATE_KEY` (contents of `.tauri/netsuboard-updater.key`) |
| Variable | `SIGNPATH_ORGANIZATION_ID` |
| Variable | `SIGNPATH_PROJECT_SLUG` |
| Variable | `SIGNPATH_SIGNING_POLICY_SLUG` |

The Foundation also requires, on the project side: MFA on GitHub and on SignPath, defined Author / Reviewer / Approver roles with every external contribution reviewed, a manual approval for each release, product name and version metadata on the signed binaries (`bundle.publisher`, `bundle.copyright` and `version` in `tauri.conf.json`), and a public **"Code signing policy"** page naming the team, the privacy policy and the SignPath Foundation attribution.

Eligibility is lost the day any part of the project gains a commercial dual licence. Selling AGPL-3.0-only binaries does not: the disqualifying condition is offering an alternative proprietary licence.

## Wiring a signing tool into the build

For the in-build shape, signing is opt-in through the `NETSUBOARD_SIGN_COMMAND` environment variable. `scripts/build.ps1` reads it, writes a `--config` overlay (`src-tauri/tauri.sign.conf.json`, git-ignored) carrying `bundle.windows.signCommand`, and passes it to `tauri build`. Tauri then runs the command once per binary in the package, with `%1` replaced by the file path.

A permanent `signCommand` is deliberately **not** committed to `tauri.conf.json`: it would break every build on a machine without the signing tool installed.

With Azure Artifact Signing (`cargo install trusted-signing-cli`, endpoint `neu` = North Europe):

```powershell
$env:AZURE_TENANT_ID = '...'
$env:AZURE_CLIENT_ID = '...'
$env:AZURE_CLIENT_SECRET = '...'
$env:NETSUBOARD_SIGN_COMMAND = 'trusted-signing-cli -e https://neu.codesigning.azure.net -a <account> -c <profile> -d NetsuBoard %1'
npm run package
```

With a certificate on a token or in a store, any tool accepting a file path works the same way, for example `signtool sign /fd SHA256 /sha1 <thumbprint> /tr <timestamp-url> /td SHA256 %1`.

Without the variable the build prints a warning and produces an unsigned installer. That still ships; it just carries no reputation.

`bundle.publisher` in `tauri.conf.json` is `Haim Faraj`. It must be kept **identical to the subject of the certificate** that ends up signing the builds — if a legal entity is registered for Azure Artifact Signing, the company name replaces it in both places at once.

## What the installer must not do

Defender's `!ml` verdicts are classifier output, not signature matches, and an installer earns them by *looking* like a dropper. Three patterns are the expensive ones, and the first two are gone from this tree:

- **A script dropped into `%TEMP%` and relaunched through `powershell.exe -ExecutionPolicy Bypass`** — the canonical dropper invocation. The uninstall cleanup is plain NSIS file operations in `src-tauri/windows/installer-hooks.nsh` for exactly this reason. The string sits in clear text inside the compiled installer, so it is scanned at **install** time even when the code only runs on uninstall. `test/packaging.test.cjs` asserts it stays out.
- **Writing an executable somewhere and running it.** `NSIS_HOOK_PREINSTALL` still does this once, with `app.exe` copied into `$PLUGINSDIR` to release the `app.exe` and `node.exe` locks through Restart Manager. It is kept because removing it breaks installing over a running app — but the dropped binary is signed as soon as signing is on, which is what defuses it.

One pattern in `NSIS_HOOK_PREINSTALL` looks adjacent to that list and is deliberately kept: when `$INSTDIR` is not writable, the hook re-runs **itself** — `$EXEPATH`, not a dropped file — through `ExecShell "runas"`, after a dialog the user has to accept, and passes `/NRELEVATED` so it can never ask twice. Requesting elevation is what every per-machine installer on Windows does; nothing is written, downloaded or executed before the user says yes.
- **Downloading executable payloads after install.** `scripts/setup.ps1` fetches ffmpeg, the shaders and `yt-dlp.exe` on first run. This is structural to the product and cannot be removed; note that `yt-dlp.exe` is itself a long-standing `Wacatac.B!ml` false positive upstream because it is a PyInstaller bundle.

  `core/ytdlpUpdate.js` extends that chain: on the first boot of a new application version it runs `yt-dlp -U`, and yt-dlp then replaces its own binary in `%LOCALAPPDATA%`. The shape stays deliberate — the application downloads nothing itself and writes no executable; it calls a tool's own documented update command, once per release, on the file that tool already owns. Anything that reached for a hand-rolled download-and-overwrite of a `.exe` at runtime would be the dropper pattern proper.

## What the running app must not do

The installer is only half of it. Defender also scores the **process tree**, and a detection naming `app.exe`, its pid and the Start Menu shortcut is a runtime verdict, not an install-time one.

The chain here is `app.exe` → `resources\bin\node.exe` → `powershell.exe` → downloaded executables. Every link is legitimate and none can be removed, so the shape of the PowerShell call is what is left to control:

- `core/setup.js` launches `setup.ps1` with **`-File`**. It previously used `-Command` with `& ([scriptblock]::Create([IO.File]::ReadAllText(...)))` — code built at runtime from a file read at runtime, under `-ExecutionPolicy Bypass`, in a hidden window. AMSI scans the constructed block, and that combination is what fileless loaders look like. `-File` is the ordinary shape and hides nothing.
- The UTF-8 that scriptblock existed to force now comes from the **BOM on `scripts/setup.ps1`**, which is what Windows PowerShell 5.1 reads. The source file carries one and `scripts/build.ps1` rewrites the staged copy with one, so dev and bundle behave alike. Removing that BOM turns every accent in the setup UI into mojibake.
- `-ExecutionPolicy Bypass` remains, because the default `Restricted` policy blocks an unsigned `.ps1` outright. The fix is to **Authenticode-sign `setup.ps1`** once a certificate exists — `.ps1` files take a signature like any PE — and drop to `-ExecutionPolicy RemoteSigned`. Test that on a clean machine before shipping it: if the staged script ever carries a mark-of-the-web, `RemoteSigned` refuses it and first-run setup fails outright.

## When a release is flagged anyway

1. Upload the installer to **VirusTotal** first. If Defender is the only engine flagging it, it is a machine-learning false positive and the rest of this list applies. If several engines agree, stop and investigate the build instead.
2. Submit it at [microsoft.com/wdsi/filesubmission](https://www.microsoft.com/en-us/wdsi/filesubmission), category **"Software developer – false positive"**, signed in so the verdict is trackable. Attach the VirusTotal link and the GitHub release URL.
3. If a shipped version stays blocked, escalate at [msrc.microsoft.com/report](https://msrc.microsoft.com/report).
4. Publish the installer's SHA-256 on the release page so testers can verify what they downloaded.

Steps 1, 2 and 4 belong to every release until reputation is established — see the checklist in [`releasing.md`](releasing.md).

Never tell a tester to add a Defender exclusion. It trains them to disable protection for an unknown binary, and it hides the problem instead of fixing it.

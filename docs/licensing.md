# Licensing and redistribution

## Original code

The original NetsuBoard code is distributed under the **GNU Affero General Public License version 3.0 only** (`AGPL-3.0-only`). The full legal text is in [`../LICENSE`](../LICENSE). The SPDX/REUSE declaration — including the copyright holder — is centralised in [`../REUSE.toml`](../REUSE.toml), which keeps licence information from being lost when a file is moved or copied.

This licence allows commercial use, copying and modification, but requires among other things that notices be kept, that modifications be published under the same licence, and that the corresponding source be provided with any binary redistribution. If a modified version lets users interact with it remotely over a network, it must also offer them free access to the corresponding source.

The reference public repository for the source is <https://github.com/NetsumaInfo/NetsuBoard>.

## Scope

AGPL-3.0-only covers the original code in this repository. It does **not** change the terms applying to third-party material:

- npm and Rust dependencies keep their own licences;
- ffmpeg/ffprobe, `yt-dlp`, WebView2 and any other software installed or used on the machine are **not** relicensed by NetsuBoard;
- the GLSL shaders (ArtCNN) and anything vendored under `vendor/` carry their own licences and restrictions;
- licence files already shipped next to bundled resources must stay distributed with those resources.

## Note sheet editor (BlockNote)

The note sheet editor is **BlockNote** (`@blocknote/core`, `react`, `mantine`, `code-block`), licensed **MPL-2.0**, with Mantine and KaTeX (MIT). MPL-2.0 is file-level copyleft: NetsuBoard's own files that use BlockNote are not affected, but a modified copy of a BlockNote source file must stay under MPL-2.0 and its source must be published. Use it as an npm dependency; never patch or vendor its files into `src/`.

BlockNote's `@blocknote/xl-*` packages (multi-column, AI, PDF/DOCX/ODT export) are **GPL-3.0 or commercial**: never add them.

## PDF cards (pdf.js)

PDF cards on the board are rendered by **pdfjs-dist** (pdf.js), licensed **Apache-2.0**. It is an npm dependency bundled by Vite into the renderer (`dist/`), together with its worker file: nothing is staged separately in the installer, so the packaging checklist of `docs/distribution.md` is satisfied by the renderer build. It is loaded lazily, the first time a PDF is added or opened. Do not vendor or patch its files into `src/`.

## Document cards (mammoth, html-to-image)

Word (`.docx`) cards are converted to HTML by **mammoth** (`1.13`, **BSD-2-Clause**). Its runtime dependencies are MIT or BSD-2-Clause (`@xmldom/xmldom`, `base64-js`, `dingbat-to-unicode`, `lop`, `underscore`, `xmlbuilder`), `jszip` is dual **MIT OR GPL-3.0-or-later** (we take it under MIT), and `argparse` (Python-2.0, permissive) is only used by mammoth's command-line tool, which Vite never bundles. The card thumbnail of a text, Markdown, CSV or Word document is rasterised by **html-to-image** (`1.11`, **MIT**). Both are npm dependencies bundled by Vite into lazy renderer chunks, loaded the first time a document is added or opened: nothing is staged in the installer. Spreadsheet formats (`.xlsx`, SheetJS) are deliberately not read: the npm build of SheetJS is outdated and vulnerable, so those files stay plain "file" cards. The CSV parser and the Markdown renderer are our own code (no dependency).

## Live site ad blocking (adblock-rust, EasyList, EasyPrivacy)

The live-site webview, the background-picture webview and the board's own webview (third-party requests of embedded frames only) filter requests with the **`adblock`** crate (Brave's adblock-rust, `0.13`, **MPL-2.0**, file-level copyleft: used as a Cargo dependency, never patched or vendored). Its dependencies are MIT/Apache-2.0 (`addr`, `psl`, `psl-types`, `itertools`, `flatbuffers`). It is built without the default `single-thread` feature so the engine can be shared across threads.

The filter lists, **EasyList** and **EasyPrivacy** (<https://easylist.to>, dual-licensed GPL-3.0-or-later / CC BY-SA 3.0), are **downloaded data, not bundled**: the app fetches them at runtime into the user's cache directory and nothing from them ships in the installer or the repository. They are parsed as data by the engine and no code of theirs is linked. The weekly refresh and the "Refresh lists" action download them again from the same URLs. Do not commit a copy of the lists, and do not add a bundled fallback list without re-checking their licence terms for redistribution.

## Native player runtime (mpv, FFmpeg)

**The installer ships none of these binaries.** The native player is inherited from NetsuRush and no line of `src/` or `core/` calls it, so `scripts/build.ps1` stages an empty `resources/windows/` and `src-tauri/src/player/bootstrap.rs` logs that playback is unavailable. The paragraphs below apply the day the player is wired up again.

The native video player relies on **libmpv** and the **FFmpeg** libraries shipped with it. Those binaries are **not versioned in this repository**: they would be distributed separately as a release asset and provisioned by [`scripts/fetch-mpv.ps1`](../scripts/fetch-mpv.ps1) into `vendor/mpv/`.

- **mpv** — GPL-2.0-or-later, with parts under LGPL-2.1-or-later.
- **FFmpeg** — LGPL-2.1-or-later, and GPL-2.0-or-later when built with `--enable-gpl`.

Those licences are **distinct from NetsuBoard's AGPL-3.0-only** and are not absorbed by it. Any redistribution of those binaries — in particular an `.exe` installer that embedded them — must ship their licence texts and make the **corresponding source** available, or state precisely where to obtain it. A bare set of DLLs is therefore not enough to package: the release asset must carry those licence texts plus the exact mpv and FFmpeg revisions used for the build.

## Mirrored ffmpeg CLI

The `ffmpeg`/`ffprobe` command-line binaries used by the core are a **separate** GPL build from the libraries shipped with mpv, and the project mirrors them as a release asset instead of linking to a third-party host. Mirroring makes the project the distributor, so the same obligation applies: [`scripts/ffmpeg-mirror.ps1`](../scripts/ffmpeg-mirror.ps1) writes a `SOURCES.md` inside the archive naming the upstream build and the matching source tarball, and downloads that tarball so **both assets go into the same release**. Publishing the binary without its sources is not an option.

> The mirror currently downloaded by `scripts/setup.ps1` is a **release asset of the NetsuRush repository**. That is a hosting choice, not a licence one, and it holds as long as both projects share a maintainer — but a NetsuBoard install then depends on another repository staying published. Mirror the same asset on this repository's releases before treating NetsuBoard as independently distributable.

Before publishing an installer or an image containing a new dependency: check its licence, keep its copyright notice, and add its text to the third-party licence artefacts if needed. Never present a third-party component as covered by NetsuBoard's AGPL.

## Rules that keep the project redistributable

- **Never copy GPL or AGPL code into the tree**, not even translated into another language: it would make the whole app a derivative work of it. Studying a GPL project's UX or approach and reimplementing it is fine; copying its source is not.
- **The GLSL shaders ship with the app**, so their licences ship with it too. ArtCNN is permissive (MIT), which is what makes bundling it in the installer possible; a shader under a copyleft or non-commercial licence would not be, whatever its quality.
- **Verify a licence at its source** (the repository, the release page) before adding a shader or a dependency. Summaries and third-party mirrors have been wrong more than once, in both directions.
- An asset re-uploaded by a third party **without a declared licence** is not usable, whatever the original's licence.

## Legal notice inside the app

NetsuBoard is provided **without warranty**, per sections 15 and 16 of the AGPL. The source and the licence text are published with the project; any derived remote interface or distribution must keep visible access to that information and comply with section 13 of the AGPL.

# Licensing and redistribution

## Original code

The original NetsuBoard code is distributed under the **GNU Affero General Public License version 3.0 only** (`AGPL-3.0-only`). The full legal text is in [`../LICENSE`](../LICENSE). The SPDX/REUSE declaration — including the copyright holder — is centralised in [`../REUSE.toml`](../REUSE.toml), which keeps licence information from being lost when a file is moved or copied.

This licence allows commercial use, copying and modification, but requires among other things that notices be kept, that modifications be published under the same licence, and that the corresponding source be provided with any binary redistribution. If a modified version lets users interact with it remotely over a network, it must also offer them free access to the corresponding source.

The reference public repository for the source is <https://github.com/NetsumaInfo/NetsuBoard>.

## Scope

AGPL-3.0-only covers the original code in this repository. It does **not** change the terms applying to third-party material:

- npm and Rust dependencies keep their own licences;
- ffmpeg/ffprobe, `yt-dlp`, WebView2 and any other software installed or used on the machine are **not** relicensed by NetsuBoard;
- the GLSL shaders (ArtCNN, Anime4K) and anything vendored under `vendor/` carry their own licences and restrictions;
- licence files already shipped next to bundled resources must stay distributed with those resources.

## Native player runtime (mpv, FFmpeg)

The native video player relies on **libmpv** and the **FFmpeg** libraries shipped with it. Those binaries are **not versioned in this repository**: they are distributed separately as a release asset and provisioned by [`scripts/fetch-mpv.ps1`](../scripts/fetch-mpv.ps1) into `vendor/mpv/`.

- **mpv** — GPL-2.0-or-later, with parts under LGPL-2.1-or-later.
- **FFmpeg** — LGPL-2.1-or-later, and GPL-2.0-or-later when built with `--enable-gpl`.

Those licences are **distinct from NetsuBoard's AGPL-3.0-only** and are not absorbed by it. Any redistribution of those binaries — in particular the `.exe` installer, which embeds them — must ship their licence texts and make the **corresponding source** available, or state precisely where to obtain it. The release package therefore contains those licence texts plus the exact mpv and FFmpeg revisions used for the build.

## Mirrored ffmpeg CLI

The `ffmpeg`/`ffprobe` command-line binaries used by the core are a **separate** GPL build from the libraries shipped with mpv, and the project mirrors them as a release asset instead of linking to a third-party host. Mirroring makes the project the distributor, so the same obligation applies: [`scripts/ffmpeg-mirror.ps1`](../scripts/ffmpeg-mirror.ps1) writes a `SOURCES.md` inside the archive naming the upstream build and the matching source tarball, and downloads that tarball so **both assets go into the same release**. Publishing the binary without its sources is not an option.

> The mirror currently downloaded by `scripts/setup.ps1` is a **release asset of the NetsuRush repository**. That is a hosting choice, not a licence one, and it holds as long as both projects share a maintainer — but a NetsuBoard install then depends on another repository staying published. Mirror the same asset on this repository's releases before treating NetsuBoard as independently distributable.

Before publishing an installer or an image containing a new dependency: check its licence, keep its copyright notice, and add its text to the third-party licence artefacts if needed. Never present a third-party component as covered by NetsuBoard's AGPL.

## Rules that keep the project redistributable

- **Never copy GPL or AGPL code into the tree**, not even translated into another language: it would make the whole app a derivative work of it. Studying a GPL project's UX or approach and reimplementing it is fine; copying its source is not.
- **The GLSL shaders ship with the app**, so their licences ship with it too. ArtCNN and Anime4K are permissive (MIT), which is what makes bundling them in the installer possible; a shader under a copyleft or non-commercial licence would not be, whatever its quality.
- **Verify a licence at its source** (the repository, the release page) before adding a shader or a dependency. Summaries and third-party mirrors have been wrong more than once, in both directions.
- An asset re-uploaded by a third party **without a declared licence** is not usable, whatever the original's licence.

## Legal notice inside the app

NetsuBoard is provided **without warranty**, per sections 15 and 16 of the AGPL. The source and the licence text are published with the project; any derived remote interface or distribution must keep visible access to that information and comply with section 13 of the AGPL.

<div align="center">
  <img src="src-tauri/icons/128x128.png" alt="" width="112" height="112">

# NetsuBoard

**An infinite mood board for people who work with footage.** Images, videos, YouTube links, notes and drawings on one canvas — with GPU upscaling built in.

[![Latest release](https://img.shields.io/github/v/release/NetsumaInfo/NetsuBoard)](https://github.com/NetsumaInfo/NetsuBoard/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/NetsumaInfo/NetsuBoard/ci.yml?branch=main&label=CI)](https://github.com/NetsumaInfo/NetsuBoard/actions/workflows/ci.yml)
[![Downloads](https://img.shields.io/github/downloads/NetsumaInfo/NetsuBoard/total)](https://github.com/NetsumaInfo/NetsuBoard/releases)
[![Licence](https://img.shields.io/github/license/NetsumaInfo/NetsuBoard)](LICENSE)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-lightgrey.svg)

</div>

NetsuBoard is a **standalone desktop app**: a **Tauri** shell plus a local **Node "core"** service that serves media, relays online video and drives ffmpeg. Nothing is installed inside an editing application, and nothing needs an account or a network connection to work on local files.

It is built to sit next to a busy NLE, so the whole runtime is deliberately small: **ffmpeg, a handful of GLSL shaders and `yt-dlp`**. There is no Python interpreter, no ML environment and no model download.

## Features

| | |
|---|---|
| **Infinite canvas** | Pan/zoom board carrying images, local videos, YouTube videos, web embeds and links, text notes, shapes and lines, freehand drawing, emoji and icons, colour palettes, and frames and sequences to group what belongs together |
| **Media handling** | Local playback through a range-serving media route, remux on the fly for containers WebView2 cannot read, per-item trim, loop and ping-pong |
| **Online media** | YouTube plays as a plain `<video>` through a `yt-dlp` relay, so trim and looping behave like a local file; generic pages exposing OpenGraph or HTML5 video can be linked or downloaded |
| **Upscale** | Two engines. **Shaders**: the ffmpeg `libplacebo` filter over Vulkan, running ArtCNN in six variants for animation and `lanczossharp` for live action — weights are compiled into the GLSL, so there is nothing to install or download. **AI**: NVIDIA RTX Video Super Resolution, decoding and encoding on the GPU, output always HEVC 10-bit |
| **Projects** | Scenes stored internally, plus `.netsu` project files — a SQLite container with content-addressed media and a companion `my-project.medias/` folder |
| **Collaboration** | A board can be shared with friends: one authoritative CRDT document, edits and media travelling peer to peer over an encrypted link, and a status panel showing who is present and what is still owed. The server is used for recovery and membership, never as a live relay for the document |
| **Detached board** | A second frameless, always-on-top window rendering the board bare, or the same thing in place when the main window is pinned |
| **Export** | Send a board or a selection out to the formats the export page offers |
| **Storage** | A settings section for what the app keeps: media it fetched or extracted, processing tests, cache policy per kind, disk usage, and cleanup |
| **Appearance** | Switchable palettes, custom themes, image/GIF/video wallpapers with crop, blur and translucency |
| **Along the way** | Discord rich presence, a keyboard shortcut panel, in-app update checks, hardware and compatibility reports, and a bug report that collects its own context |
| **Languages** | French, English, Spanish, German, Japanese, Chinese |

## Getting started

### Prerequisites

- **Windows** with WebView2 (shipped with Windows 11)
- **Node.js 22+** and **Rust / Cargo** (the Tauri toolchain)
- **ffmpeg / ffprobe** on your `PATH` for development

> [!TIP]
> Use the ffmpeg version pinned in `scripts/setup.ps1`. The installed app checks the version of the ffmpeg it provisioned; a development `PATH` is not checked, so an older build can silently behave differently from what ships. The shader upscaler in particular needs a build with `libplacebo`.

There is **no Python requirement**: `yt-dlp` is provisioned as a standalone executable carrying its own interpreter.

### Run it

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

Vite must be listening before Tauri starts. The Rust shell spawns the Node core itself, so there is nothing else to launch. Vite serves on **`http://localhost:1430`** and the core picks a free local port, which the shell hands to the renderer.

Opening `http://localhost:1430` in a normal browser renders the interface against a no-op mock: the layout is inspectable, but nothing that needs the core will work.

### Build an installer

```bash
npm run package
```

`scripts/build.ps1` type-checks, builds the renderer, fetches a portable `node.exe`, then stages into `src-tauri/resources/` a **closed list** of folders — `bin`, `core`, `dist`, `scripts`, `shaders`, `windows` — and purges anything else it finds there before running `tauri build`. Tauri bundles `resources/**/*` whole, so a folder left behind would ship inside the installer. The result is an NSIS installer under `src-tauri/target/release/bundle/nsis/`, installed per user with no administrator rights.

## First run

The installed app provisions its runtime on first launch (`scripts/setup.ps1`): ffmpeg + ffprobe, the GLSL shaders, and `yt-dlp`. Everything lands in `%LOCALAPPDATA%\NetsuBoard`, which is also where `nr.config.json` is written; set `NR_HOME` to move it. `yt-dlp` is optional — without it, links to online media stop resolving, but a board of local files is fully usable.

## Project status

NetsuBoard is the reference board of [NetsuRush](https://github.com/NetsumaInfo/NetsuRush), a larger post-production hub, extracted and shipped as its own far lighter application. It keeps the board, the `.netsu` format and the upscaler. The two repositories are separate — separate code, releases and configuration — and a change made to the board on one side is carried to the other by hand.

Some pages are carried over from the main application rather than written for this one, and the Settings panel still lists a few. They are not part of what NetsuBoard is for. A handful of inherited Node test suites fail for the same reason and are quarantined by name in [`.github/workflows/ci.yml`](.github/workflows/ci.yml); the blocking job runs everything else. See [AGENTS.md](AGENTS.md) for the current state.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, branch and pull-request rules, and [AGENTS.md](AGENTS.md) for the conventions every change must follow. Security reports go through the private channels in [SECURITY.md](SECURITY.md), never a public issue.

## Licence

[GNU AGPL v3.0 only](LICENSE). Third-party notices are in [`LICENSES/`](LICENSES/) and the redistribution rules in [`docs/licensing.md`](docs/licensing.md). The board's interaction model is inspired by [AnimRef](https://github.com/lettucegoblin/AnimRef); the implementation is independent.

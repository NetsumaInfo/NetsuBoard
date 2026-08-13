<div align="center">
  <img src="src-tauri/icons/128x128.png" alt="NetsuBoard" width="112" height="112">

# NetsuBoard

**An infinite mood board for people who work with footage.** Images, videos, YouTube links, notes and drawings on one canvas — with a GPU shader upscaler built in.

[![Licence: AGPL v3](https://img.shields.io/badge/licence-AGPL--3.0--only-blue.svg)](LICENSE)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-lightgrey.svg)

</div>

NetsuBoard is a **standalone desktop app**: a **Tauri** shell plus a local **Node "core"** service that serves media, relays online video and drives ffmpeg. Nothing is installed inside an editing application, and nothing needs an account or a network connection to work on local files.

It is built to sit next to a busy NLE, so the whole runtime is deliberately small: **ffmpeg, a handful of GLSL shaders and `yt-dlp`**. There is no Python interpreter, no ML environment and no model download.

## Features

| | |
|---|---|
| **Infinite canvas** | Pan/zoom board with images, local videos, YouTube videos, web embeds, text notes, shapes and freehand drawing |
| **Media handling** | Local playback through a range-serving media route, remux on the fly for containers WebView2 cannot read, per-item trim, loop and ping-pong |
| **Online media** | YouTube plays as a plain `<video>` through a `yt-dlp` relay, so trim and looping behave like a local file; generic pages exposing OpenGraph or HTML5 video can be linked or downloaded |
| **Turbo upscale** | GPU upscaling through the ffmpeg `libplacebo` filter (Vulkan): ArtCNN and Anime4K GLSL shaders for animation, `lanczossharp` for live action. No neural runtime, no weights |
| **Projects** | Scenes stored internally, plus `.netsu` project files — a SQLite container with content-addressed media and a companion `my-project.medias/` folder |
| **Detached board** | A second frameless, always-on-top window rendering the board bare, or the same thing in place when the main window is pinned |
| **Appearance** | Switchable palettes, custom themes, image/GIF/video wallpapers with crop, blur and translucency |
| **Languages** | French, English, Spanish, German, Japanese, Chinese |

## Getting started

### Prerequisites

- **Windows** with WebView2 (shipped with Windows 11)
- **Node.js 22+** and **Rust / Cargo** (the Tauri toolchain)
- **ffmpeg / ffprobe** on your `PATH` for development

> [!TIP]
> Use the ffmpeg version pinned in `scripts/setup.ps1`. The installed app checks the version of the ffmpeg it provisioned; a development `PATH` is not checked, so an older build can silently behave differently from what ships. The upscaler in particular needs a build with `libplacebo`.

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

`scripts/build.ps1` type-checks, builds the renderer, fetches a portable `node.exe`, stages `core/`, the shaders and `dist/` into `src-tauri/resources/`, then runs `tauri build`. The result is an NSIS installer under `src-tauri/target/release/bundle/nsis/`, installed per user with no administrator rights.

## First run

The installed app provisions its runtime on first launch (`scripts/setup.ps1`): ffmpeg + ffprobe, the GLSL shaders, and `yt-dlp`. Everything lands in `%LOCALAPPDATA%\NetsuBoard`, which is also where `nr.config.json` is written; set `NR_HOME` to move it. `yt-dlp` is optional — without it, links to online media stop resolving, but a board of local files is fully usable.

## Project status

NetsuBoard was split out of [NetsuRush](https://github.com/NetsumaInfo/NetsuRush), a larger post-production hub, and keeps its board, its `.netsu` format and its shader upscaler. **The split is not finished**: the working tree still carries a large amount of inherited NetsuRush code (Resolve bridge, Adobe bridges, Python sidecar plumbing, voice and roto modules) that the app never reaches. It is not documented here, it is not part of the product, and a share of the inherited test suite fails because the `python/` tree it exercised is gone. See [AGENTS.md](AGENTS.md) for the current state.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, branch and pull-request rules, and [AGENTS.md](AGENTS.md) for the conventions every change must follow. Security reports go through the private channels in [SECURITY.md](SECURITY.md), never a public issue.

## Licence

[GNU AGPL v3.0 only](LICENSE). Third-party notices are in [`LICENSES/`](LICENSES/) and the redistribution rules in [`docs/licensing.md`](docs/licensing.md). The board's interaction model is inspired by [AnimRef](https://github.com/lettucegoblin/AnimRef); the implementation is independent.

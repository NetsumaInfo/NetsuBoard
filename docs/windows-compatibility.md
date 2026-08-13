# Windows GPU compatibility

NetsuBoard does not assume an NVIDIA card. On first launch the app inventories the Windows GPUs, then validates video encoders **separately** with a real test frame. An acceleration path that fails the probe is never offered; the CPU path always stays available.

## Execution matrix

| Feature | NVIDIA | AMD | Intel | No supported GPU |
|---|---|---|---|---|
| Preview proxies and `/stream` | NVENC | AMF | Quick Sync | libx264 (CPU) |
| H.264 / HEVC / AV1 export | encoder probed per profile | encoder probed per profile | encoder probed per profile | matching CPU codec |
| Turbo upscale (GLSL shaders) | Vulkan / libplacebo | Vulkan / libplacebo | Vulkan / libplacebo | **unavailable** |
| Board, thumbnails, `.netsu`, notes, drawing | identical | identical | identical | identical |

The "GPU" choice stored in upscale preferences is an **automatic intent**: it resolves to `*_nvenc`, `*_amf` or `*_qsv`. The legacy `h264_nvenc` / `hevc_nvenc` ids stay readable so existing settings keep working.

**H.265/HEVC is hardware-encoded on all three vendors** (`hevc_nvenc`, `hevc_amf`, `hevc_qsv`), not only on NVIDIA — including for the preview proxies. What decides is the **probe**, not the brand: an encoder that a machine cannot actually run degrades to hardware H.264, then to the CPU codec. Two consequences worth knowing:

- an ffmpeg build **advertises** `h264_qsv` and `h264_amf` even with no Intel or AMD GPU installed, so every hardware encoder is probed with its real profile and pixel format before being offered;
- the only genuinely NVIDIA-only profiles are **4:4:4** (`h264_high444`, HEVC RExt 4:4:4): no other vendor encodes them, so they run on the CPU elsewhere.

## Turbo upscaling is the one hard GPU requirement

The upscaler is the ffmpeg `libplacebo` filter over **Vulkan**. There is **no CPU fallback and no AI fallback** — the shaders are the engine. A machine without a working Vulkan/`libplacebo` path is offered no shader rather than a job that fails halfway, and everything else in the app keeps working.

Two ways to lose it on a machine that otherwise has a capable GPU:

- **a `master` ffmpeg build**, whose libplacebo/Vulkan sometimes fails to initialise. The pinned version in `scripts/setup.ps1` exists partly for this; never widen it to a moving alias.
- **a driver without Vulkan support**, typically an old integrated GPU or a headless/RDP session.

## Diagnostics

Settings shows the Windows inventory and the FFmpeg encoders that passed the probe. The upscale picker hides variants and hardware profiles that failed (for example HEVC Main 10). If a hardware session becomes unavailable **after** the probe, the job is automatically replayed on the CPU codec of the same family.

## Technical sources

- [AMVerge — hardware detection and encoders](https://github.com/AMVerge-team/AMVerge/blob/main/frontend/src-tauri/src/commands/export/hardware.rs)

# NetsuBoard Music Clips Design

**Date:** 2026-11-16
**Status:** Implemented, storyboard and video export included (see `docs/modules.md`, Music clips).

## Goal

Add animated presentations driven by a piece of music to a mood board: while the track plays, items appear and disappear and a camera moves across a space. The typical use is pitching a music video or an AMV before editing it.

## Decisions

### Clips live inside the mood board

The mood board itself stays a normal, static board with no timeline. The user places **Animatic** objects on it (named Clip during design; code and data still say `clip`), as many as needed: one per track, per version or per part.

A Clip is a dedicated sub-space. Opening it enters a space with its own items, its own timeline and its own camera; everything below applies inside a Clip. The mood board is for collecting, a Clip is for animating.

```
Mood board (static)
┌────────────────────────────────────┐
│ [img] [img]  [note]                │
│   ┌─────────┐   ┌─────────┐        │
│   │ 🎵 Clip │   │ 🎵 Clip │        │
│   │ Song A  │   │ Song B  │        │
│   └─────────┘   └─────────┘        │
└────────────────────────────────────┘
        ↓ open
┌──── Clip space ────────────────────┐
│  working board + camera            │
├──── timeline ──────────────────────┤
│ Long / Shots / Music               │
└────────────────────────────────────┘
```

### Clip items are copies

Dragging an item from the mood board into a Clip copies it. The Clip's items are its own: moving or resizing them never touches the mood board. Only the item is duplicated, not the media: `ref` is persisted and the file stays in one place on disk.

### Filling a Clip

- **Create Clip from selection**: select items on the mood board, right-click → Create Clip. They are copied in with their layout kept.
- **Mood board panel** inside a Clip: a side column of the mood board's items to drag into the Clip while working.
- A Clip is a board of its own: files, pastes and links can be dropped straight into it, and those items exist only in the Clip.
- Dropping items on a Clip's tile on the mood board (they land in a pile inside) is a later shortcut.

### Clip tile on the mood board

A closed Clip shows as a tile: a thumbnail of its first shot as poster, with the Clip name, duration, shot count and track title. Moving the mouse across the tile scrubs through the shots' thumbnails (stills only: no playback, no sound, no JS animation). A ▶ button opens the Clip straight in Present.

```
┌─────────────────────┐
│  [shot thumbnail]   │  ← follows the mouse position
│                     │
│ 🎵 Clip — Song A    │
│ 2:48 · 9 shots  ▶   │
└─────────────────────┘
```

### Storage: a Clip is a folder

A Clip is built on board folders (`boardFolders.ts`, see `docs/modules.md`): a frame with `folder: true` plus a `clip` field holding the timeline (music `ref`, shots, framings, long lane, per-item settings). Its items live one level down, are parked in `stash` like any folder level, and are saved and shared through `sceneItems`. In collaboration the timeline travels as its own op key, so an older build shows the Clip as a plain folder.

### The Clip space is the presentation

Inside a Clip there is no separate 16:9 composition. Items stay where they are on the Clip's board; playback shows and hides them in place and moves a camera between areas.

### Timeline: shots, expandable

The timeline shows the music waveform and a lane of **shots**. A shot is a block of time that holds a camera framing and the set of items visible during that block.

A shot can be expanded to show its items as sub-bars. By default an item lasts the whole shot; it only gets a bar of its own when its entry or exit is offset inside the shot.

```
Music    ▁▃▅▇▅▃▁▃▅▇█▇▅▃▁▁▃▅▇▅▃
Shots    [ Intro   ][ Verse    ][ Drop ▾        ]
                                  ├ img1  ████████
                                  ├ img2     █████
                                  └ note     ██
```

### Long items lane

Items that span several shots live in a **Long** lane above the shots. A long item is a free bar with its own start and end that ignores shot boundaries; it defaults to the whole track.

An item belongs either to one shot or to the Long lane, never both. Dragging it from one lane to the other moves it.

```
Music    ▁▃▅▇▅▃▁▃▅▇█▇▅▃▁▁▃▅▇▅▃
Long        ████████████████████  palette
                    ████████████  main character
Shots    [ Intro   ][ Verse    ][ Drop         ]
```

### Pinning long items to the screen

A long item is placed **on the board** by default, so it leaves the frame when the camera moves elsewhere. It can instead be **pinned to the screen** (a corner position and a size relative to the frame), which keeps it visible through camera moves. On the board it keeps its real position for editing. Only long items can be pinned; shot items always stay on the board.

### Camera: start and end framing per shot

Each shot has a start framing and an end framing, both 16:9 rectangles placed on the board. The camera moves slowly from one to the other during the shot (slow zoom or pan). Identical framings give a static shot.

The transition between two shots is set on their boundary in the timeline: **Cut** (aligned to the beat) or **Glide** (adjustable duration).

### Editing view: board with a playhead

The timeline is docked under the board; both are visible at once. Moving the playhead shows the board as it is at that instant:

- items present at that time render normally;
- absent items render as **ghosts** (about 15 % opacity) and stay selectable — clicking a ghost offers "add to current shot";
- the start and end framings of the current shot are drawn on the board.

This lets the user edit without pressing play.

### Play versus Present

Two separate actions with separate jobs:

- **Play** in the editing view moves the playhead and updates ghosts, but the board view does not move: the camera rectangle glides over the board while the user keeps their working position. A **Follow camera** toggle makes the view track the camera when wanted.
- **Present** opens a full-screen render: only what the camera sees, black around it, no interface, Escape to leave. This is what is shown to someone else.

```
Editing + Play   → board fixed, camera rectangle glides, ghosts light up
Present          → full screen, final render, Escape to leave
```

```
┌──────────── board ─────────────┐
│  [img1]   ░img2░   ┌─frame─┐   │  ░ = ghost (absent at this time)
│        [note]      │       │   │
│  ░img3░            └───────┘   │
├────────── timeline ────────────┤
│ Long    ██████████████          │
│ Shots  [Intro][Verse│][Drop]    │  │ = playhead
└────────────────────────────────┘
```

### Video items during playback

By default a video item plays **muted** while it is visible, starting from the beginning of its trimmed range, and pauses when it leaves. The music is the only sound. When it appears again in a later shot it restarts from the beginning of its range, so every playback is identical. YouTube and embeds follow the same rule but cannot be synced precisely.

Each video item can override this:

- **Plays** or **Frozen** (a still frame);
- **Sound** on, with the music ducked under it (for a line of dialogue);
- **Speed**: a manual multiplier from ×0.25 to ×4, plus a **Fit to bar** button that computes the multiplier once so the trimmed range fills the item's bar. The multiplier then stays fixed when the bar changes; nothing changes speed without the user asking.

When a clip is shorter than its bar, it uses the loop types sequences already have (`playMode`): **Loop** (default), **Ping-pong**, or **Once** (then holds the last frame).

### Syncing shots to the music

The track is analysed locally (onset and beat detection in plain JS, no model) and a beat grid is drawn under the waveform. Shot boundaries snap to it; snapping can be turned off.

During playback, pressing **M** cuts a shot at the current time, so a whole breakdown can be tapped in one listen. Each tapped cut then snaps to the nearest beat. Detection is unreliable on tracks without clear percussion (ambient, orchestral); there the user turns snapping off and works by ear.

```
Music    ▁▃▅▇▅▃▁▃▅▇█▇▅▃▁▁▃▅▇▅▃
Beats    |   |   |   |   |   |   |   ← detected grid
Shots    [ Intro      ][ Verse    ]
                       ↑ snapped to a beat
```

## Video export (implemented)

**Export video** in the timeline toolbar writes an MP4 (H.264 + AAC) of what Present shows, at 720p to 4K and 24, 30 or 60 fps, faster than real time.

The frames are **painted by the renderer, not recomposed by an ffmpeg filter graph**: the board painter (`renderBoardCanvas`, the one behind the storyboard thumbnails and the image export) already draws every kind of item — notes, palettes, cards — the way the board does, while a filter graph would have to rasterise all of them anyway and redo the camera with `zoompan`, whose sub-pixel steps shake. Items that do not move are painted once at the sharpness the tightest framing needs, then only placed at each frame; videos are seeked frame by frame from a proxy cut to their range. The frames stream to the core as JPEG and ffmpeg encodes them with the probed hardware encoder, mixing the music (lowered where a video plays with its sound on) and those videos' sound. Real-time screen recording of Present stays rejected: slow, machine-dependent, and uncertain inside the WebView2 window.

## Storyboard mode (implemented)

A third mode, kept for a later version. It is a grid of thumbnails, one per shot, each showing what the camera sees, read like a comic strip. It gives an overview of the whole presentation at a glance and lets shots be reordered by dragging. It is a reading and ordering tool, not an editing one: framings and items are still edited in the board view.

```
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│ Intro  │ │ Verse  │ │ Pre    │ │ Drop   │
│ 0:00   │ │ 0:18   │ │ 0:42   │ │ 0:55   │
└────────┘ └────────┘ └────────┘ └────────┘
```

## Open questions

- A shared board has a single drawing layer at the top level: drawing inside a Clip in collaboration.
- Sharing the music file through collaboration media (today only the timeline is shared).
- The tile's shot posters are the first image of each shot, not a render of what the camera sees.
- Item appearance and disappearance fade with CSS transitions; the camera moves through the board's imperative view path (the one a pan uses), not through a React render per frame.

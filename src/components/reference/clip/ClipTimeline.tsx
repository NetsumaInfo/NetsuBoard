// Timeline docked under the board while an Animatic is open: a ruler, the music (waveform and beat
// grid), the Long lane, the shots (expandable into their items) and the playhead. It zooms with
// Ctrl+wheel and scrolls sideways; the playhead stays in view while playing. Every edit goes
// through the board store (`patchClip`), so it is saved, shared and undone like any other change.

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { nr } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useBoard } from "../useReferenceBoard";
import {
  addMark, addToShot, clipDuration, cutAt, formatTime, markIn, markOut, neighbourShotStart, nudgeCut, patchShot, pruneClip, shotIndexAt,
  snapPoints, snapTime, toLong, unassigned, type ClipData,
} from "./clipModel";
import { openClipId, openClipRaw, readClip } from "./clipSelectors";
import {
  framingFromView, previewShot, redetectBeats, seek, setClipMusic, setFollow, setLoop, setMusicVolume, setRate, startPresent, toggleMusicMute, togglePlay,
  useClipPlayer,
} from "./clipPlayer";
import { VolumeControl } from "../VolumeControl";
import { LABEL_W, Playhead, dragIsFree, Row, Ruler, TimeLabel, TipButton, Waveform, useTimeDrag } from "./timelineParts";
import { BlockMenu, FxMenu, ShotTransition, TempoMenu } from "./timelineMenus";
import { ClipStoryboard } from "./ClipStoryboard";
import { ExpandedRow, LongRow, ShotsRow, boardOrder } from "./timelineRows";
import { MarkLines, RulerMarks } from "./ClipMarks";
import { pasteShot, useShotClipboard } from "./clipClipboard";

const AUDIO_EXT = /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma|aiff?)$/i;
const ZOOM_MAX = 40;
const RATES = [1, 0.75, 0.5];
// Height of the tracks area, set by dragging the top edge of the timeline (this device only).
const HEIGHT_KEY = "netsuboard.animatic.height";
const HEIGHT_MIN = 72;
function readHeight(): number | null {
  try {
    const v = Number(localStorage.getItem(HEIGHT_KEY));
    return v >= HEIGHT_MIN ? v : null;
  } catch { return null; }
}

const typing = (el: EventTarget | null) => {
  const e = el as HTMLElement | null;
  return !!e && (e.isContentEditable || e.tagName === "INPUT" || e.tagName === "TEXTAREA" || e.tagName === "SELECT");
};

export function ClipTimeline() {
  const { t } = useTranslation("reference");
  const clipId = useBoard((s) => openClipId(s));
  const raw = useBoard((s) => openClipRaw(s));
  const items = useBoard((s) => s.items);
  const selectedIds = useBoard((s) => s.selectedIds);
  const readonly = useBoard((s) => s.collabRole === "viewer" && s.collabProjectId !== null);
  const playing = useClipPlayer((s) => s.playing);
  const follow = useClipPlayer((s) => s.follow);
  const analysing = useClipPlayer((s) => s.analysing);
  const expanded = useClipPlayer((s) => s.expanded);
  const library = useClipPlayer((s) => s.library);
  const musicError = useClipPlayer((s) => s.musicError);
  const folded = useClipPlayer((s) => s.folded);
  const loop = useClipPlayer((s) => s.loop);
  const storyboard = useClipPlayer((s) => s.storyboard);
  const musicVolume = useClipPlayer((s) => s.musicVolume);
  const musicMuted = useClipPlayer((s) => s.musicMuted);
  const rate = useClipPlayer((s) => s.rate);
  const copiedShot = useShotClipboard((s) => s.copied?.name ?? null);
  const shotAtHead = useClipPlayer((s) => {
    const c = readClip(raw);
    return c ? shotIndexAt(c, s.time) : 0;
  });

  const ids = useMemo(() => items.filter((it) => it.kind !== "draw").map((it) => it.id), [items]);
  const clip = useMemo(() => {
    const c = readClip(raw);
    return c ? pruneClip(c, new Set(ids)) : null;
  }, [raw, ids]);
  const byId = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);
  const outside = useMemo(() => (clip ? unassigned(clip, ids) : []), [clip, ids]);

  // Width of the visible track area, and the zoom that stretches the tracks past it.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState(0);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView(Math.max(1, el.clientWidth - LABEL_W - 8)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [clipId, folded, storyboard]);
  const width = view * zoom;
  // null = sized by its content, up to 40 % of the window.
  const [height, setHeight] = useState<number | null>(readHeight);
  const resize = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = (e.currentTarget.parentElement?.querySelector("[data-tracks]") as HTMLElement | null)?.offsetHeight ?? 200;
    const max = window.innerHeight * 0.75;
    let last = h0;
    const move = (ev: PointerEvent) => { last = Math.round(Math.min(max, Math.max(HEIGHT_MIN, h0 - (ev.clientY - y0)))); setHeight(last); };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try { localStorage.setItem(HEIGHT_KEY, String(last)); } catch { /* private window: the height lasts the session */ }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const autoHeight = () => {
    setHeight(null);
    try { localStorage.removeItem(HEIGHT_KEY); } catch { /* nothing stored */ }
  };
  const tracksStyle = height ? { height, maxHeight: "75vh" } : undefined;

  const dur = clip ? clipDuration(clip) : 1;
  const drag = useTimeDrag(width, dur);
  const commit = useCallback((next: ClipData, tag: string | null = null) => {
    if (clipId && !readonly) useBoard.getState().patchClip(clipId, next, { tag });
  }, [clipId, readonly]);
  const latest = useCallback(() => readClip(openClipRaw(useBoard.getState())), []);
  // Snapping reach: 6 screen pixels. A dragged edge sticks to beats, cuts and the playhead; a cut or
  // a mark made at the playhead sticks to beats only.
  const reach = Math.max(0.03, (6 / Math.max(1, width)) * dur);
  const snapT = useCallback((x: number, c: ClipData) =>
    (c.snap && !dragIsFree() ? snapTime(x, snapPoints(c, [useClipPlayer.getState().time]), reach) : x), [reach]);
  const snapBeat = useCallback((x: number, c: ClipData) => (c.snap ? snapTime(x, c.beats, reach) : x), [reach]);
  // The given items enter or leave at the playhead (snapped), with a line saying what happened.
  const markAt = useCallback((which: "in" | "out", ids: string[]) => {
    const c = latest();
    if (!c || !ids.length || !clipId) return;
    const at = snapBeat(useClipPlayer.getState().time, c);
    useBoard.getState().patchClip(clipId, which === "in" ? markIn(c, ids, at) : markOut(c, ids, at));
    useBoard.getState().setNotice({
      text: t(which === "in" ? "clip.markedIn" : "clip.markedOut", { count: ids.length, time: formatTime(at) }),
      kind: "ok",
    });
  }, [latest, snapBeat, clipId, t]);

  // Zoom around a time that stays under the same screen x.
  const zoomTo = useCallback((next: number, anchorTime?: number, anchorX?: number) => {
    const el = scrollRef.current;
    const z = Math.min(ZOOM_MAX, Math.max(1, next));
    if (!el) { setZoom(z); return; }
    const at = anchorTime ?? useClipPlayer.getState().time;
    const x = anchorX ?? el.clientWidth / 2;
    setZoom(z);
    requestAnimationFrame(() => { el.scrollLeft = (at / dur) * view * z + LABEL_W - x; });
  }, [dur, view]);

  // Keyboard: M cuts at the playhead, a short Space plays or pauses (a held Space still pans the
  // board), the arrows step between shots when nothing on the board is selected.
  useEffect(() => {
    if (!clipId) return;
    let spaceDown = false, spaceUsed = false;
    const onDown = (e: KeyboardEvent) => {
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey || useClipPlayer.getState().presenting) return;
      const c = latest();
      if (!c) return;
      if (e.code === "Space") { if (!e.repeat) { spaceDown = true; spaceUsed = false; } return; }
      if ((e.key === "m" || e.key === "M") && !readonly) {
        e.preventDefault();
        const next = cutAt(c, snapBeat(useClipPlayer.getState().time, c));
        if (next !== c) useBoard.getState().patchClip(clipId, next);
        return;
      }
      // I / O: the selected items enter or leave at the playhead, all at once.
      const k = e.key.toLowerCase();
      if ((k === "i" || k === "o") && !readonly) {
        const ids = useBoard.getState().selectedIds;
        if (!ids.length) return;
        e.preventDefault();
        markAt(k === "i" ? "in" : "out", ids);
        return;
      }
      if (k === "l") { e.preventDefault(); setLoop(!useClipPlayer.getState().loop); return; }
      // K: a mark on the music at the playhead.
      if (k === "k" && !readonly) {
        e.preventDefault();
        const next = addMark(c, snapBeat(useClipPlayer.getState().time, c));
        if (next !== c) useBoard.getState().patchClip(clipId, next);
        return;
      }
      if (e.key === "Home" || e.key === "End") { e.preventDefault(); seek(e.key === "Home" ? 0 : clipDuration(c)); return; }
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !useBoard.getState().selectedIds.length) {
        e.preventDefault();
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        // Shift: the cut nearest the playhead moves by one beat, and the playhead goes with it.
        if (e.shiftKey) {
          if (readonly) return;
          const r = nudgeCut(c, useClipPlayer.getState().time, dir);
          if (!r || r.clip === c) return;
          useBoard.getState().patchClip(clipId, r.clip, { tag: "clip-nudge" });
          seek(r.at + 0.001);
          return;
        }
        seek(neighbourShotStart(c, useClipPlayer.getState().time, dir) + 0.001);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !spaceDown) return;
      spaceDown = false;
      // A focused button takes its own Space (a click); playing on top of it would undo the click.
      const onButton = (e.target as HTMLElement | null)?.closest?.("button,[role=button],[role=menuitem]");
      if (!spaceUsed && !typing(e.target) && !onButton) {
        e.preventDefault();
        // Shift+Space: the shot under the playhead, once, from its start.
        if (e.shiftKey) previewShot(); else togglePlay();
      }
    };
    // A pointer pressed while Space is held is a pan, not a play.
    const onPointer = () => { if (spaceDown) spaceUsed = true; };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [clipId, readonly, snapBeat, latest, markAt]);

  // While playing, the playhead stays in view: the tracks page along when it nears the right edge.
  useEffect(() => useClipPlayer.subscribe((s) => {
    const el = scrollRef.current;
    if (!el || !s.playing || zoom === 1) return;
    const x = LABEL_W + (s.time / dur) * width;
    if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft + LABEL_W) el.scrollLeft = x - LABEL_W - 40;
  }), [dur, width, zoom]);

  if (!clipId || !clip) return null;

  const setMusic = (path: string) => (readonly ? Promise.resolve() : setClipMusic(path));
  const chooseMusic = async () => {
    const path = await nr.chooseAnyFile();
    if (path) await setMusic(path);
  };
  const dropMusic = async (e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer.files).filter((f) => AUDIO_EXT.test(f.name) || f.type.startsWith("audio/"));
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    const [path] = await nr.pathsForFiles(files.slice(0, 1));
    if (path) await setMusic(path);
  };
  const seekFrom = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    const at = ((e.clientX - r.left) / r.width) * dur;
    seek(at);
    drag(e, (dt) => seek(at + dt));
  };
  const frameHere = (which: "from" | "to" | "both") => {
    const r = framingFromView();
    const c = latest();
    if (!r || !c) return;
    const i = shotIndexAt(c, useClipPlayer.getState().time);
    commit(patchShot(c, i, which === "both" ? { from: r, to: r } : { [which]: r }));
  };
  const sel = selectedIds.filter((id) => byId.has(id));
  const expandedIndex = expanded ? clip.shots.findIndex((s) => s.id === expanded) : -1;
  const rowProps = { clip, width, dur, readonly, commit, latest, drag, snapT, byId, selectedIds };

  return (
    <div
      className="relative flex shrink-0 flex-col border-t border-border bg-[var(--color-surface)] text-xs select-none"
      onDragOver={(e) => { if (Array.from(e.dataTransfer.items).some((i) => i.kind === "file")) e.preventDefault(); }}
      onDrop={(e) => void dropMusic(e)}
    >
      {!folded && (
        <Tooltip>
          <TooltipTrigger
            render={
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label={t("clip.resize")}
                className="absolute inset-x-0 -top-1 z-40 h-2 cursor-ns-resize hover:bg-primary/40"
                onPointerDown={resize}
                onDoubleClick={autoHeight}
              />
            }
          />
          <TooltipContent side="top">{t("clip.resizeHint")}</TooltipContent>
        </Tooltip>
      )}
      <div className="flex h-10 items-center gap-1 px-2">
        {/* Editing tools scroll sideways when the window is narrow; the view controls and Present stay. */}
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:thin]">
          <TipButton label={`${playing ? t("clip.pause") : t("clip.play")} (${t("clip.keySpace")})`} onClick={togglePlay} active={playing}>
            <NetsuIcon name="play-pause" on={playing} />
          </TipButton>
          <TimeLabel dur={dur} />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={rate === 1 ? "ghost" : "secondary"} size="sm" className="w-12 shrink-0 px-1 tabular-nums"
                  aria-label={t("clip.rate")}
                  onClick={() => setRate(RATES[(RATES.indexOf(useClipPlayer.getState().rate) + 1) % RATES.length])}
                />
              }
            >
              ×{rate.toLocaleString()}
            </TooltipTrigger>
            <TooltipContent side="top">{t("clip.rateHint")}</TooltipContent>
          </Tooltip>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="sm" className="max-w-56 gap-1.5" onClick={() => void chooseMusic()} disabled={readonly} />}>
              <NetsuIcon name="music" />
              <span className="truncate">{clip.music?.name ?? t("clip.addMusic")}</span>
            </TooltipTrigger>
            <TooltipContent side="top">{clip.music ? t("clip.changeMusic") : t("clip.addMusicHint")}</TooltipContent>
          </Tooltip>
          {analysing && <Spinner className="size-3.5" />}
          {clip.music && <VolumeControl volume={musicVolume} muted={musicMuted} onVolume={setMusicVolume} onToggleMute={toggleMusicMute} />}
          {musicError && clip.music && (
            <span role="alert" className="flex shrink-0 items-center gap-1 text-destructive">
              <NetsuIcon name="warning" className="size-3.5" /> {t("clip.musicError")}
            </span>
          )}
          <TipButton
            label={clip.bpm ? t("clip.snapBpm", { bpm: Math.round(clip.bpm) }) : t("clip.snap")}
            active={clip.snap}
            disabled={readonly}
            onClick={() => commit({ ...clip, snap: !clip.snap })}
          >
            <NetsuIcon name="snap" />
          </TipButton>
          <TempoMenu
            clip={clip} commit={commit} readonly={readonly} playing={playing} onDetect={redetectBeats}
            time={() => useClipPlayer.getState().time}
          />
          <Separator orientation="vertical" className="mx-1 h-5" />
          <TipButton label={t("clip.cut")} onClick={() => { const c = latest(); if (c) commit(cutAt(c, snapBeat(useClipPlayer.getState().time, c))); }} disabled={readonly}>
            <NetsuIcon name="cut" />
          </TipButton>
          <TipButton label={t("clip.addToShot")} disabled={readonly || !sel.length} onClick={() => { const c = latest(); if (c) commit(addToShot(c, shotIndexAt(c, useClipPlayer.getState().time), sel)); }}>
            <NetsuIcon name="add" />
          </TipButton>
          <TipButton label={t("clip.toLong")} disabled={readonly || !sel.length} onClick={() => { const c = latest(); if (c) commit(toLong(c, sel)); }}>
            <NetsuIcon name="lane-long" />
          </TipButton>
          <TipButton label={t("clip.markIn")} disabled={readonly || !sel.length} onClick={() => markAt("in", sel)}>
            <NetsuIcon name="mark-in" />
          </TipButton>
          <TipButton label={t("clip.markOut")} disabled={readonly || !sel.length} onClick={() => markAt("out", sel)}>
            <NetsuIcon name="mark-out" />
          </TipButton>
          {!readonly && <FxMenu clip={clip} ids={sel} commit={commit} />}
          <Popover>
            <PopoverTrigger render={<Button variant="ghost" size="sm" className="gap-1.5" disabled={readonly} />}>
              <NetsuIcon name="framing" /> {t("clip.framing")}
            </PopoverTrigger>
            <PopoverContent side="top" className="w-60 p-1.5">
              <div className="px-2 pb-1 pt-1 text-[11px] text-muted-foreground">{t("clip.framingHint")}</div>
              <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => frameHere("both")}>{t("clip.frameBoth")}</Button>
              <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => frameHere("from")}>{t("clip.frameStart")}</Button>
              <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => frameHere("to")}>{t("clip.frameEnd")}</Button>
            </PopoverContent>
          </Popover>
          <ShotTransition clip={clip} index={shotAtHead} readonly={readonly} commit={commit} />
          <BlockMenu
            clip={clip}
            commit={commit}
            readonly={readonly}
            time={() => useClipPlayer.getState().time}
            picked={boardOrder(sel, byId).map((id) => { const it = byId.get(id)!; return { id, box: { x: it.x, y: it.y, w: it.w, h: it.h } }; })}
          />
          {copiedShot !== null && !readonly && (
            <TipButton label={t("clip.pasteShot", { name: copiedShot })} onClick={() => pasteShot()}>
              <NetsuIcon name="paste" />
            </TipButton>
          )}
          {outside.length > 0 && !readonly && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline" size="sm" className="shrink-0 gap-1.5 border-dashed"
                    onClick={() => { const c = latest(); if (c) commit(addToShot(c, shotIndexAt(c, useClipPlayer.getState().time), outside)); }}
                  />
                }
              >
                {t("clip.outside", { count: outside.length })}
              </TooltipTrigger>
              <TooltipContent side="top">{t("clip.outsideHint")}</TooltipContent>
            </Tooltip>
          )}
        </div>
        {!folded && !storyboard && (
          <>
            <TipButton label={t("clip.zoomOut")} disabled={zoom <= 1} onClick={() => zoomTo(zoom / 1.6)}>
              <NetsuIcon name="zoom-out" />
            </TipButton>
            <TipButton label={t("clip.zoomIn")} disabled={zoom >= ZOOM_MAX} onClick={() => zoomTo(zoom * 1.6)}>
              <NetsuIcon name="zoom-in" />
            </TipButton>
          </>
        )}
        <TipButton label={t("clip.loop")} active={loop} onClick={() => setLoop(!loop)}>
          <NetsuIcon name="seq-loop-mode-loop" />
        </TipButton>
        <TipButton label={t(storyboard ? "clip.showLanes" : "clip.storyboard")} active={storyboard} onClick={() => useClipPlayer.setState({ storyboard: !storyboard, folded: false })}>
          <NetsuIcon name="storyboard" />
        </TipButton>
        <TipButton label={t("clip.library")} active={library} onClick={() => useClipPlayer.setState({ library: !library })}>
          <NetsuIcon name="gallery" />
        </TipButton>
        <TipButton label={t("clip.follow")} active={follow} onClick={() => setFollow(!follow)}>
          <NetsuIcon name="camera-follow" on={follow} />
        </TipButton>
        <TipButton label={t(folded ? "clip.showTimeline" : "clip.hideTimeline")} onClick={() => useClipPlayer.setState({ folded: !folded })}>
          <NetsuIcon name="chevron-toggle" on={!folded} />
        </TipButton>
        <div className="flex shrink-0">
          <Button size="sm" className="gap-1.5 rounded-r-none" onClick={() => startPresent()}>
            <NetsuIcon name="monitor-play" /> {t("clip.present")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="sm" className="rounded-l-none border-l border-primary-foreground/20 px-1.5" aria-label={t("clip.presentFrom")} />}>
              <NetsuIcon name="chevron-down" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top">
              <DropdownMenuItem onClick={() => startPresent()}>{t("clip.presentStart")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => startPresent(useClipPlayer.getState().time)}>{t("clip.presentHere")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { const c = latest(); if (c) startPresent(c.shots[shotIndexAt(c, useClipPlayer.getState().time)].start); }}>
                {t("clip.presentShot")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {!folded && storyboard && (
        <div data-tracks className={cn("overflow-y-auto border-t border-border/50", !height && "max-h-[45vh]")} style={tracksStyle}>
          <ClipStoryboard clip={clip} items={items} readonly={readonly} commit={commit} shotAtHead={shotAtHead} />
        </div>
      )}
      {!folded && !storyboard && (
        <div
          ref={scrollRef}
          data-tracks
          className={cn("relative overflow-auto pb-2", !height && "max-h-[40vh]")}
          style={tracksStyle}
          onWheel={(e) => {
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            const el = scrollRef.current!;
            const x = e.clientX - el.getBoundingClientRect().left;
            const at = ((el.scrollLeft + x - LABEL_W) / Math.max(1, width)) * dur;
            zoomTo(zoom * (e.deltaY < 0 ? 1.25 : 0.8), Math.min(dur, Math.max(0, at)), x);
          }}
        >
          <div className="relative" style={{ width: LABEL_W + width + 8 }}>
            <Row label="" width={width}>
              <div
                className="relative"
                onPointerDown={seekFrom}
                onDoubleClick={(e) => {
                  if (readonly) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  const c = latest();
                  if (c) commit(addMark(c, snapT(((e.clientX - r.left) / r.width) * dur, c)));
                }}
              >
                <Ruler dur={dur} width={width} />
                <RulerMarks {...rowProps} />
              </div>
            </Row>
            <Row label={t("clip.music")} width={width}>
              <div className="relative h-12 cursor-text" onPointerDown={seekFrom}>
                <Waveform clip={clip} width={width} scroller={scrollRef} />
                {!clip.music && (
                  <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-muted-foreground">{t("clip.noMusic")}</span>
                )}
              </div>
            </Row>
            <Row label={t("clip.long")} width={width}><LongRow {...rowProps} /></Row>
            <Row label={t("clip.shots")} width={width}><ShotsRow {...rowProps} shotAtHead={shotAtHead} items={items} /></Row>
            {expandedIndex >= 0 && (
              <Row label={clip.shots[expandedIndex].label || t("clip.shotN", { n: expandedIndex + 1 })} width={width}>
                <ExpandedRow {...rowProps} index={expandedIndex} />
              </Row>
            )}
            <MarkLines clip={clip} width={width} dur={dur} />
            <Playhead dur={dur} width={width} />
          </div>
          <p className="sticky left-0 px-2 pt-1 text-[10px] text-muted-foreground">{t("clip.keysHint")}</p>
        </div>
      )}
    </div>
  );
}

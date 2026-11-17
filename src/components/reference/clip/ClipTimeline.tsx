// Timeline docked under the board while an Animatic is open: a ruler, the music (waveform and beat
// grid), the Long lane, the shots (expandable into their items) and the playhead. It zooms with
// Ctrl+wheel and scrolls sideways; the playhead stays in view while playing. Every edit goes
// through the board store (`patchClip`), so it is saved, shared and undone like any other change.

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { nr } from "@/lib/bridge";
import { Button } from "@/components/ui/button";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useBoard } from "../useReferenceBoard";
import {
  addToShot, clipDuration, cutAt, formatTime, markIn, markOut, neighbourShotStart, patchShot, pruneClip, shotIndexAt,
  snapTime, toLong, unassigned, type ClipData,
} from "./clipModel";
import { openClipId, openClipRaw, readClip } from "./clipSelectors";
import { framingFromView, seek, setClipMusic, setFollow, setLoop, startPresent, togglePlay, useClipPlayer } from "./clipPlayer";
import { LABEL_W, Playhead, Row, Ruler, TimeLabel, TipButton, Waveform, useTimeDrag } from "./timelineParts";
import { BlockMenu, FxMenu, ShotTransition } from "./timelineMenus";
import { ClipStoryboard } from "./ClipStoryboard";
import { ExpandedRow, LongRow, ShotsRow, boardOrder } from "./timelineRows";

const AUDIO_EXT = /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma|aiff?)$/i;
const ZOOM_MAX = 40;

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

  const dur = clip ? clipDuration(clip) : 1;
  const drag = useTimeDrag(width, dur);
  const commit = useCallback((next: ClipData, tag: string | null = null) => {
    if (clipId && !readonly) useBoard.getState().patchClip(clipId, next, { tag });
  }, [clipId, readonly]);
  const latest = useCallback(() => readClip(openClipRaw(useBoard.getState())), []);
  const snapT = useCallback((x: number, c: ClipData) =>
    (c.snap ? snapTime(x, c.beats, Math.max(0.03, (6 / Math.max(1, width)) * dur)) : x), [dur, width]);
  // The given items enter or leave at the playhead (snapped), with a line saying what happened.
  const markAt = useCallback((which: "in" | "out", ids: string[]) => {
    const c = latest();
    if (!c || !ids.length || !clipId) return;
    const at = snapT(useClipPlayer.getState().time, c);
    useBoard.getState().patchClip(clipId, which === "in" ? markIn(c, ids, at) : markOut(c, ids, at));
    useBoard.getState().setNotice({
      text: t(which === "in" ? "clip.markedIn" : "clip.markedOut", { count: ids.length, time: formatTime(at) }),
      kind: "ok",
    });
  }, [latest, snapT, clipId, t]);

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
        const next = cutAt(c, snapT(useClipPlayer.getState().time, c));
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
      if (e.key === "Home" || e.key === "End") { e.preventDefault(); seek(e.key === "Home" ? 0 : clipDuration(c)); return; }
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !useBoard.getState().selectedIds.length) {
        e.preventDefault();
        seek(neighbourShotStart(c, useClipPlayer.getState().time, e.key === "ArrowLeft" ? -1 : 1) + 0.001);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !spaceDown) return;
      spaceDown = false;
      // A focused button takes its own Space (a click); playing on top of it would undo the click.
      const onButton = (e.target as HTMLElement | null)?.closest?.("button,[role=button],[role=menuitem]");
      if (!spaceUsed && !typing(e.target) && !onButton) { e.preventDefault(); togglePlay(); }
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
  }, [clipId, readonly, snapT, latest]);

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
      <div className="flex h-10 items-center gap-1 overflow-x-auto px-2">
        <TipButton label={`${playing ? t("clip.pause") : t("clip.play")} (${t("clip.keySpace")})`} onClick={togglePlay} active={playing}>
          <NetsuIcon name="play-pause" on={playing} />
        </TipButton>
        <TimeLabel dur={dur} />
        <Separator orientation="vertical" className="mx-1 h-5" />
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="sm" className="max-w-56 gap-1.5" onClick={() => void chooseMusic()} disabled={readonly} />}>
            <NetsuIcon name="music" />
            <span className="truncate">{clip.music?.name ?? t("clip.addMusic")}</span>
          </TooltipTrigger>
          <TooltipContent side="top">{clip.music ? t("clip.changeMusic") : t("clip.addMusicHint")}</TooltipContent>
        </Tooltip>
        {analysing && <Spinner className="size-3.5" />}
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
        <Separator orientation="vertical" className="mx-1 h-5" />
        <TipButton label={t("clip.cut")} onClick={() => { const c = latest(); if (c) commit(cutAt(c, snapT(useClipPlayer.getState().time, c))); }} disabled={readonly}>
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
        <div className="flex-1" />
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
        <Button size="sm" className="shrink-0 gap-1.5" onClick={() => startPresent()}>
          <NetsuIcon name="monitor-play" /> {t("clip.present")}
        </Button>
      </div>

      {!folded && storyboard && (
        <div className="max-h-[45vh] overflow-y-auto border-t border-border/50">
          <ClipStoryboard clip={clip} items={items} readonly={readonly} commit={commit} shotAtHead={shotAtHead} />
        </div>
      )}
      {!folded && !storyboard && (
        <div
          ref={scrollRef}
          className="relative max-h-[40vh] overflow-auto pb-2"
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
              <div onPointerDown={seekFrom}><Ruler dur={dur} width={width} /></div>
            </Row>
            <Row label={t("clip.music")} width={width}>
              <div className="relative h-12 cursor-text" onPointerDown={seekFrom}>
                <Waveform clip={clip} width={width} />
                {!clip.music && (
                  <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-muted-foreground">{t("clip.noMusic")}</span>
                )}
              </div>
            </Row>
            <Row label={t("clip.long")} width={width}><LongRow {...rowProps} /></Row>
            <Row label={t("clip.shots")} width={width}><ShotsRow {...rowProps} shotAtHead={shotAtHead} /></Row>
            {expandedIndex >= 0 && (
              <Row label={clip.shots[expandedIndex].label || t("clip.shotN", { n: expandedIndex + 1 })} width={width}>
                <ExpandedRow {...rowProps} index={expandedIndex} />
              </Row>
            )}
            <Playhead dur={dur} width={width} />
          </div>
          <p className="sticky left-0 px-2 pt-1 text-[10px] text-muted-foreground">{t("clip.keysHint")}</p>
        </div>
      )}
    </div>
  );
}

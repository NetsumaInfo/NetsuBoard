// Glue between the live card and the native webview (src-tauri/src/livesite.rs).
//
// The native view is NOT part of the DOM: it floats above the whole window, so this component keeps
// it glued to the card's on-screen rectangle (read from the card element itself, which already
// carries the board's pan/zoom transform) and renders the small toolbar as ordinary DOM just
// outside the card, where the native view does not cover it. Sync is event driven (style mutations
// of the pan layer and of the card, resizes, store changes) and throttled to one rAF; nothing here
// animates.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import { useTranslation } from "react-i18next";
import { nr, type LiveSiteInfo, type LiveSiteRect } from "@/lib/bridge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useBoard } from "./useReferenceBoard";
import { IconAction } from "./inspectorControls";
import { captureLiveShot, getLiveId, stopLive, useLiveId } from "./liveSite";
import { hostMatches, hostOf, loadAllowlist, normalizeNavUrl, saveAllowlist, toggleAllowed } from "./liveSiteUrl";
import { linkMode } from "./LinkCard";

// The page stays inside the card's border so the card can still be grabbed and resized.
const INSET = 6;
const BAR_H = 36;
// Overlays that must stay above the page: while one is open the native view is hidden.
const OVERLAY = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]';

const same = (a: LiveSiteRect | null, b: LiveSiteRect) =>
  !!a && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

export function LiveSiteLayer({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  const id = useLiveId();
  const barRef = useRef<HTMLDivElement>(null);
  const url = useBoard((s) => (id ? s.items.find((it) => it.id === id)?.ref : undefined));

  const openInBrowser = useCallback(async () => {
    const current = (await nr.liveSite.url()) || url;
    if (current) void nr.openExternal(current);
  }, [url]);

  useEffect(() => {
    if (!id || !url) return;
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let opened = false;
    let shown = true;
    let sent: LiveSiteRect | null = null;
    let wanted: LiveSiteRect | null = null;
    let inflight = false;
    let raf: number | null = null;

    const leave = () => { void stopLive(); };

    const flush = () => {
      if (inflight || !opened || !wanted || same(sent, wanted)) return;
      const next = wanted;
      sent = next;
      inflight = true;
      void nr.liveSite.bounds(next).catch(() => undefined).finally(() => { inflight = false; flush(); });
    };

    const setShown = (on: boolean) => {
      if (!opened || shown === on) return;
      shown = on;
      void nr.liveSite.visible(on).catch(() => undefined);
    };

    // Card rectangle in viewport (= window client) pixels, or null when the card is gone.
    const measure = () => {
      const el = container.querySelector<HTMLElement>(`[data-board-item="${CSS.escape(id)}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const c = container.getBoundingClientRect();
      const rect: LiveSiteRect = {
        x: Math.round(r.left + INSET),
        y: Math.round(r.top + INSET),
        w: Math.max(1, Math.round(r.width - INSET * 2)),
        h: Math.max(1, Math.round(r.height - INSET * 2)),
      };
      // The native view cannot be clipped to the board: show it only while the whole card is inside.
      const inside = r.left >= c.left && r.top >= c.top && r.right <= c.right && r.bottom <= c.bottom
        && r.width > 120 && r.height > 90;
      return { card: r, area: c, rect, inside };
    };

    const place = () => {
      raf = null;
      if (disposed) return;
      const m = measure();
      if (!m) { leave(); return; }
      wanted = m.rect;
      flush();
      setShown(m.inside && !document.querySelector(OVERLAY));
      const bar = barRef.current;
      if (bar) {
        const room = m.card.top - m.area.top >= BAR_H + 6;
        const top = room ? m.card.top - m.area.top - BAR_H - 4 : m.card.bottom - m.area.top + 4;
        const left = Math.max(4, Math.min(m.card.left - m.area.left, m.area.width - bar.offsetWidth - 4));
        bar.style.transform = `translate(${left}px, ${top}px)`;
        bar.style.visibility = m.inside ? "visible" : "hidden";
      }
    };
    const schedule = () => { if (raf == null && !disposed) raf = requestAnimationFrame(place); };

    // Open once the card has a rectangle.
    const first = measure();
    if (!first) { leave(); return; }
    void nr.liveSite.open(url, first.rect).then((ok) => {
      if (disposed) return;
      if (!ok) { leave(); return; }
      opened = true;
      sent = first.rect;
      schedule();
    }).catch(() => { if (!disposed) leave(); });

    // Sync sources.
    const mo = new MutationObserver(schedule);
    container.querySelectorAll("[data-board-pan]").forEach((el) => mo.observe(el, { attributes: true, attributeFilter: ["style"] }));
    const cardEl = container.querySelector(`[data-board-item="${CSS.escape(id)}"]`);
    if (cardEl) mo.observe(cardEl, { attributes: true, attributeFilter: ["style"] });
    const ro = new ResizeObserver(schedule);
    ro.observe(container);
    if (cardEl) ro.observe(cardEl);
    const overlays = new MutationObserver(schedule);
    overlays.observe(document.body, { childList: true });
    window.addEventListener("resize", schedule);

    // Leaving conditions: the card is no longer the one selected card, left live mode, or the board
    // moved on under it (note sheet, scene, folder).
    const startScene = useBoard.getState().sceneId;
    const startDepth = useBoard.getState().folderPath.length;
    const unsub = useBoard.subscribe((s, prev) => {
      const it = s.items.find((x) => x.id === id);
      if (
        !it || linkMode(it) !== "live" || s.selectedId !== id || s.selectedIds.length !== 1
        || s.noteOpenId != null || s.sceneId !== startScene || s.folderPath.length !== startDepth
      ) { leave(); return; }
      if (s.view !== prev.view || s.items !== prev.items) schedule();
    });

    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(OVERLAY)) leave(); };
    const onVisibility = () => { if (document.visibilityState === "hidden") leave(); };
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      if (raf != null) cancelAnimationFrame(raf);
      mo.disconnect(); ro.disconnect(); overlays.disconnect(); unsub();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      // Effect re-run or unmount while still live (hot reload, board unmounted): never leave a
      // native view orphaned above the window.
      if (getLiveId() === id) leave();
    };
  }, [id, url, containerRef]);

  if (!id) return null;
  return (
    <div
      ref={barRef}
      style={{ height: BAR_H, visibility: "hidden" }}
      className="absolute left-0 top-0 z-50 flex items-center gap-0.5 rounded-lg border border-border bg-popover/95 px-1 shadow-lg backdrop-blur"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <LiveBar id={id} fallbackUrl={url} onBrowser={() => { void openInBrowser(); }} />
    </div>
  );
}

// Toolbar content: navigation, editable address, ad-block shield, capture, done.
function LiveBar({ id, fallbackUrl, onBrowser }: { id: string; fallbackUrl?: string; onBrowser: () => void }) {
  const { t } = useTranslation("reference");
  const [info, setInfo] = useState<LiveSiteInfo | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [bad, setBad] = useState(false);
  const [allow, setAllow] = useState<string[]>(loadAllowlist);
  const [refreshing, setRefreshing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const current = info?.url || fallbackUrl || "";
  const host = hostOf(current);
  const siteAllowed = hostMatches(allow, host);
  const enabled = info?.enabled ?? true;
  const active = enabled && !siteAllowed;

  // The page lives in another process: poll its address, title, loading flag and block counter.
  useEffect(() => {
    let alive = true;
    const tick = () => { void nr.liveSite.info().then((i) => { if (alive && i) setInfo(i); }); };
    tick();
    const timer = window.setInterval(tick, 600);
    return () => { alive = false; window.clearInterval(timer); };
  }, [id]);

  // Rust filters with the allowlist the renderer owns.
  useEffect(() => { void nr.liveSite.allow(allow); }, [allow]);

  const startEdit = useCallback(() => {
    setDraft(current);
    setBad(false);
    setEditing(true);
    window.setTimeout(() => inputRef.current?.select(), 0);
  }, [current]);

  // Ctrl+L, like a browser (works while the focus is on the board or the toolbar).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        startEdit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startEdit]);

  const commit = () => {
    const next = normalizeNavUrl(draft);
    if (!next) { setBad(true); return; }
    setEditing(false);
    void nr.liveSite.goto(next);
  };

  const reload = () => { void nr.liveSite.nav("reload"); };
  const setSiteBlocking = (on: boolean) => {
    const next = toggleAllowed(allow, host, !on);
    setAllow(next);
    saveAllowlist(next);
    void nr.liveSite.allow(next).then(reload);
  };
  const setMaster = (on: boolean) => {
    void nr.adblock.setEnabled(on).then((st) => {
      if (st) setInfo((i) => (i ? { ...i, enabled: st.enabled, ready: st.ready } : i));
      reload();
    });
  };
  const refreshLists = () => {
    setRefreshing(true);
    void nr.adblock.refreshLists().then((st) => {
      if (st) setInfo((i) => (i ? { ...i, ready: st.ready } : i));
    }).finally(() => setRefreshing(false));
  };

  const title = info?.title?.trim();
  return (
    <>
      <IconAction label={t("linkCard.liveBack")} onClick={() => { void nr.liveSite.nav("back"); }}><NetsuIcon name="back" /></IconAction>
      <IconAction label={t("linkCard.liveForward")} onClick={() => { void nr.liveSite.nav("forward"); }}><NetsuIcon name="forward" /></IconAction>
      <IconAction label={t("linkCard.liveReload")} onClick={reload}>
        <NetsuIcon name="refresh" busy={!!info?.loading} />
      </IconAction>

      <div className="relative mx-0.5 w-64">
        {editing ? (
          <Input
            ref={inputRef}
            value={draft}
            autoFocus
            spellCheck={false}
            aria-label={t("linkCard.liveAddress")}
            aria-invalid={bad}
            className="h-7 px-2 text-xs md:text-xs"
            onChange={(e) => { setDraft(e.target.value); setBad(false); }}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commit();
              else if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={startEdit}
            aria-label={t("linkCard.liveAddress")}
            className="relative flex h-7 w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-md bg-muted/50 px-2 text-left text-xs hover:bg-muted"
          >
            <span className="min-w-0 truncate">
              {title ? <span className="font-medium text-foreground">{title}</span> : null}
              <span className="text-muted-foreground">{title ? "  " : ""}{host || current}</span>
            </span>
            {info?.loading && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary/70" />}
          </button>
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("linkCard.adblock")}
              className={cn("h-8 gap-1 px-1.5 tabular-nums", !active && "text-muted-foreground")}
            />
          }
        >
          <NetsuIcon name={active ? "shield-on" : "shield-off"} className={cn("size-4", active && "text-emerald-500")} />
          <span className="min-w-[1.25rem] text-xs font-medium">{active ? info?.blocked ?? 0 : 0}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom" className="w-72">
          <DropdownMenuLabel>
            {!enabled
              ? t("linkCard.adblockOff")
              : !info?.ready
                ? t("linkCard.adblockLoading")
                : t("linkCard.adblockBlocked", { count: info?.blocked ?? 0 })}
          </DropdownMenuLabel>
          <DropdownMenuCheckboxItem checked={enabled && !siteAllowed} disabled={!enabled || !host} onCheckedChange={setSiteBlocking}>
            {t("linkCard.adblockSite")}
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={enabled} onCheckedChange={setMaster}>
            {t("linkCard.adblockAll")}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={refreshLists} disabled={refreshing}>
            <NetsuIcon name="refresh" busy={refreshing} />
            {refreshing ? t("linkCard.adblockRefreshing") : t("linkCard.adblockRefresh")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <IconAction label={t("linkCard.liveBrowser")} onClick={onBrowser}><NetsuIcon name="open-external" /></IconAction>
      <IconAction label={t("linkCard.liveCapture")} onClick={() => { void captureLiveShot(id); }}><NetsuIcon name="capture" /></IconAction>
      <IconAction label={t("linkCard.liveDone")} onClick={() => { void stopLive(); }}><NetsuIcon name="check" /></IconAction>
    </>
  );
}

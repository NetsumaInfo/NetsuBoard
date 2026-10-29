// Live site controller. At most ONE card shows its real page at a time, through the native child
// webview of src-tauri/src/livesite.rs (performance: a second WebView2 process tree per card is not
// affordable). The renderer owns the lifecycle:
//   startLive(id)  → the previous live card (if any) is captured and closed first, then LiveSiteLayer
//                    opens the webview over this card and keeps it glued to the card.
//   stopLive()     → capture the page as PNG, store it as a board asset, keep it as `linkCard.shot`
//                    (the card's picture at rest, which also gives pictures to sites that block the
//                    link-preview fetcher), then destroy the webview.

import { useSyncExternalStore } from "react";
import i18n from "@/i18n";
import { nr } from "@/lib/bridge";
import { useBoard } from "./useReferenceBoard";
import { loadAllowlist } from "./liveSiteUrl";

let liveId: string | null = null;
// A card is about to become live (the previous page is still closing): no snapshot may start.
let starting = false;
let chain: Promise<void> = Promise.resolve();
const subs = new Set<() => void>();
const emit = () => subs.forEach((fn) => fn());

export const getLiveId = () => liveId;
export function useLiveId(): string | null {
  return useSyncExternalStore((fn) => { subs.add(fn); return () => { subs.delete(fn); }; }, () => liveId);
}

const stemOf = (id: string) => {
  const cur = useBoard.getState().items.find((it) => it.id === id);
  return (cur?.linkCard?.title || cur?.title || "site").replace(/[^\w.-]+/g, "-").slice(0, 40);
};

// PNG bytes → board asset → `linkCard.shot`. Never throws.
async function storeShot(id: string, png: ArrayBuffer, prefix: string): Promise<boolean> {
  try {
    if (!nr.reference?.saveAsset) return false;
    const st = useBoard.getState();
    if (!st.items.some((it) => it.id === id)) return false;
    const res = await nr.reference.saveAsset(png, "png", { projectPath: st.filePath || undefined, title: `${prefix}-${stemOf(id)}` });
    if (!res.ok || !res.path) return false;
    const now = useBoard.getState().items.find((it) => it.id === id);
    if (!now) return false;
    useBoard.getState().patchItem(id, { linkCard: { ...now.linkCard, shot: res.path, shotFailed: false } }, false);
    return true;
  } catch {
    return false;
  }
}

/** Screenshot of the live page → board asset → `linkCard.shot`. Never throws. */
export async function captureLiveShot(id: string): Promise<boolean> {
  try {
    const png = await nr.liveSite.capture();
    return png ? await storeShot(id, png, "live") : false;
  } catch {
    return false;
  }
}

// ── Background pictures ─────────────────────────────────────────────────────────────────────────
// A card whose site gave no picture (no og:image, or a bot wall such as Cloudflare) gets one from a
// hidden webview (livesite_snapshot). One at a time, never while a site is live; the queue resumes
// when the live card is closed.

const SNAP_W = 1280;
const SNAP_H = 800;
const snapQueue: string[] = [];
let snapRunning = false;

async function runSnapshots(): Promise<void> {
  if (snapRunning) return;
  snapRunning = true;
  try {
    while (snapQueue.length && liveId === null && !starting) {
      const id = snapQueue.shift()!;
      const it = useBoard.getState().items.find((x) => x.id === id);
      if (!it || !/^https?:/i.test(it.ref)) continue;
      let ok = false;
      try {
        await nr.liveSite.allow(loadAllowlist());
        const png = await nr.liveSite.snapshot(it.ref, SNAP_W, SNAP_H);
        ok = !!png && await storeShot(id, png, "snap");
      } catch { ok = false; }
      if (!ok) {
        const cur = useBoard.getState().items.find((x) => x.id === id);
        if (cur) useBoard.getState().patchItem(id, { linkCard: { ...cur.linkCard, shotFailed: true } }, false);
      }
    }
  } finally {
    snapRunning = false;
  }
}

/** Takes a background picture of the card's page (once queued, runs when nothing else is). */
export function queueShot(id: string): void {
  if (!nr.liveSite.available || snapQueue.includes(id)) return;
  snapQueue.push(id);
  void runSnapshots();
}

/** "Refresh picture": a new background screenshot, whatever the card already has. */
export function refreshShot(id: string): void {
  const cur = useBoard.getState().items.find((x) => x.id === id);
  if (!cur) return;
  if (cur.linkCard?.shotFailed) useBoard.getState().patchItem(id, { linkCard: { ...cur.linkCard, shotFailed: false } }, false);
  queueShot(id);
}

/** Picture for a card that has none yet; skipped when one exists or an earlier try failed. */
export function ensureShot(item: { id: string; linkCard?: { image?: string; shot?: string; shotFailed?: boolean; fetched?: boolean } }): void {
  const c = item.linkCard;
  if (!c?.fetched || c.image || c.shot || c.shotFailed) return;
  queueShot(item.id);
}

async function finish(id: string) {
  try {
    await captureLiveShot(id);
  } finally {
    await nr.liveSite.close();
  }
}

/** Leaves live mode: capture, then close. Resolves once the webview is gone. */
export function stopLive(): Promise<void> {
  const id = liveId;
  if (!id) return chain;
  liveId = null;
  emit();
  chain = chain.then(() => finish(id)).catch(() => undefined).then(() => { void runSnapshots(); });
  return chain;
}

/** Makes `id` the live card; the previous one is captured and closed first. */
export function startLive(id: string): void {
  if (liveId === id) return;
  if (!nr.liveSite.available) {
    useBoard.getState().setNotice({ kind: "error", text: i18n.t("reference:linkCard.liveUnavailable") });
    return;
  }
  starting = true;
  void stopLive();
  chain = chain.then(() => {
    starting = false;
    // Someone else may have taken over while the previous page was being closed.
    if (liveId !== null) return;
    liveId = id;
    emit();
  });
}

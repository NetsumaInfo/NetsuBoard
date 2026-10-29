// A web link on the board, shown three ways: a compact line (icon + title), a preview card (the
// site's image, title and description), or the live embed. The page details are fetched once from
// the core (reference:linkMeta) and kept on the item, so the card reads offline and is shared as is.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import { nr } from "@/lib/bridge";
import { useBoard } from "./useReferenceBoard";
import { ensureShot } from "./liveSite";
import { hostOf } from "./liveSiteUrl";
import { parseVideoEmbed, displaySrc, type BoardItem, type LinkCard as LinkCardData } from "./referenceShared";

export type LinkMode = NonNullable<LinkCardData["mode"]>;

// Mode shown when the item never picked one: players stay live, any other page becomes a preview
// card — most sites refuse to be framed and an embed of them is a blank box.
export function linkMode(item: BoardItem): LinkMode {
  if (item.linkCard?.mode) return item.linkCard.mode;
  return (parseVideoEmbed(item.ref, true)?.provider ?? "generic") === "generic" ? "preview" : "embed";
}

// Size a card takes when it switches mode, so a line does not keep the height of a player.
export const LINK_MODE_SIZE: Record<LinkMode, { w: number; h: number } | null> = {
  link: { w: 340, h: 60 },
  preview: { w: 360, h: 300 },
  embed: null,
  live: { w: 640, h: 480 },
};

const pending = new Set<string>();

// Fetches the page details once per item and keeps them on it.
function useLinkMeta(item: BoardItem) {
  const has = !!item.linkCard?.fetched;
  useEffect(() => {
    if (has || pending.has(item.id) || !/^https?:/i.test(item.ref)) return;
    pending.add(item.id);
    void Promise.resolve(nr.reference?.linkMeta?.(item.ref))
      .then((res) => {
        const meta = res?.ok ? res.meta : null;
        const cur = useBoard.getState().items.find((it) => it.id === item.id);
        if (!cur) return;
        useBoard.getState().patchItem(item.id, {
          linkCard: {
            ...cur.linkCard,
            mode: cur.linkCard?.mode ?? linkMode(cur),
            fetched: true,
            title: meta?.title || undefined,
            description: meta?.description || undefined,
            image: meta?.image || undefined,
            siteName: meta?.siteName || undefined,
            favicon: meta?.favicon || undefined,
          },
        }, false);
      })
      .catch(() => undefined)
      .finally(() => pending.delete(item.id));
  }, [has, item.id, item.ref]);
}

function Favicon({ src, className = "size-4" }: { src?: string; className?: string }) {
  return src
    ? <img src={src} alt="" draggable={false} className={`${className} shrink-0 rounded-sm`} />
    : <NetsuIcon name="web" className={`${className} shrink-0 text-muted-foreground`} />;
}

export function LinkCardContent({ item, mode }: { item: BoardItem; mode: Exclude<LinkMode, "embed"> }) {
  const { t } = useTranslation("reference");
  useLinkMeta(item);
  const card = item.linkCard;
  const host = hostOf(item.ref);
  const title = card?.title || item.title || host;
  // The site's own picture failed to load (dead link, hotlink block): fall back to a screenshot.
  const [imageFailed, setImageFailed] = useState(false);

  // A card with no picture asks for a background screenshot (queued, one at a time).
  const needsShot = mode !== "link" && !!card?.fetched && (!card.image || imageFailed) && !card.shot && !card.shotFailed;
  useEffect(() => { if (needsShot) ensureShot({ id: item.id, linkCard: { fetched: true } }); }, [needsShot, item.id]);

  if (mode === "link") {
    return (
      <div className="flex h-full w-full items-center gap-2.5 overflow-hidden rounded-lg border border-border bg-[var(--color-surface)] px-3 shadow-md">
        <Favicon src={card?.favicon} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{title}</p>
          <p className="truncate text-[11px] text-muted-foreground">{host}</p>
        </div>
      </div>
    );
  }

  const live = mode === "live";
  const shot = card?.shot ? displaySrc("image", card.shot) : undefined;
  const cover = live ? (shot ?? (imageFailed ? undefined : card?.image)) : ((card?.image && !imageFailed ? card.image : undefined) ?? shot);
  const coverIsShot = !!cover && cover === shot;

  return (
    <div className="group/link flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-[var(--color-surface)] shadow-lg">
      <div className="relative min-h-0 w-full flex-1 overflow-hidden bg-muted/40">
        {cover ? (
          <img
            src={cover}
            alt=""
            draggable={false}
            onError={() => { if (!coverIsShot) setImageFailed(true); }}
            className={`pointer-events-none size-full object-cover ${coverIsShot ? "object-top" : "object-center"}`}
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            <NetsuIcon name="web" className="size-10 text-muted-foreground/60" />
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/45 to-transparent" />
        <span className="pointer-events-none absolute left-2 top-2 flex max-w-[75%] items-center gap-1.5 rounded-full bg-black/55 py-0.5 pl-1 pr-2 text-[11px] font-medium text-white backdrop-blur-sm">
          <Favicon src={card?.favicon} className="size-3.5" />
          <span className="truncate">{host}</span>
        </span>
        {live && (
          <span className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 rounded-full bg-primary/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
            <NetsuIcon name="monitor-play" className="size-3" />
            {t("linkCard.siteBadge")}
          </span>
        )}
        {live && (
          <span className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center opacity-0 transition-opacity group-hover/link:opacity-100">
            <span className="rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-medium text-white">{t("linkCard.liveHint")}</span>
          </span>
        )}
      </div>
      <div className="shrink-0 space-y-1 px-3 py-2.5">
        <p className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">{title}</p>
        {card?.description && <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">{card.description}</p>}
      </div>
    </div>
  );
}

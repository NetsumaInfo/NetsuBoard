// Pastille d'état d'un board partagé, dans la barre d'outils. Qui est là, ce qui reste à faire.
//
// La présence affichée est celle que cette machine a OBSERVÉE : la dernière fois qu'elle a réussi à
// joindre un appareil de la personne (`service.rs#member_presence`). Rien n'est diffusé pour ça et
// aucun trafic n'est créé — les échanges ont lieu de toute façon. C'est pour ça que le libellé dit
// « vu il y a… » et non « hors ligne » : une personne que l'on n'a pas jointe n'est pas forcément
// absente, elle peut être injoignable depuis ici. Affirmer plus serait mentir.
//
// Monté seulement sur un board partagé, et derrière un import lazy : la chaîne convex/react ne doit
// pas entrer dans le bundle de démarrage (cf. src/lib/convexEnv.ts).

import { useTranslation } from "react-i18next";
import { useQuery } from "convex/react";
import { AlertTriangle, Check, RefreshCw, UserRound, Users } from "lucide-react";
import { api } from "@/lib/convexApi";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBoard } from "./useReferenceBoard";

type Profile = { userId: string; handle: string; name: string; image: string | null };
type Details = {
  members: Array<Profile & { role: "owner" | "editor" | "viewer" }>;
  pending: Array<Profile & { inviteId: string }>;
} | null | undefined;

// Au-delà, on ne dit plus « en ligne » : le dernier échange remonte à trop longtemps pour l'affirmer.
const ONLINE_MS = 90_000;

function Avatar({ url, online }: { url: string | null; online: boolean }) {
  return (
    <span className="relative shrink-0">
      {url ? (
        <img src={url} alt="" className="size-6 rounded-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <span className="flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <UserRound className="size-3.5" />
        </span>
      )}
      <span
        className={cn(
          "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-popover",
          online ? "bg-[var(--color-ok)]" : "bg-muted-foreground/40",
        )}
      />
    </span>
  );
}

export function CollabStatus() {
  const { t } = useTranslation("reference");
  const projectId = useBoard((state) => state.collabProjectId);
  const members = useBoard((state) => state.collabMembers);
  const queued = useBoard((state) => state.collabOfflineQueued);
  const rotationRequired = useBoard((state) => state.collabRotationRequired);
  const role = useBoard((state) => state.collabRole);
  const details = useQuery(
    api.projects.getProjectDetails,
    projectId ? { projectId, now: 0 } : "skip",
  ) as Details;

  if (!projectId) return null;

  const profiles = new Map((details?.members ?? []).map((member) => [member.userId, member]));
  const seen = members.map((member) => ({
    ...member,
    profile: profiles.get(member.userId),
    online: member.lastSeenMs != null && member.lastSeenMs < ONLINE_MS,
  }));
  const onlineCount = seen.filter((member) => member.online).length;
  // Un ordre stable et utile : les personnes présentes d'abord, puis celles vues le plus récemment.
  seen.sort((left, right) =>
    Number(right.online) - Number(left.online)
    || (left.lastSeenMs ?? Infinity) - (right.lastSeenMs ?? Infinity));
  const waitingForKey = seen.filter((member) => !member.hasKey);
  const pending = details?.pending ?? [];

  const ago = (ms?: number | null) => {
    if (ms == null) return t("collab.panel.neverSeen");
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 60) return t("collab.panel.seenMinutes", { count: Math.max(1, minutes) });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("collab.panel.seenHours", { count: hours });
    return t("collab.panel.seenDays", { count: Math.floor(hours / 24) });
  };

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-label={t("collab.panel.title")}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                />
              }
            />
          }
        >
          <Users className="size-3.5" />
          <span className={onlineCount ? "text-[var(--color-ok)]" : undefined}>{onlineCount}</span>
          {(queued || rotationRequired) && (
            <span className="size-1.5 rounded-full bg-amber-500" />
          )}
        </TooltipTrigger>
        <TooltipContent>{t("collab.panel.title")}</TooltipContent>
      </Tooltip>

      <PopoverContent align="end" className="w-72 p-0">
        <div className="border-b border-border px-3 py-2">
          <p className="text-sm font-medium">{t("collab.panel.title")}</p>
          <p className="text-xs text-muted-foreground">
            {t(`collab.role.${role ?? "editor"}`)}
            {" · "}
            {t("collab.panel.online", { count: onlineCount })}
          </p>
        </div>

        <div className="max-h-56 divide-y divide-border overflow-y-auto px-3">
          {seen.length === 0 && (
            <p className="py-3 text-xs text-muted-foreground">{t("collab.panel.alone")}</p>
          )}
          {seen.map((member) => (
            <div key={member.userId} className="flex items-center gap-2.5 py-2">
              <Avatar url={member.profile?.image ?? null} online={member.online} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs">
                  {member.profile?.name || member.profile?.handle || t("collab.panel.unknownMember")}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {member.online ? t("collab.panel.hereNow") : ago(member.lastSeenMs)}
                  {!member.canWrite ? ` · ${t("collab.role.viewer")}` : ""}
                </p>
              </div>
            </div>
          ))}
          {pending.map((invited) => (
            <div key={invited.inviteId} className="flex items-center gap-2.5 py-2 opacity-60">
              <Avatar url={invited.image} online={false} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs">{invited.name || invited.handle}</p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {t("collab.panel.invited")}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Ce qui reste à faire, et par QUI : une attente que personne ne peut lever n'est pas une
            information, c'est une inquiétude. */}
        <div className="space-y-1.5 border-t border-border px-3 py-2 text-xs">
          {/* « Tout est synchronisé » ne vaut que si quelqu'un a pu recevoir : personne en ligne
              signifie que le travail attend chez soi, quoi qu'en dise la file d'envoi locale. Le dire
              autrement laissait croire que les autres avaient déjà les modifications. */}
          {queued ? (
            <p className="flex items-start gap-1.5 text-muted-foreground">
              <RefreshCw className="mt-0.5 size-3.5 shrink-0" />
              {t("collab.panel.queued")}
            </p>
          ) : seen.length > 0 && onlineCount === 0 ? (
            <p className="flex items-start gap-1.5 text-muted-foreground">
              <RefreshCw className="mt-0.5 size-3.5 shrink-0" />
              {t("collab.panel.nobodyReachable")}
            </p>
          ) : (
            <p className="flex items-start gap-1.5 text-muted-foreground">
              <Check className="mt-0.5 size-3.5 shrink-0 text-[var(--color-ok)]" />
              {t("collab.panel.upToDate")}
            </p>
          )}
          {rotationRequired && (
            <p className="flex items-start gap-1.5 text-amber-500">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {t("collab.panel.rotation")}
            </p>
          )}
          {waitingForKey.length > 0 && (
            <p className="flex items-start gap-1.5 text-amber-500">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {t("collab.panel.waitingKey", { count: waitingForKey.length })}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

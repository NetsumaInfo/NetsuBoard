// Share › Collaborate: create a shared project and invite friends to it (docs/collab.md §5).
//
// Only a friend can be invited. Discord's friend list is unreachable without its Social SDK and
// Discord's approval, so the list built in Settings › Account IS the address book — and it also
// keeps a project id from being handed to strangers.
//
// Creating the project also opens it on this board: from that point the board is a projection of
// the shared document, and edits travel peer to peer.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConvexAuth, useQuery } from "convex/react";
import { AlertTriangle, LogOut, Trash2, UserRound, Users } from "lucide-react";
import { api } from "@/lib/convexApi";
import { createCollaborativeProject } from "@/lib/collab/session";
import {
  abortProject,
  cancelInvite,
  collabErrorMessage,
  deleteProject,
  discardStaleHead,
  inviteMembers,
  leaveProject,
  projectStatus,
  removeMember,
  setMemberRole,
  type ProjectStatus,
} from "@/lib/collab/client";
import { refreshNativeCollaborationAuth } from "@/lib/collab/authBridge";
import { UnreadableMediaError } from "@/lib/collab/media";
import { prepareShareMedia } from "./boardMediaActions";
import { useBoard } from "./useReferenceBoard";
import { useScenePersistence } from "./useScenePersistence";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";

type Profile = { userId: string; handle: string; name: string; image: string | null };
type Social = { friends: Array<Profile & { since: number }> } | undefined;
type Project = {
  projectId: string;
  role: "owner" | "editor" | "viewer";
  rotationRequired: boolean;
  members: Array<Profile & { role: "owner" | "editor" | "viewer" }>;
  pending: Array<Profile & { inviteId: string; role: "editor" | "viewer" }>;
};

type StaleHead = { headId: string; deviceId: string; bytes: number; updatedAt: number };

function Avatar({ url }: { url: string | null }) {
  return url ? (
    <img src={url} alt="" className="size-7 rounded-full object-cover" referrerPolicy="no-referrer" />
  ) : (
    <div className="flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <UserRound className="size-4" />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function CollaborationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("reference");
  const { isAuthenticated } = useConvexAuth();
  const [queryNow, setQueryNow] = useState(() => Date.now());
  useEffect(() => {
    if (open) setQueryNow(Date.now());
  }, [open]);
  const social = useQuery(api.social.listSocial, open ? {} : "skip") as Social;
  const persistence = useScenePersistence();
  const projectId = useBoard((state) => state.collabProjectId);
  const role = useBoard((state) => state.collabRole);
  const filePath = useBoard((state) => state.filePath);
  const sceneId = useBoard((state) => state.sceneId);
  const current = useQuery(
    api.projects.getProjectDetails,
    open && projectId ? { projectId, now: queryNow } : "skip",
  ) as Project | null | undefined;
  const effectiveRole = role ?? current?.role ?? null;
  const staleHeads = useQuery(
    api.heads.listStaleHeads,
    open && projectId && effectiveRole === "owner" ? { projectId, now: queryNow } : "skip",
  ) as StaleHead[] | undefined;

  // The document syncs by itself — queued edits leave the moment a peer or the relay is reachable.
  // This line only makes that visible: what is waiting, and that nobody has to send anything.
  const [sync, setSync] = useState<ProjectStatus | null>(null);
  useEffect(() => {
    if (!open || !projectId) {
      setSync(null);
      return;
    }
    let cancelled = false;
    const read = () => {
      void projectStatus(projectId)
        .then((status) => { if (!cancelled) setSync(status); })
        .catch(() => undefined);
    };
    read();
    const timer = window.setInterval(read, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, projectId]);

  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [invited, setInvited] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");
  const [confirmLifecycle, setConfirmLifecycle] = useState<"leave" | "delete" | null>(null);
  const [confirmStaleHead, setConfirmStaleHead] = useState<string | null>(null);

  // A board opened from a .netsu is CONVERTED into the library on the way in, not refused. The only
  // true blocker is a board that was never saved at all: there is nothing to convert.
  const blocker = projectId || sceneId || filePath ? null : "noScene";

  function toggle(userId: string) {
    setPicked((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  }

  async function submit() {
    if (busy || !picked.length) return;
    setBusy(true);
    setError(null);
    try {
      if (blocker) throw new Error(t(`collab.${blocker}`));
      if (projectId) {
        if (!(await refreshNativeCollaborationAuth())) throw new Error(t("collab.signedOut"));
        const { results } = await inviteMembers(projectId, picked, inviteRole);
        setInvited(results.filter((entry) =>
          entry.status === "invited" || entry.status === "refreshed").length);
      } else {
        const before = {
          sceneId: useBoard.getState().sceneId,
          filePath: useBoard.getState().filePath,
        };
        // Un board converti traîne souvent des chemins absolus morts (dossier compagnon déplacé ou
        // vidé). Avant que la publication ne juge : chemins soignés quand les octets vivent
        // ailleurs, retéléchargement depuis le lien d'origine sinon, marquage du reste. Fait AVANT
        // l'adoption : la scène stockée — celle contre laquelle le natif autorise les imports — ne
        // doit connaître que des chemins vivants.
        await prepareShareMedia().catch(() => undefined);
        const source = useBoard.getState().items;
        const adoption = await persistence.adoptIntoLibrary();
        let created: { projectId: string } | null = null;
        try {
          created = await createCollaborativeProject(source, adoption.sceneId!);
          if (adoption.adopted) persistence.completeAdoption(adoption.sceneId!);
          await persistence.bindCollaboration(created.projectId);
        } catch (failure) {
          // Undo the library copy and put the board back on its file, otherwise every failed attempt
          // leaves another identical board on the home screen — and one of them owns no document.
          // A project created a moment ago and bound to nothing is dropped with it.
          if (created) await abortProject(created.projectId).catch(() => undefined);
          if (adoption.adopted) await persistence.abortAdoption(before);
          throw failure;
        }
        // The board IS shared from here on. An invitation that fails is retried on the next open of
        // this dialog; undoing the project underneath it would throw away a published board.
        const { results } = await inviteMembers(created.projectId, picked, inviteRole);
        setInvited(results.filter((entry) =>
          entry.status === "invited" || entry.status === "refreshed").length);
      }
      setPicked([]);
    } catch (err) {
      // Des médias illisibles après tous les recours automatiques : le mur de chemins absolus et
      // d'erreurs OS ne dit rien d'actionnable. On nomme les fichiers, le board porte les cartes
      // manquantes avec leurs gestes de récupération.
      if (err instanceof UnreadableMediaError) {
        const names = err.unresolved
          .slice(0, 3)
          .map((entry) => entry.ref.split(/[\\/]/).pop() || entry.ref)
          .join(" · ");
        setError(t("collab.mediaMissing", { count: err.unresolved.length, names }));
      } else {
        setError(collabErrorMessage(err, t("collab.failed")));
      }
    } finally {
      setBusy(false);
    }
  }

  async function memberAction(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!(await refreshNativeCollaborationAuth())) throw new Error(t("collab.signedOut"));
      await action();
    } catch (err) {
      setError(collabErrorMessage(err, t("collab.failed")));
    } finally {
      setBusy(false);
    }
  }

  async function finishLifecycle() {
    if (!projectId || !confirmLifecycle) return;
    await memberAction(async () => {
      if (confirmLifecycle === "delete") await deleteProject(projectId);
      else await leaveProject(projectId);
      if (sceneId) await persistence.remove(sceneId);
      useBoard.getState().newScene();
      setConfirmLifecycle(null);
      onOpenChange(false);
    });
  }

  async function finishStaleHeadDiscard() {
    if (!confirmStaleHead) return;
    await memberAction(async () => {
      await discardStaleHead(confirmStaleHead);
      setConfirmStaleHead(null);
    });
  }

  const friends = social?.friends ?? [];
  const unavailable = new Set([
    ...(current?.members.map((member) => member.userId) ?? []),
    ...(current?.pending.map((member) => member.userId) ?? []),
  ]);
  const eligibleFriends = friends.filter((friend) => !unavailable.has(friend.userId));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-4" /> {t("collab.title")}
          </DialogTitle>
          <DialogDescription>{t("collab.subtitle")}</DialogDescription>
        </DialogHeader>

        {confirmLifecycle ? (
          <div className="space-y-3 rounded-lg border border-destructive/40 p-3">
            <p className="text-sm font-medium">
              {t(`collab.lifecycle.${confirmLifecycle}Title`)}
            </p>
            <p className="text-xs text-muted-foreground">
              {t(`collab.lifecycle.${confirmLifecycle}Warning`)}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmLifecycle(null)}>
                {t("common:action.cancel")}
              </Button>
              <Button variant="destructive" size="sm" disabled={busy} onClick={() => void finishLifecycle()}>
                {t(`collab.lifecycle.${confirmLifecycle}`)}
              </Button>
            </div>
          </div>
        ) : confirmStaleHead ? (
          <div className="space-y-3 rounded-lg border border-destructive/40 p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="size-4" /> {t("collab.staleHead.confirmTitle")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("collab.staleHead.confirmWarning")}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmStaleHead(null)}>
                {t("common:action.cancel")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => void finishStaleHeadDiscard()}
              >
                {t("collab.staleHead.discard")}
              </Button>
            </div>
          </div>
        ) : current ? (
          <div className="space-y-3">
            {sync && (
              <p
                className={
                  sync.offlineQueued
                    ? "rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs"
                    : "text-xs text-muted-foreground"
                }
              >
                {sync.offlineQueued ? t("collab.sync.queued") : t("collab.sync.upToDate")}
                {" · "}
                {t("collab.sync.peers", { count: sync.peerCandidates })}
              </p>
            )}
            {current.rotationRequired && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                {t("collab.rotationPending")}
              </p>
            )}
            {effectiveRole === "owner" && (staleHeads?.length ?? 0) > 0 && (
              <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                <p className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="size-3.5" /> {t("collab.staleHead.title")}
                </p>
                <p className="text-muted-foreground">{t("collab.staleHead.warning")}</p>
                {staleHeads!.map((head) => (
                  <div key={head.headId} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[11px]">{head.deviceId.slice(0, 12)}…</p>
                      <p className="text-[11px] text-muted-foreground">
                        {t("collab.staleHead.detail", {
                          days: Math.max(30, Math.floor((Date.now() - head.updatedAt) / 86_400_000)),
                          size: formatBytes(head.bytes),
                        })}
                      </p>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={() => setConfirmStaleHead(head.headId)}
                    >
                      {t("collab.staleHead.discard")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div className="divide-y divide-border rounded-lg border border-border px-3">
              {current.members.map((member) => (
                <div key={member.userId} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{member.name || member.handle}</span>
                  {effectiveRole === "owner" && member.role !== "owner" ? (
                    <>
                      <Button
                        size="sm"
                        variant={member.role === "editor" ? "default" : "outline"}
                        disabled={busy}
                        onClick={() => void memberAction(() => setMemberRole(projectId!, member.userId, "editor"))}
                      >
                        {t("collab.role.editor")}
                      </Button>
                      <Button
                        size="sm"
                        variant={member.role === "viewer" ? "default" : "outline"}
                        disabled={busy}
                        onClick={() => void memberAction(() => setMemberRole(projectId!, member.userId, "viewer"))}
                      >
                        {t("collab.role.viewer")}
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        disabled={busy}
                        aria-label={t("collab.members.remove")}
                        onClick={() => void memberAction(() => removeMember(projectId!, member.userId))}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t(`collab.role.${member.role}`)}</span>
                  )}
                </div>
              ))}
              {current.pending.map((member) => (
                <div key={member.inviteId} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{member.name || member.handle}</span>
                  <span className="text-xs text-muted-foreground">{t("collab.members.pending")}</span>
                  {effectiveRole === "owner" && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={busy}
                      aria-label={t("collab.members.cancelInvite")}
                      onClick={() => void memberAction(() => cancelInvite(member.inviteId))}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {effectiveRole === "owner" && eligibleFriends.length > 0 && (
              <div className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border px-3">
                {eligibleFriends.map((friend) => (
                  <label key={friend.userId} className="flex cursor-pointer items-center gap-3 py-2">
                    <Checkbox
                      checked={picked.includes(friend.userId)}
                      onCheckedChange={() => toggle(friend.userId)}
                    />
                    <Avatar url={friend.image} />
                    <span className="min-w-0 flex-1 truncate text-sm">{friend.name || friend.handle}</span>
                  </label>
                ))}
              </div>
            )}
            <div className="flex justify-end">
              {effectiveRole === "owner" ? (
                <Button variant="destructive" size="sm" onClick={() => setConfirmLifecycle("delete")}>
                  <Trash2 className="size-3.5" /> {t("collab.lifecycle.delete")}
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setConfirmLifecycle("leave")}>
                  <LogOut className="size-3.5" /> {t("collab.lifecycle.leave")}
                </Button>
              )}
            </div>
          </div>
        ) : !isAuthenticated ? (
          <p className="text-sm text-muted-foreground">{t("collab.signedOut")}</p>
        ) : social === undefined ? (
          <div className="flex justify-center py-6">
            <Spinner className="size-5" />
          </div>
        ) : !friends.length ? (
          <p className="text-sm text-muted-foreground">{t("collab.noFriends")}</p>
        ) : (
          <div className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border px-3">
            {friends.map((friend) => (
              <label key={friend.userId} className="flex cursor-pointer items-center gap-3 py-2">
                <Checkbox
                  checked={picked.includes(friend.userId)}
                  onCheckedChange={() => toggle(friend.userId)}
                />
                {friend.image ? (
                  <img
                    src={friend.image}
                    alt=""
                    className="size-7 rounded-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <UserRound className="size-4" />
                  </div>
                )}
                <span className="min-w-0 flex-1 truncate text-sm">{friend.name || friend.handle}</span>
              </label>
            ))}
          </div>
        )}

        {(!projectId || effectiveRole === "owner") && !confirmLifecycle && !confirmStaleHead && <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={inviteRole === "editor" ? "default" : "outline"}
            onClick={() => setInviteRole("editor")}
          >
            {t("collab.role.editor")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={inviteRole === "viewer" ? "default" : "outline"}
            onClick={() => setInviteRole("viewer")}
          >
            {t("collab.role.viewer")}
          </Button>
        </div>}

        {invited !== null && <p className="text-xs text-muted-foreground">{t("collab.invited", { n: invited })}</p>}
        {blocker && <p className="text-xs text-destructive">{t(`collab.${blocker}`)}</p>}
        {!blocker && !projectId && filePath && (
          <p className="text-xs text-muted-foreground">{t("collab.willAdopt")}</p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground">{t("collab.notice")}</p>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t("collab.close")}
          </Button>
          <Button size="sm" disabled={busy || !!blocker || !picked.length || (!!projectId && effectiveRole !== "owner") || !!confirmLifecycle || !!confirmStaleHead} onClick={() => void submit()}>
            {busy ? <Spinner className="size-3.5" /> : <Users className="size-3.5" />} {t(projectId ? "collab.invite" : "collab.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

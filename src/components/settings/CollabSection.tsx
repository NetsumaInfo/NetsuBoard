import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import {
  Check, ChevronDown, ChevronRight, Laptop, Trash2, UserPlus, UserRound, Users, X,
} from "lucide-react";
import { api } from "@/lib/convexApi";
import { refreshNativeCollaborationAuth } from "@/lib/collab/authBridge";
import {
  collabErrorMessage,
  deviceIdentity,
  forgetDevice,
  deleteProject as deleteProjectNative,
  leaveProject as leaveProjectNative,
  respondInvite as respondInviteNative,
} from "@/lib/collab/client";
import { useBoard } from "@/components/reference/useReferenceBoard";
import { nr } from "@/lib/bridge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

type AuthUser = { name?: string | null; image?: string | null } | null | undefined;
type Profile = {
  userId: string;
  handle: string;
  discordUsername?: string | null;
  name: string;
  image: string | null;
};
type Social = {
  self: Profile | null;
  friends: Array<Profile & { since: number }>;
  incoming: Array<Profile & { requestId: string }>;
  outgoing: Array<Profile & { requestId: string; pending?: boolean }>;
};

function Avatar({ url }: { url: string | null }) {
  return url ? (
    <img src={url} alt="" className="size-7 rounded-full object-cover" referrerPolicy="no-referrer" />
  ) : (
    <div className="flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <UserRound className="size-4" />
    </div>
  );
}

function Row({ profile, children }: { profile: Profile; children?: React.ReactNode }) {
  const secondary =
    profile.discordUsername && profile.discordUsername !== profile.name
      ? profile.discordUsername
      : profile.handle && profile.handle !== profile.name
        ? profile.handle
        : null;
  return (
    <div className="flex items-center gap-3 py-2">
      <Avatar url={profile.image} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{profile.name || profile.handle}</p>
        {/* Discord pseudonym and NetsuBoard handle are usually derived from the same name, so
            printing both showed it twice. Only the second is kept when it says something new. */}
        {secondary && <p className="truncate text-xs text-muted-foreground">@{secondary}</p>}
      </div>
      {children}
    </div>
  );
}

export function CollabSection() {
  const { t } = useTranslation("settings");
  const { isAuthenticated } = useConvexAuth();
  const [queryNow] = useState(() => Date.now());
  const user = useQuery(api.auth.getCurrentUser) as AuthUser;
  const social = useQuery(api.social.listSocial) as Social | undefined;
  const invites = useQuery(api.projects.listInvites, { now: queryNow }) as
    | Array<{ inviteId: string; projectId: string; role: string; from: Profile }>
    | undefined;
  const inbox = useQuery(api.heads.inbox) as
    | Array<{ projectId: string; actors: number; mediaRequested: boolean; keyRequested: boolean; updatedAt: number }>
    | undefined;
  const devices = useQuery(api.devices.listDevices) as
    | Array<{ deviceId: string; label?: string; createdAt: number; lastSeenAt: number }>
    | undefined;
  const projects = useQuery(api.projects.listProjectSummaries) as
    | Array<{
      projectId: string;
      role: "owner" | "editor" | "viewer";
      isOwner: boolean;
      createdAt: number;
      rotationRequired: boolean;
    }>
    | undefined;

  const upsertProfile = useMutation(api.social.upsertProfile);
  const sendRequest = useMutation(api.social.sendRequest);
  const respondRequest = useMutation(api.social.respondRequest);
  const removeFriend = useMutation(api.social.removeFriend);
  const clearInbox = useMutation(api.heads.clearInbox);

  const [nativeReady, setNativeReady] = useState<boolean | null>(null);
  const [nativeError, setNativeError] = useState<string | null>(null);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The scene behind each linked project: its name is the only human-readable identity a shared
  // project has on this machine, and its id is what a delete/leave must clean up with it.
  const [linkedScenes, setLinkedScenes] = useState<Map<string, { sceneId: string; name: string }>>(
    new Map(),
  );
  const [confirmProject, setConfirmProject] = useState<string | null>(null);
  const [showAbsent, setShowAbsent] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    void refreshNativeCollaborationAuth()
      .then(async (ready) => {
        if (!cancelled) {
          setNativeReady(ready);
          setNativeError(ready ? null : t("collab.device.unavailable"));
          if (ready) setCurrentDeviceId((await deviceIdentity()).deviceId);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setNativeReady(false);
          setNativeError(collabErrorMessage(error, t("collab.device.unavailable")));
        }
      });
    return () => { cancelled = true; };
  }, [isAuthenticated, t]);

  useEffect(() => {
    let cancelled = false;
    void nr.reference?.listScenes().then((scenes) => {
      if (cancelled) return;
      const linked = new Map<string, { sceneId: string; name: string }>();
      for (const scene of scenes) {
        if (scene.collaboration?.projectId) {
          linked.set(scene.collaboration.projectId, { sceneId: scene.id, name: scene.name });
        }
      }
      setLinkedScenes(linked);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !user?.name) return;
    void upsertProfile({ handle: user.name }).catch(() => undefined);
  }, [isAuthenticated, user?.name, user?.image, upsertProfile]);

  if (!isAuthenticated) return null;

  async function add() {
    const wanted = identifier.trim();
    if (!wanted || busy) return;
    setBusy(true);
    try {
      const result = (await sendRequest({ identifier: wanted })) as { status: string };
      setStatus(result.status);
      if (["sent", "linked", "invited"].includes(result.status)) setIdentifier("");
    } catch {
      setStatus("error");
    } finally {
      setBusy(false);
    }
  }

  async function answerInvite(
    invite: { inviteId: string; projectId: string; from: Profile },
    accept: boolean,
  ) {
    if (!(await refreshNativeCollaborationAuth())) throw new Error(t("collab.device.unavailable"));
    const result = await respondInviteNative(invite.inviteId, accept);
    if (!accept || result.status !== "joined" || !result.projectId) return;
    // A project already linked keeps its scene: accepting a re-invitation (after a leave, or a
    // stale invite from an old version) must not mint a second identical board on the home screen.
    if (linkedScenes.has(result.projectId)) return;
    const name = invite.from.name || invite.from.handle || t("collab.invites.sharedBoard");
    const saved = await nr.reference?.saveScene({
      name,
      items: [],
      view: null,
      collaboration: { projectId: result.projectId },
    });
    if (saved?.ok && saved.id) {
      const projectId = result.projectId;
      setLinkedScenes((current) => new Map(current).set(projectId, { sceneId: saved.id!, name }));
    }
  }


  async function revokeDevice(deviceId: string) {
    if (busy || deviceId === currentDeviceId) return;
    setBusy(true);
    setNativeError(null);
    try {
      if (!(await refreshNativeCollaborationAuth())) throw new Error(t("collab.device.unavailable"));
      await forgetDevice(deviceId);
    } catch (error) {
      setNativeError(collabErrorMessage(error, t("collab.device.unavailable")));
    } finally {
      setBusy(false);
    }
  }

  async function addProjectScene(projectId: string, createdAt: number) {
    if (busy || linkedScenes.has(projectId)) return;
    setBusy(true);
    try {
      const name = t("collab.projects.unnamed", {
        date: new Date(createdAt).toLocaleDateString(),
      });
      const result = await nr.reference?.saveScene({
        name,
        items: [],
        view: null,
        collaboration: { projectId },
      });
      if (!result?.ok || !result.id) throw new Error(result?.error || t("collab.projects.failed"));
      const sceneId = result.id;
      setLinkedScenes((current) => new Map(current).set(projectId, { sceneId, name }));
    } catch (error) {
      setNativeError(collabErrorMessage(error, t("collab.projects.failed")));
    } finally {
      setBusy(false);
    }
  }

  // Delete (owner) or leave (member) straight from the account list: the flood of projects an old
  // version left behind has no scene to open, so the dialog on the board could never reach them.
  async function removeProject(projectId: string, own: boolean) {
    if (busy) return;
    setBusy(true);
    setNativeError(null);
    try {
      if (!(await refreshNativeCollaborationAuth())) throw new Error(t("collab.device.unavailable"));
      if (own) await deleteProjectNative(projectId);
      else await leaveProjectNative(projectId);
      const linked = linkedScenes.get(projectId);
      if (linked) await nr.reference?.deleteScene(linked.sceneId);
      setLinkedScenes((current) => {
        const next = new Map(current);
        next.delete(projectId);
        return next;
      });
      // The board behind the settings panel may be projecting the very document that just went
      // away; leave it on a fresh scene rather than on a dead projection.
      if (useBoard.getState().collabProjectId === projectId) useBoard.getState().newScene();
      setConfirmProject(null);
    } catch (error) {
      setNativeError(collabErrorMessage(error, t("collab.projects.failed")));
    } finally {
      setBusy(false);
    }
  }

  // One row per shared project, linked or not. Everything optional stays silent: the role only
  // when it is not "owner" (the overwhelming default), the rotation only when pending, the add
  // button only when the board is absent from this machine.
  function projectRow(
    project: { projectId: string; role: "owner" | "editor" | "viewer"; createdAt: number; rotationRequired: boolean },
    name: string,
    addable: boolean,
  ) {
    const own = project.role === "owner";
    const confirming = confirmProject === project.projectId;
    const detail = [
      own ? null : t(`collab.projects.role.${project.role}`),
      project.rotationRequired ? t("collab.projects.rotation") : null,
    ].filter(Boolean).join(" · ");
    return (
      <div key={project.projectId} className="flex items-center gap-3 py-2">
        <Users className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs">{name}</p>
          {detail && <p className="truncate text-[10px] text-muted-foreground">{detail}</p>}
        </div>
        {confirming ? (
          <>
            <span className="text-xs text-muted-foreground">
              {t(own ? "collab.projects.confirmDelete" : "collab.projects.confirmLeave")}
            </span>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => void removeProject(project.projectId, own)}
            >
              {t(own ? "collab.projects.delete" : "collab.projects.leave")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmProject(null)}>
              <X className="size-3.5" />
            </Button>
          </>
        ) : (
          <>
            {addable && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void addProjectScene(project.projectId, project.createdAt)}
              >
                {t("collab.projects.add")}
              </Button>
            )}
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={busy}
              aria-label={t(own ? "collab.projects.delete" : "collab.projects.leave")}
              onClick={() => setConfirmProject(project.projectId)}
            >
              <Trash2 />
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <section className="mt-6">
        <h2 className="text-sm font-medium">{t("collab.device.title")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("collab.device.subtitle")}</p>
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-border p-3">
          <Laptop className="size-4 shrink-0 text-muted-foreground" />
          {nativeError ? (
            <p className="text-xs text-destructive">{nativeError}</p>
          ) : nativeReady ? (
            <p className="text-xs text-muted-foreground">{t("collab.device.ready")}</p>
          ) : (
            <Spinner className="size-4" />
          )}
        </div>
        {!!devices?.length && (
          <div className="mt-2 divide-y divide-border rounded-lg border border-border px-3">
            {devices.map((device) => (
              <div key={device.deviceId} className="flex items-center gap-3 py-2">
                <Laptop className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs">
                    {device.label || t("collab.device.unnamed")}
                    {device.deviceId === currentDeviceId ? ` · ${t("collab.device.current")}` : ""}
                  </p>
                  <p className="truncate font-mono text-[10px] text-muted-foreground">
                    {device.deviceId.slice(0, 12)}…
                  </p>
                </div>
                {device.deviceId !== currentDeviceId && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={t("collab.device.revoke")}
                    onClick={() => void revokeDevice(device.deviceId)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium">{t("collab.friends.title")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("collab.friends.subtitle")}</p>
        {/* The Discord username, not the internal handle. The stored handle carries a suffix derived
            from the account id so two people with the same name cannot collide or pre-claim each
            other's — useful as a key, meaningless to read, and nobody would ever type it: a Discord
            username is already unique and is what people actually give each other. */}
        {(social?.self?.discordUsername || social?.self?.handle) && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("collab.friends.yourHandle", {
              handle: social.self.discordUsername || social.self.handle,
            })}
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <Input
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void add(); }}
            placeholder={t("collab.friends.placeholder")}
            className="h-8"
          />
          <Button size="sm" disabled={busy || !identifier.trim()} onClick={() => void add()}>
            <UserPlus className="size-3.5" /> {t("collab.friends.add")}
          </Button>
        </div>
        {status && <p className="mt-2 text-xs text-muted-foreground">{t(`collab.friends.status.${status}`)}</p>}
        {social === undefined ? <Spinner className="mt-3 size-4" /> : (
          <div className="mt-3 divide-y divide-border rounded-lg border border-border px-3">
            {social.incoming.map((request) => (
              <Row key={request.requestId} profile={request}>
                <Button size="sm" variant="ghost" onClick={() => void respondRequest({ requestId: request.requestId, accept: true })}>
                  <Check className="size-3.5" /> {t("collab.friends.accept")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void respondRequest({ requestId: request.requestId, accept: false })}>
                  <X className="size-3.5" />
                </Button>
              </Row>
            ))}
            {social.outgoing.map((request) => (
              <Row key={request.requestId} profile={request}>
                {/* Two very different waits: an answer from someone who is here, or a first sign-in
                    from someone who is not. Showing one label for both left the sender wondering
                    whether the invitation had even arrived. */}
                <span className="text-xs text-muted-foreground">
                  {request.pending ? t("collab.friends.notYetJoined") : t("collab.friends.awaiting")}
                </span>
                <Button size="sm" variant="ghost" onClick={() => void respondRequest({ requestId: request.requestId, accept: false })}>
                  <X className="size-3.5" />
                </Button>
              </Row>
            ))}
            {social.friends.map((friend) => (
              <Row key={friend.userId} profile={friend}>
                <Button size="sm" variant="ghost" onClick={() => void removeFriend({ friendId: friend.userId })}>
                  {t("collab.friends.remove")}
                </Button>
              </Row>
            ))}
            {!social.friends.length && !social.incoming.length && !social.outgoing.length && (
              <p className="py-3 text-xs text-muted-foreground">{t("collab.friends.empty")}</p>
            )}
          </div>
        )}
      </section>

      {!!invites?.length && (
        <section className="mt-6">
          <h2 className="text-sm font-medium">{t("collab.invites.title")}</h2>
          <div className="mt-3 divide-y divide-border rounded-lg border border-border px-3">
            {invites.map((invite) => (
              <Row key={invite.inviteId} profile={invite.from}>
                <Button size="sm" onClick={() => void answerInvite(invite, true)}>
                  <Check className="size-3.5" /> {t("collab.invites.join")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void answerInvite(invite, false)}>
                  <X className="size-3.5" />
                </Button>
              </Row>
            ))}
          </div>
        </section>
      )}

      {!!projects?.length && (
        <section className="mt-6">
          <h2 className="text-sm font-medium">{t("collab.projects.title")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("collab.projects.subtitle")}</p>

          {/* Boards de cette machine : le nom suffit — ils s'ouvrent depuis l'accueil, le seul
              geste qui reste ici est de s'en séparer. Le détail (rôle, rotation) n'apparaît que
              quand il dit quelque chose de non évident. */}
          {projects.some((project) => linkedScenes.has(project.projectId)) && (
            <div className="mt-3 divide-y divide-border rounded-lg border border-border px-3">
              {projects.filter((project) => linkedScenes.has(project.projectId)).map((project) =>
                projectRow(project, linkedScenes.get(project.projectId)!.name, false))}
            </div>
          )}

          {/* Le reste — partages d'anciennes versions, boards d'autres appareils — est replié : la
              capture d'écran fondatrice montrait douze lignes identiques dont personne ne savait
              rien. Une ligne repliée dit le compte ; déplier donne l'ajout et la poubelle. */}
          {(() => {
            const absent = projects.filter((project) => !linkedScenes.has(project.projectId));
            if (!absent.length) return null;
            return (
              <div className="mt-2 overflow-hidden rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => setShowAbsent((current) => !current)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                >
                  {showAbsent ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                  {t("collab.projects.absent", { count: absent.length })}
                </button>
                {showAbsent && (
                  <div className="divide-y divide-border border-t border-border px-3">
                    {absent.map((project) => projectRow(
                      project,
                      t("collab.projects.unnamed", {
                        date: new Date(project.createdAt).toLocaleDateString(),
                      }),
                      true,
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </section>
      )}

      {!!inbox?.length && (
        <section className="mt-6">
          <h2 className="text-sm font-medium">{t("collab.activity.title")}</h2>
          <div className="mt-3 divide-y divide-border rounded-lg border border-border px-3">
            {inbox.map((notice) => (
              <div key={notice.projectId} className="flex items-center gap-3 py-2">
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                  {notice.keyRequested
                    ? t("collab.activity.key", { count: notice.actors })
                    : notice.mediaRequested
                    ? t("collab.activity.media", { count: notice.actors })
                    : t("collab.activity.changed", { count: notice.actors })}
                </p>
                <Button size="sm" variant="ghost" onClick={() => void clearInbox({ projectId: notice.projectId })}>
                  {t("collab.activity.dismiss")}
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

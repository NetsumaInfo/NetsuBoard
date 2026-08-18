import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { Check, Laptop, Trash2, UserPlus, UserRound, Users, X } from "lucide-react";
import { api } from "@/lib/convexApi";
import { refreshNativeCollaborationAuth } from "@/lib/collab/authBridge";
import {
  deviceIdentity,
  forgetDevice,
  respondInvite as respondInviteNative,
} from "@/lib/collab/client";
import { nr } from "@/lib/bridge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

type AuthUser = { name?: string | null; image?: string | null } | null | undefined;
type Profile = { userId: string; handle: string; name: string; image: string | null };
type Social = {
  self: Profile | null;
  friends: Array<Profile & { since: number }>;
  incoming: Array<Profile & { requestId: string }>;
  outgoing: Array<Profile & { requestId: string }>;
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
  return (
    <div className="flex items-center gap-3 py-2">
      <Avatar url={profile.image} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{profile.name || profile.handle}</p>
        {profile.handle && <p className="truncate text-xs text-muted-foreground">@{profile.handle}</p>}
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
  const [handle, setHandle] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [linkedProjects, setLinkedProjects] = useState<Set<string>>(new Set());

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
          setNativeError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => { cancelled = true; };
  }, [isAuthenticated, t]);

  useEffect(() => {
    let cancelled = false;
    void nr.reference?.listScenes().then((scenes) => {
      if (cancelled) return;
      setLinkedProjects(new Set(scenes
        .map((scene) => scene.collaboration?.projectId)
        .filter((id): id is string => Boolean(id))));
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !user?.name) return;
    void upsertProfile({ handle: user.name }).catch(() => undefined);
  }, [isAuthenticated, user?.name, user?.image, upsertProfile]);

  if (!isAuthenticated) return null;

  async function add() {
    const wanted = handle.trim();
    if (!wanted || busy) return;
    setBusy(true);
    try {
      const result = (await sendRequest({ handle: wanted })) as { status: string };
      setStatus(result.status);
      if (result.status === "sent" || result.status === "linked") setHandle("");
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
    await nr.reference?.saveScene({
      name: invite.from.name || invite.from.handle || t("collab.invites.sharedBoard"),
      items: [],
      view: null,
      collaboration: { projectId: result.projectId },
    });
    setLinkedProjects((current) => new Set(current).add(result.projectId!));
  }


  async function revokeDevice(deviceId: string) {
    if (busy || deviceId === currentDeviceId) return;
    setBusy(true);
    setNativeError(null);
    try {
      if (!(await refreshNativeCollaborationAuth())) throw new Error(t("collab.device.unavailable"));
      await forgetDevice(deviceId);
    } catch (error) {
      setNativeError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function addProjectScene(projectId: string) {
    if (busy || linkedProjects.has(projectId)) return;
    setBusy(true);
    try {
      const result = await nr.reference?.saveScene({
        name: t("collab.invites.sharedBoard"),
        items: [],
        view: null,
        collaboration: { projectId },
      });
      if (!result?.ok) throw new Error(result?.error || t("collab.projects.failed"));
      setLinkedProjects((current) => new Set(current).add(projectId));
    } catch (error) {
      setNativeError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
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
        {social?.self?.handle && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("collab.friends.yourHandle", { handle: social.self.handle })}
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <Input
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void add(); }}
            placeholder={t("collab.friends.placeholder")}
            className="h-8"
          />
          <Button size="sm" disabled={busy || !handle.trim()} onClick={() => void add()}>
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
                <span className="text-xs text-muted-foreground">{t("collab.friends.awaiting")}</span>
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
          <div className="mt-3 divide-y divide-border rounded-lg border border-border px-3">
            {projects.map((project) => (
              <div key={project.projectId} className="flex items-center gap-3 py-2">
                <Users className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs">{t(`collab.projects.role.${project.role}`)}</p>
                  {project.rotationRequired && (
                    <p className="text-[10px] text-muted-foreground">
                      {t("collab.projects.rotation")}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || linkedProjects.has(project.projectId)}
                  onClick={() => void addProjectScene(project.projectId)}
                >
                  {linkedProjects.has(project.projectId)
                    ? t("collab.projects.added")
                    : t("collab.projects.add")}
                </Button>
              </div>
            ))}
          </div>
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

import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardItem } from "./referenceShared";
import { diffBoard, type AssetResolver } from "@/lib/collab/operations";
import { projectBoard, type NativeProject } from "@/lib/collab/projection";
import type { MediaAsset } from "@/lib/collab/types";
import {
  applyOperations,
  closeProject,
  mediaUrl,
  nativeProjection,
  onChanged,
  openProject,
  projectStatus,
  redo,
  resolveMedia,
  undo,
  type ProjectStatus,
  type ProjectSession,
} from "@/lib/collab/client";
import { refreshNativeCollaborationAuth } from "@/lib/collab/authBridge";
import { importBoardAssets } from "@/lib/collab/media";

type Resolution = "available" | "waiting" | "removed";

function nativeAssets(project: NativeProject): Map<string, MediaAsset> {
  const assets = new Map<string, MediaAsset>();
  const add = (asset?: MediaAsset | null) => {
    if (asset?.contentHash) assets.set(`collab:${asset.contentHash}`, asset);
  };
  for (const item of project.items) {
    add(item.media?.primary);
    add(item.media?.previous?.asset);
    add(item.media?.local?.asset);
    item.sequence?.frames.forEach(add);
  }
  return assets;
}

export type CollabProject = {
  items: BoardItem[];
  revision: number;
  error: string | null;
  session: ProjectSession | null;
  status: ProjectStatus | null;
  sendBoard: (previous: BoardItem[], next: BoardItem[]) => Promise<void>;
  importBoard: (items: BoardItem[]) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  refresh: () => Promise<void>;
};

export function useCollabProject(projectId: string | null, sceneId: string | null): CollabProject {
  const [items, setItems] = useState<BoardItem[]>([]);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<ProjectSession | null>(null);
  const [status, setStatus] = useState<ProjectStatus | null>(null);
  const assetCache = useRef(new Map<string, MediaAsset>());
  const resolutionCache = useRef(new Map<string, Resolution>());
  const refreshGeneration = useRef(0);

  const renderProjection = useCallback((native: NativeProject) => {
    const projected = projectBoard(native, (hash) => mediaUrl(projectId!, hash));
    const nativeById = new Map(native.items.map((item) => [item.itemId, item]));
    for (const item of projected) {
      const asset = nativeById.get(item.id)?.media?.primary;
      const hash = asset?.contentHash;
      const status = hash ? resolutionCache.current.get(hash) : undefined;
      if (asset && hash && status !== "available") {
        item.missing = {
          name: asset.displayName,
          size: asset.size,
          kind: item.kind,
          locator: hash,
          reason: status ?? "waiting",
        };
        item.src = "";
      }
    }
    return projected;
  }, [projectId]);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    const generation = ++refreshGeneration.current;
    try {
      const native = await nativeProjection(projectId);
      if (generation !== refreshGeneration.current) return;
      const assets = nativeAssets(native);
      for (const [ref, asset] of assets) assetCache.current.set(ref, asset);
      // Content appears immediately. Missing originals resolve in the background and never block
      // notes, geometry, or drawing while every holder of a large video is offline.
      setItems(renderProjection(native));
      setRevision(native.revision);
      setError(null);
      const status = await projectStatus(projectId);
      if (generation !== refreshGeneration.current) return;
      setStatus(status);
      setSession((current) => current ? {
        ...current,
        role: status.role,
        keyEpoch: status.keyEpoch,
      } : current);
      const hashed = [...assets.values()].filter((asset) => asset.contentHash);
      void (async () => {
        try {
          let cursor = 0;
          const workers = Array.from({ length: Math.min(4, hashed.length) }, async () => {
            while (cursor < hashed.length) {
              const asset = hashed[cursor++];
              const hash = asset.contentHash!;
              if (resolutionCache.current.get(hash) === "available") continue;
              const result = await resolveMedia(projectId, {
                hash,
                name: asset.displayName,
                mime: asset.mime,
                size: asset.size,
              });
              resolutionCache.current.set(hash, result.status);
            }
          });
          await Promise.all(workers);
          if (generation === refreshGeneration.current) setItems(renderProjection(native));
        } catch (cause) {
          if (generation === refreshGeneration.current) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        }
      })();
    } catch (cause) {
      if (generation === refreshGeneration.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }
  }, [projectId, renderProjection]);

  useEffect(() => {
    if (!projectId) {
      setItems([]);
      setSession(null);
      setStatus(null);
      return;
    }
    let cancelled = false;
    let stop: (() => void) | null = null;
    let lease: string | null = null;
    void (async () => {
      try {
        if (!(await refreshNativeCollaborationAuth())) {
          throw new Error("Sign in is required to open a collaborative project");
        }
        const opened = await openProject(projectId, sceneId ?? projectId, "viewer");
        lease = opened.leaseId;
        if (cancelled) {
          await closeProject(projectId, lease);
          return;
        }
        setSession(opened);
        await refresh();
        stop = await onChanged((event) => {
          if (event.projectId === projectId) void refresh();
        });
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      cancelled = true;
      refreshGeneration.current += 1;
      stop?.();
      if (lease) void closeProject(projectId, lease);
    };
  }, [projectId, refresh, sceneId]);

  useEffect(() => {
    if (!projectId) return;
    const timer = window.setInterval(() => {
      void refreshNativeCollaborationAuth().then((authenticated) => {
        if (authenticated) void refresh();
      });
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [projectId, refresh]);

  useEffect(() => {
    const retry = () => {
      resolutionCache.current.clear();
      void refresh();
    };
    window.addEventListener("nb-collab-retry-media", retry);
    return () => window.removeEventListener("nb-collab-retry-media", retry);
  }, [refresh]);

  const resolverFor = useCallback(async (next: BoardItem[]): Promise<AssetResolver> => {
    if (!projectId) return () => null;
    return importBoardAssets(projectId, next, assetCache.current);
  }, [projectId]);

  const sendBoard = useCallback(async (previous: BoardItem[], next: BoardItem[]) => {
    if (!projectId || session?.role === "viewer") {
      await refresh();
      return;
    }
    try {
      const resolver = await resolverFor(next);
      const operations = diffBoard(previous, next, resolver);
      if (operations.length) await applyOperations(projectId, operations);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await refresh();
    }
  }, [projectId, refresh, resolverFor, session?.role]);

  const importBoard = useCallback(async (source: BoardItem[]) => {
    await sendBoard([], source);
  }, [sendBoard]);

  const runHistory = useCallback(async (redoing: boolean) => {
    if (!projectId || session?.role === "viewer") return;
    try {
      await (redoing ? redo(projectId) : undo(projectId));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [projectId, refresh, session?.role]);

  return {
    items,
    revision,
    error,
    session,
    status,
    sendBoard,
    importBoard,
    undo: () => runHistory(false),
    redo: () => runHistory(true),
    refresh,
  };
}

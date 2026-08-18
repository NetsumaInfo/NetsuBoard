import { useEffect, useRef } from "react";
import type { BoardItem } from "./referenceShared";
import { useBoard } from "./useReferenceBoard";
import { useCollabProject } from "./useCollabProject";

/** Bidirectional adapter. Rust/Loro is always authoritative; the Zustand board is a render cache. */
export function useCollabBridge() {
  const projectId = useBoard((state) => state.collabProjectId);
  const sceneId = useBoard((state) => state.sceneId);
  const collab = useCollabProject(projectId, sceneId);
  const applyingProjection = useRef(false);
  const lastLocal = useRef<BoardItem[]>([]);
  const sendQueue = useRef(Promise.resolve());

  useEffect(() => {
    if (!projectId || !collab.session) return;
    useBoard.setState({
      collabRole: collab.session.role,
      collabKeyEpoch: collab.session.keyEpoch,
      collabRotationRequired: collab.status?.rotationRequired ?? false,
      collabPeerCandidates: collab.status?.peerCandidates ?? 0,
      collabOfflineQueued: collab.status?.offlineQueued ?? false,
    });
  }, [collab.session, collab.status, projectId]);

  // Empty is a complete authoritative state too. Never retain stale local items merely because the
  // remote projection contains zero entries.
  useEffect(() => {
    if (!projectId || !collab.session) return;
    applyingProjection.current = true;
    lastLocal.current = collab.items;
    useBoard.setState({
      items: collab.items,
      dirty: false,
      selectedId: null,
      selectedIds: [],
      editingId: null,
      croppingId: null,
    });
    applyingProjection.current = false;
  }, [collab.items, collab.session, projectId]);

  useEffect(() => {
    if (!projectId || !collab.session) return;
    lastLocal.current = useBoard.getState().items;
    const stop = useBoard.subscribe((state) => {
      if (applyingProjection.current) return;
      const next = state.items;
      if (next === lastLocal.current) return;
      const previous = lastLocal.current;
      lastLocal.current = next;
      sendQueue.current = sendQueue.current
        .catch(() => undefined)
        .then(() => collab.sendBoard(previous, next));
    });
    return stop;
  }, [collab.sendBoard, collab.session, projectId]);

  useEffect(() => {
    if (!collab.error) return;
    useBoard.getState().setNotice({ text: collab.error, kind: "error", sticky: true });
  }, [collab.error]);

  return collab;
}

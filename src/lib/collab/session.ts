import type { BoardItem } from "@/components/reference/referenceShared";
import { refreshNativeCollaborationAuth } from "./authBridge";
import {
  abortProject,
  applyOperations,
  closeProject,
  createProject,
  flushCheckpoint,
  openProject,
} from "./client";
import { importBoardAssets } from "./media";
import { diffBoard } from "./operations";

export async function createCollaborativeProject(
  items: BoardItem[],
  sceneId: string,
): Promise<{ projectId: string }> {
  if (!(await refreshNativeCollaborationAuth())) {
    throw new Error("Sign in is required to create a collaborative project");
  }
  const { projectId } = await createProject();
  const session = await openProject(projectId, sceneId, "owner");
  try {
    if (items.length) {
      const resolver = await importBoardAssets(projectId, items);
      const operations = diffBoard([], items, resolver);
      if (operations.length) await applyOperations(projectId, operations);
    }
    // This is the publication boundary: the scene is not marked collaborative until a sealed,
    // recoverable checkpoint and its owner key envelope both exist in Convex.
    await flushCheckpoint(projectId);
    return { projectId };
  } catch (error) {
    await abortProject(projectId).catch(() => undefined);
    throw error;
  } finally {
    await closeProject(projectId, session.leaseId).catch(() => undefined);
  }
}

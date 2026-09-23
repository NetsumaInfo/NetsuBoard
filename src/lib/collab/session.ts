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
import { collabFailure } from "./failure";
import { importBoardAssets, UnreadableMediaError } from "./media";
import { diffBoard } from "./operations";

export async function createCollaborativeProject(
  items: BoardItem[],
  sceneId: string,
): Promise<{ projectId: string }> {
  if (!(await refreshNativeCollaborationAuth())) {
    throw collabFailure("sign_in", "sign in is required to create a collaborative project");
  }
  const { projectId } = await createProject();
  const session = await openProject(projectId, sceneId, "owner");
  try {
    if (items.length) {
      const assets = await importBoardAssets(projectId, items);
      // Publishing is the one moment a media enters the shared document. A board that goes out
      // amputated stays amputated for everyone, including its author, so a file that cannot be read
      // stops the share here with its name and its cause instead of being quietly left behind.
      if (assets.missing.length) {
        throw new UnreadableMediaError(assets.missing);
      }
      const operations = diffBoard([], items, assets.resolve);
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

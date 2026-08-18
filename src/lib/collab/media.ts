import type { BoardItem, ItemKind } from "@/components/reference/referenceShared";
import { importMedia } from "./client";
import type { AssetResolver } from "./operations";
import type { MediaAsset } from "./types";

function mimeFor(path: string, kind: ItemKind): string {
  const extension = path.split(/[?#]/, 1)[0].split(".").pop()?.toLowerCase();
  const known: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", bmp: "image/bmp", avif: "image/avif", svg: "image/svg+xml",
    mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm",
    mkv: "video/x-matroska", avi: "video/x-msvideo", mpg: "video/mpeg", mpeg: "video/mpeg",
  };
  return (extension && known[extension]) || (kind === "video" ? "video/*" : "image/*");
}

function localRefs(items: BoardItem[]): Array<{ ref: string; item: BoardItem; kind: ItemKind }> {
  const refs = new Map<string, { ref: string; item: BoardItem; kind: ItemKind }>();
  const add = (ref: string | undefined, item: BoardItem, kind: ItemKind) => {
    if (!ref || /^(https?:|data:|blob:|collab:)/i.test(ref)) return;
    refs.set(ref, { ref, item, kind });
  };
  for (const item of items) {
    add(item.ref, item, item.kind);
    item.frames?.forEach((ref) => add(ref, item, "image"));
    add(item.prevMedia?.ref, item, item.prevMedia?.kind ?? item.kind);
    add(item.localMedia?.ref, item, item.localMedia?.kind ?? item.kind);
  }
  return [...refs.values()];
}

export async function importBoardAssets(
  projectId: string,
  items: BoardItem[],
  cache: Map<string, MediaAsset> = new Map(),
): Promise<AssetResolver> {
  for (const { ref, item, kind } of localRefs(items)) {
    if (cache.has(ref)) continue;
    const imported = await importMedia(projectId, ref, mimeFor(ref, kind));
    cache.set(ref, {
      contentHash: imported.hash,
      displayName: imported.name,
      mime: imported.mime,
      size: imported.size,
      sourceUrl: item.sourceUrl,
    });
  }
  return (ref) => cache.get(ref) ?? null;
}

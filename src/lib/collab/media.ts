import type { BoardItem, ItemKind } from "@/components/reference/referenceShared";
import { nr } from "@/lib/bridge";
import { collabErrorMessage, importMedia } from "./client";
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
    // A YouTube item's `ref` is a video id, not a path. Handing it to the file importer asked the
    // native side to read a file named after the video and reported the board as carrying an
    // unreadable media; the document takes the id as it is.
    if (kind === "youtube") return;
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

async function importPreview(projectId: string, ref: string): Promise<{ hash: string; size: number } | null> {
  try {
    const rendered = await nr.reference?.collabPreview(ref);
    if (!rendered?.ok || !rendered.path) return null;
    const imported = await importMedia(projectId, rendered.path, "image/jpeg");
    return { hash: imported.hash, size: imported.size };
  } catch {
    // A media without its preview is a slower first paint, never a failed share.
    return null;
  }
}

export type UnresolvedMedia = { ref: string; cause: string };
export type AssetImport = { resolve: AssetResolver; missing: UnresolvedMedia[] };

/** A publication stopped by unreadable media. Carries the list so the UI can name the files and
    mark the items instead of printing a wall of absolute paths and OS errors. */
export class UnreadableMediaError extends Error {
  constructor(readonly unresolved: UnresolvedMedia[]) {
    super(`${unresolved.length} media could not be read: ${describeUnresolved(unresolved)}`);
    this.name = "UnreadableMediaError";
  }
}

/**
 * Imports every local file the board points at. A file that cannot be imported is reported, never
 * hidden: the document can only carry a content hash, a remote URL or a YouTube id, so an item
 * whose media failed to import would otherwise enter the shared board stripped of it — silently and
 * irreversibly. The caller decides what to do with `missing`; the one thing it must not do is
 * publish a manifest that erases the media.
 */
export async function importBoardAssets(
  projectId: string,
  items: BoardItem[],
  cache: Map<string, MediaAsset> = new Map(),
  failures: Map<string, string> = new Map(),
): Promise<AssetImport> {
  const missing: UnresolvedMedia[] = [];
  for (const { ref, item, kind } of localRefs(items)) {
    if (cache.has(ref)) continue;
    // A file that could not be read stays unreadable until something changes on disk. Retrying it
    // on every edit turned one dead reference into an IPC round trip per keystroke; the failure is
    // remembered and only the explicit retry clears it.
    const known = failures.get(ref);
    if (known !== undefined) {
      missing.push({ ref, cause: known });
      continue;
    }
    const importAt = async (sourcePath: string) => {
      const imported = await importMedia(projectId, sourcePath, mimeFor(sourcePath, kind));
      // The preview travels first on the other side: a 40 MB image or a video shows something
      // within one small transfer. Only the item's own displayed media earns one — frames and
      // held-back variants would multiply ffmpeg runs for tiles nobody sees first. Optional by
      // construction: a board without previews stays a working board.
      const preview = ref === item.ref && (kind === "image" || kind === "video")
        ? await importPreview(projectId, sourcePath)
        : null;
      cache.set(ref, {
        contentHash: imported.hash,
        displayName: imported.name,
        mime: imported.mime,
        size: imported.size,
        sourceUrl: item.sourceUrl,
        ...(preview ? { previewHash: preview.hash, previewSize: preview.size } : null),
      });
    };
    try {
      await importAt(ref);
    } catch (error) {
      // Last resort before reporting the media unreadable: the same bytes may live at another
      // address — the file name carries its content fingerprint, and the core knows every store.
      const located = await nr.reference?.locateMedia([ref])
        .then((result) => result?.moves?.[ref])
        .catch(() => undefined);
      if (located) {
        try {
          await importAt(located);
          continue;
        } catch { /* the original failure stays the reported cause */ }
      }
      // The native boundary rejects with a plain `{ code, message }`, which `String()` renders as
      // "[object Object]" — the one thing that cannot be acted on.
      const cause = collabErrorMessage(error, "unreadable");
      failures.set(ref, cause);
      missing.push({ ref, cause });
    }
  }
  return { resolve: (ref) => cache.get(ref) ?? null, missing };
}

/** One readable line naming what could not travel, and why. */
export function describeUnresolved(missing: UnresolvedMedia[]): string {
  const named = missing.slice(0, 3).map((entry) => `${entry.ref} (${entry.cause})`).join(" · ");
  return missing.length > 3 ? `${named} … +${missing.length - 3}` : named;
}

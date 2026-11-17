// What an empty Animatic shows on its board: the two buttons that fill it. Gone as soon as the first
// item lands.

import { useTranslation } from "react-i18next";
import { nr } from "@/lib/bridge";
import { Button } from "@/components/ui/button";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import { useBoard } from "../useReferenceBoard";
import { openClipId, openClipRaw, readClip } from "./clipSelectors";
import { setClipMusic, useClipPlayer } from "./clipPlayer";

export function ClipEmpty() {
  const { t } = useTranslation("reference");
  const open = useBoard((s) => !!openClipId(s));
  const empty = useBoard((s) => !s.items.some((it) => it.kind !== "draw"));
  const hasMusic = useBoard((s) => !!readClip(openClipRaw(s))?.music);
  const readonly = useBoard((s) => s.collabRole === "viewer" && s.collabProjectId !== null);
  const presenting = useClipPlayer((s) => s.presenting);
  const library = useClipPlayer((s) => s.library);
  if (!open || !empty || presenting || readonly) return null;

  const chooseMusic = async () => {
    const path = await nr.chooseAnyFile();
    if (path) await setClipMusic(path);
  };
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
      <div className="pointer-events-auto flex flex-col items-center gap-3 text-sm text-muted-foreground">
        <span className="flex items-center gap-2 font-medium">
          <NetsuIcon name="animatic" className="size-5" /> {t("clip.emptyTitle")}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant={library ? "secondary" : "default"} className="gap-1.5" onClick={() => useClipPlayer.setState({ library: true })}>
            <NetsuIcon name="gallery" /> {t("clip.library")}
          </Button>
          {!hasMusic && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void chooseMusic()}>
              <NetsuIcon name="music" /> {t("clip.addMusic")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

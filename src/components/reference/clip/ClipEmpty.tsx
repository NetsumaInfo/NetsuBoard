// What an empty Animatic shows on its board: how to fill it, in three steps, with the two buttons
// that start them. Gone as soon as the first item lands.

import { useTranslation } from "react-i18next";
import { nr } from "@/lib/bridge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
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
  const steps = [
    { done: false, text: t("clip.emptyStep1") },
    { done: hasMusic, text: t("clip.emptyStep2") },
    { done: false, text: t("clip.emptyStep3") },
  ];
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
      <div className="pointer-events-auto w-full max-w-sm rounded-xl border border-border bg-[var(--color-surface)]/95 p-5 text-sm shadow-lg">
        <div className="mb-3 flex items-center gap-2 font-semibold">
          <NetsuIcon name="animatic" className="size-5" /> {t("clip.emptyTitle")}
        </div>
        <ol className="mb-4 space-y-2 text-muted-foreground">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground">
                {s.done ? <NetsuIcon name="check" className="size-3" /> : i + 1}
              </span>
              <span>{s.text}</span>
            </li>
          ))}
        </ol>
        <div className="flex gap-2">
          <Button size="sm" variant={library ? "secondary" : "default"} className="flex-1 gap-1.5" onClick={() => useClipPlayer.setState({ library: true })}>
            <NetsuIcon name="gallery" /> {t("clip.library")}
          </Button>
          {!hasMusic && (
            <Button size="sm" variant="outline" className="flex-1 gap-1.5" onClick={() => void chooseMusic()}>
              <NetsuIcon name="music" /> {t("clip.addMusic")}
            </Button>
          )}
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
          <Kbd>M</Kbd> {t("clip.emptyKeyCut")} · <Kbd>K</Kbd> {t("clip.emptyKeyMark")} · <Kbd>{t("clip.keyShift")}</Kbd>+<Kbd>{t("clip.keySpace")}</Kbd> {t("clip.emptyKeyShot")}
        </p>
      </div>
    </div>
  );
}

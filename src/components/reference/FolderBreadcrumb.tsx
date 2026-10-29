// Path bar shown while a folder is open: a back button and one crumb per level, top level first.
// Hidden on the top level, so a board without folders shows nothing.

import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBoard } from "./useReferenceBoard";
import { NetsuIcon } from "@/components/ui/netsu-icon";

export function FolderBreadcrumb() {
  const { t } = useTranslation("reference");
  // Folder titles live one level up, in the stash.
  const names = useBoard(useShallow((s) =>
    s.folderPath.map(({ id }) => s.stash.find((it) => it.id === id)?.text || t("item.frameDefault"))));
  const leaveFolder = useBoard((s) => s.leaveFolder);
  if (!names.length) return null;
  return (
    <div className="absolute left-1/2 top-3 z-40 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-1 rounded-lg border border-border bg-[var(--color-surface)] px-1 py-1 shadow-lg">
      <Tooltip>
        <TooltipTrigger
          render={<Button variant="ghost" size="icon-sm" onClick={() => leaveFolder(names.length - 1)} aria-label={t("folder.back")} />}
        >
          <NetsuIcon name="back" />
        </TooltipTrigger>
        <TooltipContent>{t("folder.back")}</TooltipContent>
      </Tooltip>
      <Button variant="ghost" size="sm" onClick={() => leaveFolder(0)}>{t("folder.top")}</Button>
      {names.map((name, i) => (
        <Fragment key={i}>
          <NetsuIcon name="chevron-toggle" on={false} className="size-3.5 shrink-0 opacity-50" />
          <Button
            variant="ghost"
            size="sm"
            className="max-w-48 truncate"
            disabled={i === names.length - 1}
            onClick={() => leaveFolder(i + 1)}
          >
            {name}
          </Button>
        </Fragment>
      ))}
    </div>
  );
}

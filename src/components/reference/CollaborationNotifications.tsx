import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "convex/react";

import { api } from "@/lib/convexApi";
import { refreshNativeCollaborationAuth } from "@/lib/collab/authBridge";
import { toast } from "@/components/ui/toast";
import { useBoard } from "./useReferenceBoard";

type ActivityNotice = {
  projectId: string;
  actors: number;
  mediaRequested: boolean;
  keyRequested: boolean;
  updatedAt: number;
};

/**
 * Surfaces the durable inbox when the app comes back online. The row remains visible in Account
 * settings until explicitly dismissed; session storage only prevents React remounts from repeating
 * the same transient toast.
 */
export function CollaborationNotifications() {
  const { t } = useTranslation("settings");
  const notices = useQuery(api.heads.inbox) as ActivityNotice[] | undefined;

  useEffect(() => {
    if (!notices) return;
    for (const notice of notices) {
      const key = `nb-collab-notice:${notice.projectId}:${notice.updatedAt}`;
      if (notice.keyRequested && !sessionStorage.getItem(`${key}:key-refresh`)) {
        sessionStorage.setItem(`${key}:key-refresh`, "1");
        void refreshNativeCollaborationAuth().catch(() => undefined);
      }
      // Live collaborators already see the revision arrive on the board. The durable row remains
      // available in settings, but the transient "while you were away" message would be a lie.
      if (useBoard.getState().collabProjectId === notice.projectId) continue;
      if (sessionStorage.getItem(key)) continue;
      sessionStorage.setItem(key, "1");
      toast.info(
        notice.keyRequested
          ? t("collab.activity.key", { count: notice.actors })
          : notice.mediaRequested
          ? t("collab.activity.media", { count: notice.actors })
          : t("collab.activity.changed", { count: notice.actors }),
      );
    }
  }, [notices, t]);

  return null;
}

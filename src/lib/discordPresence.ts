// Alimente la Rich Presence Discord en contexte : quel board est ouvert, combien de références il
// porte. Le core (core/discordRpc.js) tient la connexion, le throttle de 15 s et les réglages — d'où
// un hook qui se contente de pousser, sans se soucier de la fréquence.
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useBoard } from "@/components/reference/useReferenceBoard";
import { nr } from "./bridge";

/**
 * À monter UNE SEULE fois, dans la coquille principale. La fenêtre détachée du board est le MÊME
 * renderer dans un autre contexte : l'y monter ferait pousser deux contextes concurrents au core.
 */
export function useDiscordPresence() {
  const { t } = useTranslation("settings");
  const sceneName = useBoard((s) => s.sceneName);
  const count = useBoard((s) => s.items.length);

  useEffect(() => {
    // La ligne « références » part DÉJÀ traduite : les locales vivent ici, pas dans le core.
    void nr.discordSetContext?.({ board: sceneName || null, items: t("discord.itemsLine", { count }) })
      ?.catch?.(() => {});
  }, [sceneName, count, t]);
}

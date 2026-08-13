// Choix « Modèle » d'upscale du board (Paramètres + popup d'item). NetsuBoard n'embarque qu'un
// moteur — les shaders GLSL livrés avec l'application — donc la liste ne dépend plus de ce qui est
// installé : il n'y a rien à installer. Elle reste filtrée par la COMPATIBILITÉ matérielle, seul
// facteur qui peut encore rendre une entrée inutilisable (pilote sans Vulkan).
// Source unique : les deux écrans lisent cette liste, sinon un défaut réglé ici serait refusé là-bas.

import { useMemo } from "react";
import { BOARD_UP_CHOICES, type BoardUpChoice } from "@/components/upscale/upscaleShared";
import { isModelCompatible, useCompatibility } from "@/hooks/useCompatibility";

// `ready` est toujours vrai : la liste ne se remplit plus de façon asynchrone, donc aucun réglage ne
// risque d'être écrasé par une liste momentanément vide au boot. Le paramètre reste pour que les
// appelants n'aient pas à changer de forme.
export function useBoardUpChoices(): { ready: boolean; choices: BoardUpChoice[] } {
  const { status } = useCompatibility();
  const choices = useMemo(
    () => BOARD_UP_CHOICES.filter((c) => isModelCompatible(c.value, status)),
    [status],
  );
  return { ready: true, choices };
}

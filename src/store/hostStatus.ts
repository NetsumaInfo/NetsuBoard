// Sélecteur PARTAGÉ de l'état de l'hôte actif : le heartbeat du panneau CEP (< 12 s). Les vues qui
// proposent une action « projet » (ranger, importer) le lisent ici plutôt que de le recalculer.
import type { AppState } from "./index";

/** L'hôte ACTIF est joignable : heartbeat du panneau CEP. */
export function hostConnected(state: AppState): boolean {
  return !!state.adobeStatus?.[state.activeHost]?.panelConnected;
}

/** Projet ouvert dans l'hôte actif (nom d'affichage), ou null s'il n'y en a pas. */
export function hostProject(state: AppState): string | null {
  return state.adobeSnapshots[state.activeHost]?.project ?? null;
}

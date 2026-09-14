// Quel projet partagé le board affiche-t-il en ce moment ?
//
// Un média de board partagé est désigné par `collab:<empreinte>` — jamais par un chemin. Son adresse
// d'AFFICHAGE dépend du projet ouvert (`http://collab.localhost/<projet>/<empreinte>`), ce qui la
// rend incalculable depuis le modèle seul. La projection en fournit une pour le média principal de
// chaque item, mais pas pour tout le reste : les frames d'une séquence, la pellicule du lecteur, le
// rendu hors-DOM d'un export. Ces appelants tombaient donc sur une adresse vide, et affichaient une
// case blanche sans jamais dire pourquoi.
//
// D'où ce registre minuscule : il ne dépend de RIEN (ni du store, ni du pont natif), donc le modèle
// (`referenceShared.ts#displaySrc`) peut l'interroger sans cycle d'import, et une seule règle décide
// de l'adresse d'un média partagé où qu'il soit demandé.

import type { BoardItem } from "@/components/reference/referenceShared";
import { mediaPath, mediaUrl } from "./client";

let current: string | null = null;
let mediaRequester: ((hash: string) => Promise<void>) | null = null;

/** Suivi par le pont collaboratif à l'ouverture et à la fermeture d'un board partagé. */
export function setCurrentCollabProject(projectId: string | null): void {
  current = projectId;
}

/** Resolve one shared original requested by a visible board item. */
export function setCurrentCollabMediaRequester(
  requester: ((hash: string) => Promise<void>) | null,
): void {
  mediaRequester = requester;
}

export function requestCurrentCollabMedia(hash: string): Promise<void> {
  return mediaRequester?.(hash) ?? Promise.resolve();
}

export function currentCollabProject(): string | null {
  return current;
}

/**
 * Adresse d'affichage d'un `collab:<empreinte>`, ou '' hors d'un board partagé — auquel cas
 * l'empreinte ne désigne rien d'accessible et une case vide est la seule réponse honnête.
 */
export function collabMediaSrc(ref: string): string {
  if (!current) return "";
  const hash = ref.slice("collab:".length);
  return hash ? mediaUrl(current, hash) : "";
}

/**
 * Remplace chaque `collab:<empreinte>` par le CHEMIN de ses octets sur ce disque.
 *
 * Le service Node ne connaît que des fichiers : lui passer un board partagé tel quel écrivait un
 * `.netsu` dont tous les médias étaient des placeholders « Relocaliser » — en annonçant que l'export
 * avait réussi. Un média encore en cours de transfert n'a pas de chemin : son item est rendu INTACT,
 * donc signalé manquant par le core plutôt que silencieusement vidé.
 */
export async function withLocalMediaPaths<T extends BoardItem>(items: T[]): Promise<T[]> {
  if (!current) return items;
  const wanted = new Set<string>();
  const collect = (ref?: string) => {
    if (ref && ref.startsWith("collab:")) wanted.add(ref);
  };
  for (const item of items) {
    collect(item.ref);
    item.frames?.forEach(collect);
    collect(item.prevMedia?.ref);
    // `localMedia` aussi : le fichier gardé en réserve derrière un embed part sinon en `collab:`
    // brut dans le .netsu, c'est-à-dire en placeholder — ce que cette fonction existe pour éviter.
    collect(item.localMedia?.ref);
  }
  if (!wanted.size) return items;

  const paths = new Map<string, string>();
  await Promise.all([...wanted].map(async (ref) => {
    const found = await mediaPath(current!, ref.slice("collab:".length)).catch(() => null);
    if (found) paths.set(ref, found);
  }));
  if (!paths.size) return items;

  const swap = (ref?: string) => (ref ? paths.get(ref) ?? ref : ref);
  return items.map((item) => {
    const ref = swap(item.ref);
    const frames = item.frames?.map((frame) => swap(frame) as string);
    const prev = item.prevMedia ? { ...item.prevMedia, ref: swap(item.prevMedia.ref) as string } : undefined;
    const local = item.localMedia ? { ...item.localMedia, ref: swap(item.localMedia.ref) as string } : undefined;
    if (ref === item.ref && !frames && !prev && !local) return item;
    return {
      ...item,
      ...(ref !== item.ref ? { ref, src: "" } : null),
      ...(frames ? { frames } : null),
      ...(prev ? { prevMedia: prev } : null),
      ...(local ? { localMedia: local } : null),
    };
  });
}

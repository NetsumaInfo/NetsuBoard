// Abstraction d'hôte : une app Adobe via le panneau CEP. Fonctions PURES (aucun import du store →
// pas de cycle) : libellé d'hôte, test d'appartenance Adobe, et routage de l'import de médias.
import { nr, type AdobeApp } from "@/lib/bridge";
import type { HostId } from "@/store/types";

const HOSTS: { id: HostId; label: string }[] = [
  { id: "ppro", label: "Premiere Pro" },
  { id: "aeft", label: "After Effects" },
];

export function hostLabel(id: HostId): string {
  return HOSTS.find((h) => h.id === id)?.label ?? id;
}
export function isAdobeHost(id: HostId): id is AdobeApp {
  return id === "ppro" || id === "aeft";
}

// Importe des fichiers dans les bins du projet Adobe ouvert.
export async function hostImport(host: HostId, paths: string[]): Promise<{ ok: boolean; count?: number; error?: string }> {
  if (!paths.length) return { ok: true, count: 0 };
  return nr.adobeImport(host, paths);
}

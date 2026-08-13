// Relais de rapport de bug. NetsuBoard n'a NI compte NI backend : il n'existe donc aucun relais, et
// `bugRelayConfigured()` rend toujours faux. `ErrorReportButton` retombe alors sur son chemin local
// (copie du rapport dans le presse-papiers), qui est le seul dont dispose une application autonome.
//
// Le module est conservé plutôt que supprimé pour garder le point d'extension : brancher un relais
// se fera ici, sans toucher à l'interface.

export type BugRelay = { site: string; cookie: string };

export function bugRelayConfigured(): boolean {
  return false;
}

export async function bugRelay(): Promise<BugRelay | null> {
  return null;
}

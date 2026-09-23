// Which supported interface language fits a list of locale preferences (BCP 47 tags, best first:
// `navigator.languages`, the OS locale). The first tag whose primary subtag is supported wins, so a
// user who lists "pt-BR, ja" gets Japanese rather than a default. No match gives `null`: the caller
// then falls back to English, the language most people can read, never to the French source.
export function pickLanguage<T extends string>(
  preferences: readonly (string | null | undefined)[],
  supported: readonly T[],
): T | null {
  for (const tag of preferences) {
    const primary = String(tag || "").trim().toLowerCase().split(/[-_]/)[0];
    if ((supported as readonly string[]).includes(primary)) return primary as T;
  }
  return null;
}

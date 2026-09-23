import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import i18n from "@/i18n"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Dernier segment d'un chemin (Windows ou POSIX) → nom de fichier.
export function basename(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || p;
}

// Décalage (s) de la vignette d'un plan : on capture quelques frames APRÈS le début, jamais la
// toute 1re frame (souvent une transition/fondu/flou de coupe → vignette trompeuse). ~3-4 frames à
// 24 fps. Source UNIQUE : sert aussi de clé de cache (path@time.toFixed(2)) → écriture et lecture
// DOIVENT passer la même valeur, donc tous les appels passent par thumbTime().
const THUMB_LEAD = 0.15;

// Instant « AUTO » : le core choisit une frame REPRÉSENTATIVE (≈10 % de la durée) au lieu du début
// du fichier. À passer pour un CLIP ENTIER (pas d'in-point utile) : les rushs ouvrent presque
// toujours sur du noir (fondu, logo, amorce) → une vignette prise à t≈0 est une case noire.
// Un plan TRIMÉ garde son in-point (thumbTime) : c'est l'image du plan, elle doit être exacte.
export const THUMB_AUTO = -1;

// Instant (s) où générer/lire la vignette d'un plan. Borné à 40 % de la durée du plan pour les
// plans très courts (sinon on viserait au-delà de la fin → frame noire / plan suivant).
export function thumbTime(inSec: number, outSec?: number): number {
  const span = outSec != null ? outSec - inSec : Infinity;
  return inSec + (span > 0 ? Math.min(THUMB_LEAD, span * 0.4) : THUMB_LEAD);
}

// Formate une durée (secondes) en horodatage lisible — source unique pour les lecteurs et grilles.
//  - centis : ajoute les centièmes (`.cs`) → précision lecteur (mm:ss.cs).
//  - hours  : préfixe l'heure quand t ≥ 1 h (h:mm:ss) ; sinon mm:ss.
//  - padMinutes : zéro-pad les minutes (`05:` au lieu de `5:`).
export function fmtTime(t: number, opts: { centis?: boolean; hours?: boolean; padMinutes?: boolean } = {}): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const { centis = false, hours = false, padMinutes = true } = opts;
  const h = Math.floor(t / 3600);
  const m = hours ? Math.floor((t % 3600) / 60) : Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const mm = padMinutes ? String(m).padStart(2, "0") : String(m);
  let out = `${mm}:${String(s).padStart(2, "0")}`;
  if (hours && h > 0) out = `${h}:${out}`;
  if (centis) out += `.${String(Math.floor((t % 1) * 100)).padStart(2, "0")}`;
  return out;
}

// The locale every date, time, number and sort order is written in: the interface language,
// never the OS locale nor a hardcoded "fr-FR".
export function uiLocale(): string {
  return i18n.language || "en";
}

// A displayed number in the interface language: "1,5" in French, "1.5" in English, "1.5" in
// Japanese. Never `toFixed` or `String(n)` for text a person reads.
export function fmtNumber(n: number, options: Intl.NumberFormatOptions = { maximumFractionDigits: 1 }): string {
  return new Intl.NumberFormat(uiLocale(), options).format(Number.isFinite(n) ? n : 0);
}

// Seconds, short, with the unit the language writes: "1,5s", "1.5s", "1,5 Sek.", "1.5秒".
export function fmtSeconds(n: number, maximumFractionDigits = 1): string {
  return fmtNumber(n, { style: "unit", unit: "second", unitDisplay: "narrow", maximumFractionDigits });
}

// A 0–1 ratio as a percentage: "50 %" in French, "50%" in English.
export function fmtPercent(ratio: number, maximumFractionDigits = 0): string {
  return fmtNumber(ratio, { style: "percent", maximumFractionDigits });
}

// A number typed by a person, whatever their locale: "1,5", "1.5", "１．５" (full-width IME input)
// and "−2" all parse. With both separators, the last one is the decimal mark ("1.234,5",
// "1,234.5"); spaces and apostrophes group digits. `NaN` when the text starts with no number.
export function parseDecimal(text: string): number {
  let s = String(text ?? "").normalize("NFKC").replace(/[\s'’]/g, "").replace(/−/g, "-");
  const comma = s.lastIndexOf(","), dot = s.lastIndexOf(".");
  if (comma !== -1 && dot !== -1) s = comma > dot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (comma !== -1) s = s.replace(",", ".");
  const m = /^[+-]?(\d+(\.\d*)?|\.\d+)/.exec(s);
  return m ? Number(m[0]) : NaN;
}

// Bytes → "1,5 Go" in French, "1.5 GB" in English: the unit and the decimal mark follow the UI
// language. Single source on the renderer side, so a cache, an export or an embedded media file
// shows its size the same way everywhere.
const BYTE_UNITS = ["kilobyte", "megabyte", "gigabyte", "terabyte"] as const;
export function fmtBytes(n: number | undefined | null): string {
  const lang = uiLocale();
  const bytes = n && n > 0 ? n : 0;
  if (bytes < 1024) return `${new Intl.NumberFormat(lang).format(bytes)} ${lang.startsWith("fr") ? "o" : "B"}`;
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < BYTE_UNITS.length - 1) {
    value /= 1024;
    i++;
  }
  return new Intl.NumberFormat(lang, { style: "unit", unit: BYTE_UNITS[i], maximumFractionDigits: value >= 10 ? 0 : 1 }).format(value);
}



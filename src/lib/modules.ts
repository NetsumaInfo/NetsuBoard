import type { TabId } from "@/store/types";

export const MODULE_IDS = [
  "derush",
  "search",
  "reference",
  "notebook",
  "script",
  "upscale",
  "voice",
  "chat",
  "optimisation",
  "transfer",
] as const satisfies readonly TabId[];

export type ModuleId = (typeof MODULE_IDS)[number];

export const REQUIRED_MODULES: readonly ModuleId[] = ["derush"];

const MODULE_PREFS_KEY = "nr.modules.v2";

export interface ModulePreferences {
  order: ModuleId[];
  hidden: ModuleId[];
}

function isModuleId(value: unknown): value is ModuleId {
  return typeof value === "string" && (MODULE_IDS as readonly string[]).includes(value);
}

function normalizeModuleOrder(value: unknown): ModuleId[] {
  const provided = Array.isArray(value) ? value.filter(isModuleId) : [];
  return [...new Set([...provided, ...MODULE_IDS])];
}

export function normalizeHiddenModules(value: unknown): ModuleId[] {
  if (!Array.isArray(value)) return [];
  const required = new Set(REQUIRED_MODULES);
  return [...new Set(value.filter(isModuleId))].filter((id) => !required.has(id));
}

export function loadModulePreferences(): ModulePreferences {
  try {
    const raw = localStorage.getItem(MODULE_PREFS_KEY);
    if (!raw) return { order: [...MODULE_IDS], hidden: [] };
    const parsed = JSON.parse(raw) as Partial<ModulePreferences>;
    return {
      order: normalizeModuleOrder(parsed.order),
      hidden: normalizeHiddenModules(parsed.hidden),
    };
  } catch {
    return { order: [...MODULE_IDS], hidden: [] };
  }
}

export function saveModulePreferences(preferences: ModulePreferences): void {
  try {
    localStorage.setItem(MODULE_PREFS_KEY, JSON.stringify({
      order: normalizeModuleOrder(preferences.order),
      hidden: normalizeHiddenModules(preferences.hidden),
    }));
  } catch {
    // Le store reste utilisable quand le stockage du webview est indisponible.
  }
}

export function enabledFromHidden(hidden: readonly ModuleId[]): ModuleId[] {
  const hiddenSet = new Set(hidden);
  return MODULE_IDS.filter((id) => !hiddenSet.has(id));
}

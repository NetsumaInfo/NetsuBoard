export type CollaborationPerformanceMode = "live" | "balanced" | "economy";

export type CollaborationPerformanceSettings = {
  mode: CollaborationPerformanceMode;
  coalesceMs: number;
  previewConcurrency: number;
  originalConcurrency: number;
  autoResolveOriginals: boolean;
};

const STORAGE_KEY = "netsuboard.collaboration.performance.v1";
const CHANGE_EVENT = "nb-collab-performance-changed";
const DEFAULT_MODE: CollaborationPerformanceMode = "balanced";

const PROFILES: Record<CollaborationPerformanceMode, Omit<CollaborationPerformanceSettings, "mode">> = {
  live: { coalesceMs: 60, previewConcurrency: 6, originalConcurrency: 2, autoResolveOriginals: true },
  balanced: { coalesceMs: 200, previewConcurrency: 4, originalConcurrency: 2, autoResolveOriginals: true },
  economy: { coalesceMs: 900, previewConcurrency: 2, originalConcurrency: 1, autoResolveOriginals: false },
};

function isMode(value: string | null): value is CollaborationPerformanceMode {
  return value === "live" || value === "balanced" || value === "economy";
}

export function getCollaborationPerformanceMode(): CollaborationPerformanceMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isMode(value) ? value : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

export function getCollaborationPerformanceSettings(
  mode: CollaborationPerformanceMode = getCollaborationPerformanceMode(),
  hardwareConcurrency?: number,
): CollaborationPerformanceSettings {
  const profile = PROFILES[mode];
  const hardware = hardwareConcurrency
    ?? (typeof navigator === "undefined" ? 4 : navigator.hardwareConcurrency || 4);
  const weakDevice = hardware <= 4;
  return {
    mode,
    ...profile,
    previewConcurrency: weakDevice ? Math.min(profile.previewConcurrency, 2) : profile.previewConcurrency,
    originalConcurrency: profile.originalConcurrency,
  };
}

export function setCollaborationPerformanceMode(mode: CollaborationPerformanceMode): void {
  if (!isMode(mode)) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Settings remain session-local when storage is unavailable (private WebView, quota, or tests).
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeCollaborationPerformance(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

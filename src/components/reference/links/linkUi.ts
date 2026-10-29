// Transient UI state of the links layer that other components must be able to trigger: the edge
// whose label is being edited, the hovered link, the "Link to…" pick mode, the item whose links
// Tab cycles through and the collapsed subtrees. Never persisted, never synced.

import { create } from "zustand";

interface LinkUi {
  editing: string | null;
  hovered: string | null;
  // "Link to…": the next item clicked is linked from these items.
  pickFrom: string[] | null;
  // Item whose links Tab steps through (kept while one of its links is selected).
  cyclePivot: string | null;
  startEdit: (shapeId: string) => void;
  stopEdit: () => void;
  setHovered: (shapeId: string | null) => void;
  startPick: (fromIds: string[]) => void;
  stopPick: () => void;
  setCyclePivot: (itemId: string | null) => void;
  // Items whose downstream subtree is hidden (view only, local to this window).
  collapsed: string[];
  toggleCollapsed: (itemIds: string[]) => void;
}

export const useLinkUi = create<LinkUi>((set) => ({
  editing: null,
  hovered: null,
  pickFrom: null,
  cyclePivot: null,
  startEdit: (shapeId) => set({ editing: shapeId }),
  stopEdit: () => set({ editing: null }),
  setHovered: (shapeId) => set((s) => (s.hovered === shapeId ? s : { hovered: shapeId })),
  startPick: (fromIds) => set({ pickFrom: fromIds.length ? fromIds : null }),
  stopPick: () => set({ pickFrom: null }),
  setCyclePivot: (itemId) => set({ cyclePivot: itemId }),
  collapsed: [],
  // Collapses them all, or expands them all when every one of them is collapsed already.
  toggleCollapsed: (itemIds) => set((s) => {
    const all = itemIds.every((id) => s.collapsed.includes(id));
    return { collapsed: all ? s.collapsed.filter((id) => !itemIds.includes(id)) : [...new Set([...s.collapsed, ...itemIds])] };
  }),
}));

// Leaving a link keeps it "hovered" a moment, so the pointer can travel to its grab dot.
const HOVER_GRACE_MS = 350;
let leaveTimer: ReturnType<typeof setTimeout> | null = null;

export function enterLink(shapeId: string): void {
  if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
  useLinkUi.getState().setHovered(shapeId);
}

export function leaveLink(): void {
  if (leaveTimer) clearTimeout(leaveTimer);
  leaveTimer = setTimeout(() => { leaveTimer = null; useLinkUi.getState().setHovered(null); }, HOVER_GRACE_MS);
}

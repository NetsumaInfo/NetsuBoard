import { ConvexReactClient } from "convex/react";

// Convex deployment URL (*.convex.cloud). Absent until `npx convex dev` has run: the client stays
// null → the app boots exactly as before (dev/browser/mock, zero regression).
const url = import.meta.env.VITE_CONVEX_URL as string | undefined;

export const convexClient = url ? new ConvexReactClient(url) : null;

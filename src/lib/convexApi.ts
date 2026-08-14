import { anyApi } from "convex/server";

// UNTYPED Convex API: the generated types (`convex/_generated/api`) only exist after
// `npx convex dev`. anyApi keeps `npm run build` green BEFORE provisioning and references functions
// by path (e.g. `api.access.getAccess`, `api.auth.getCurrentUser`).
export const api = anyApi;

// Convex configuration witness with NO dependency. The boot paths (main, App) read it to decide
// whether to load the auth chain — `convexClient.ts` pulls `convex/react` and `authClient.ts` pulls
// `better-auth`, hundreds of kilobytes of JS to parse at startup for a feature that does not exist
// when `VITE_CONVEX_URL` is absent (dev, browser mock). Reading the env here keeps that cost behind
// a dynamic import.
export const convexConfigured = !!(import.meta.env.VITE_CONVEX_URL as string | undefined);

// Deployment site (*.convex.site): HTTP routes, including the bug report relay. Distinct from
// `VITE_CONVEX_URL` (*.convex.cloud), which serves the functions.
export const convexSiteUrl = (import.meta.env.VITE_CONVEX_SITE_URL as string | undefined) || "";

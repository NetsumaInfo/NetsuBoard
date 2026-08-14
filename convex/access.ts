import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { authComponent } from "./auth";

// Result read by the renderer's LoginGate: signed in? beta access? role.
// OPEN_BETA=true → every signed-in account has access.
// ALLOWLIST mode: set OPEN_BETA=false, then only a `betaGrants.role != "pending"` gets through.
export const getAccess = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      return { authenticated: false, hasAccess: false, role: null as string | null };
    }
    const openBeta = process.env.OPEN_BETA === "true";
    const grant = await ctx.db
      .query("betaGrants")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    const role = grant?.role ?? "pending";
    const hasAccess = openBeta || role !== "pending";
    return { authenticated: true, hasAccess, role, userId: user._id };
  },
});

// Manual grant (allowlist mode). Internal: called from the Convex dashboard or an admin tool, never
// exposed to the client. e.g. npx convex run access:grantAccess '{"userId":"…","role":"member"}'
export const grantAccess = internalMutation({
  args: { userId: v.string(), role: v.optional(v.string()), note: v.optional(v.string()) },
  handler: async (ctx, { userId, role, note }) => {
    const existing = await ctx.db
      .query("betaGrants")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const patch = { role: role ?? "member", grantedAt: Date.now(), note };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("betaGrants", { userId, ...patch });
    }
  },
});

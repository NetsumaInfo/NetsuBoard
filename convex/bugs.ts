import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

// Nobody gets to flood the channel: past this many reports per hour for one key, the relay answers
// 429 and never calls Discord. The key is the account id when the send is authenticated, otherwise
// the IP fingerprint — so an anonymous send is capped too, without every anonymous sender sharing a
// single counter.
const MAX_PER_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;

export const recentCount = internalQuery({
  args: { quotaKey: v.optional(v.string()) },
  handler: async (ctx, { quotaKey }) => {
    const since = Date.now() - HOUR_MS;
    const rows = await ctx.db
      .query("bugReports")
      .withIndex("by_quota_created", (q) => q.eq("quotaKey", quotaKey).gt("createdAt", since))
      .collect();
    return { count: rows.length, allowed: rows.length < MAX_PER_HOUR, max: MAX_PER_HOUR };
  },
});

// Written AFTER Discord accepts: a report recorded here is a report that really is in the channel,
// otherwise the hourly cap would fill up with sends that never landed.
export const record = internalMutation({
  args: {
    reportId: v.string(),
    userId: v.optional(v.string()),
    userName: v.optional(v.string()),
    quotaKey: v.optional(v.string()),
    severity: v.optional(v.string()),
    category: v.optional(v.string()),
    module: v.optional(v.string()),
    appVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("bugReports", { ...args, createdAt: Date.now() });
  },
});

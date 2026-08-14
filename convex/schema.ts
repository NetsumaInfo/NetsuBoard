import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Application tables. The AUTH tables belong to the `@convex-dev/better-auth` component and are
// isolated from these. NetsuBoard needs exactly two things from a backend: who is allowed in, and
// enough of a trace to rate-limit bug reports. Everything else stays on the user's disk.
export default defineSchema({
  // Per-user access rights (Better Auth id). Open beta = the OPEN_BETA env flag; this table serves
  // the ALLOWLIST mode (manual grant) without a schema change.
  betaGrants: defineTable({
    userId: v.string(), // Better Auth user id (component document._id)
    role: v.string(), // "member" | "admin" | "pending"
    grantedAt: v.number(),
    note: v.optional(v.string()),
  }).index("by_user", ["userId"]),

  // Trace of the bug reports relayed to Discord. The CONTENT stays in the channel (embed plus
  // attachments): only what is needed to find a report again and to cap one account's sending.
  bugReports: defineTable({
    reportId: v.string(), // NB-XXXX, same as the Discord embed title
    userId: v.optional(v.string()), // Better Auth id when the send is authenticated
    userName: v.optional(v.string()),
    // Hourly-cap key: account id, or a salted fingerprint of the IP for an anonymous send (the IP
    // itself is never written).
    quotaKey: v.optional(v.string()),
    severity: v.optional(v.string()),
    category: v.optional(v.string()),
    module: v.optional(v.string()),
    appVersion: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_report", ["reportId"])
    .index("by_quota_created", ["quotaKey", "createdAt"]),
});

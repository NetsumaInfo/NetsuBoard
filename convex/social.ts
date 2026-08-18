// Friend graph for collaborative projects (docs/collab.md §5).
//
// Discord signs the user in and nothing more: reading someone's Discord friends needs the
// `relationships.read` scope, which is part of the Social SDK and gated behind Discord's approval.
// So the graph is NetsuBoard's own, keyed by Better Auth ids, and someone is added by a stable
// NetsuBoard handle derived from their authenticated account.
//
// Every function authenticates and scopes to the caller. Membership and friendship are checked
// server-side: possession of a key is never authorisation.

import {
  query,
  mutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { authComponent } from "./auth";

const MAX_FRIENDS = 200;
const MAX_PENDING_REQUESTS = 100;

function validText(value: string, maximum: number) {
  return (
    value.length > 0 &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

async function requireUser(ctx: QueryCtx) {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) throw new Error("not signed in");
  return user;
}

function normalizeHandle(handle: string) {
  return handle
    .trim()
    .replace(/^@/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function profileHandle(suggested: string, accountId: string) {
  const base = normalizeHandle(suggested) || "user";
  const suffix = accountId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(-16);
  if (!suffix) throw new Error("account cannot produce a stable handle");
  return `${base.slice(0, 64 - suffix.length - 1)}-${suffix}`;
}

async function profileOf(ctx: QueryCtx, userId: string) {
  return await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

async function publicProfile(ctx: QueryCtx, userId: string) {
  const profile = await profileOf(ctx, userId);
  return {
    userId,
    handle: profile?.handle ?? "",
    name: profile?.name ?? "",
    image: profile?.image ?? null,
  };
}

/**
 * Publishes the caller's server-authenticated public fields so others can find them by a unique
 * NetsuBoard handle.
 *
 * Called by the renderer on every authenticated start so display-name or avatar changes do not
 * leave a stale row that nobody can resolve.
 */
export const upsertProfile = mutation({
  args: { handle: v.string() },
  handler: async (ctx, { handle }) => {
    const user = await requireUser(ctx);
    const base = normalizeHandle(handle) || "user";
    // The suffix is derived server-side from the authenticated account. Another renderer cannot
    // pre-claim or impersonate it by choosing the same visible Discord name.
    const normalized = profileHandle(base, user._id);
    const name = user.name?.trim() || base;
    const image = user.image || undefined;
    if (!validText(normalized, 64) || !validText(name, 120))
      throw new Error("invalid public profile");
    if (image) {
      if (image.length > 2048) throw new Error("profile image URL is too long");
      try {
        if (new URL(image).protocol !== "https:") throw new Error();
      } catch {
        throw new Error("profile image URL must use HTTPS");
      }
    }
    const existing = await profileOf(ctx, user._id);
    const handleOwner = await ctx.db
      .query("profiles")
      .withIndex("by_handle", (q) => q.eq("handle", normalized))
      .unique();
    if (handleOwner && handleOwner.userId !== user._id)
      throw new Error("this NetsuBoard handle is already in use");
    const row = {
      userId: user._id,
      handle: normalized,
      name,
      image,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("profiles", row);
    return { handle: normalized };
  },
});

/** Friends, plus requests in both directions. One query feeds the whole settings section. */
export const listSocial = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return { friends: [], incoming: [], outgoing: [], self: null };

    const friendRows = await ctx.db
      .query("friends")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(MAX_FRIENDS);
    const incomingRows = await ctx.db
      .query("friendRequests")
      .withIndex("by_to", (q) => q.eq("toUserId", user._id))
      .take(MAX_PENDING_REQUESTS);
    const outgoingRows = await ctx.db
      .query("friendRequests")
      .withIndex("by_from", (q) => q.eq("fromUserId", user._id))
      .take(MAX_PENDING_REQUESTS);

    return {
      self: await publicProfile(ctx, user._id),
      friends: await Promise.all(
        friendRows.map(async (row) => ({
          ...(await publicProfile(ctx, row.friendId)),
          since: row.since,
        })),
      ),
      incoming: await Promise.all(
        incomingRows.map(async (row) => ({
          requestId: row._id,
          ...(await publicProfile(ctx, row.fromUserId)),
        })),
      ),
      outgoing: await Promise.all(
        outgoingRows.map(async (row) => ({
          requestId: row._id,
          ...(await publicProfile(ctx, row.toUserId)),
        })),
      ),
    };
  },
});

/**
 * Sends a friend request by handle.
 *
 * A request that crosses one already coming the other way is accepted immediately: making two people
 * who each asked first wait for one another would be a dead end with no way out.
 */
export const sendRequest = mutation({
  args: { handle: v.string() },
  handler: async (ctx, { handle }) => {
    const user = await requireUser(ctx);
    const normalized = normalizeHandle(handle);
    if (!validText(normalized, 64)) throw new Error("invalid handle");
    const target = await ctx.db
      .query("profiles")
      .withIndex("by_handle", (q) => q.eq("handle", normalized))
      .unique();
    if (!target) return { status: "unknown" as const };
    if (target.userId === user._id) return { status: "self" as const };

    const already = await ctx.db
      .query("friends")
      .withIndex("by_pair", (q) =>
        q.eq("userId", user._id).eq("friendId", target.userId),
      )
      .unique();
    if (already) return { status: "already" as const };

    const mirrored = await ctx.db
      .query("friendRequests")
      .withIndex("by_pair", (q) =>
        q.eq("fromUserId", target.userId).eq("toUserId", user._id),
      )
      .unique();
    if (mirrored) {
      await link(ctx, user._id, target.userId);
      await ctx.db.delete(mirrored._id);
      return { status: "linked" as const };
    }

    const pending = await ctx.db
      .query("friendRequests")
      .withIndex("by_pair", (q) =>
        q.eq("fromUserId", user._id).eq("toUserId", target.userId),
      )
      .unique();
    if (pending) return { status: "pending" as const };

    const outgoing = await ctx.db
      .query("friendRequests")
      .withIndex("by_from", (q) => q.eq("fromUserId", user._id))
      .take(MAX_PENDING_REQUESTS);
    const incoming = await ctx.db
      .query("friendRequests")
      .withIndex("by_to", (q) => q.eq("toUserId", target.userId))
      .take(MAX_PENDING_REQUESTS);
    if (
      outgoing.length >= MAX_PENDING_REQUESTS ||
      incoming.length >= MAX_PENDING_REQUESTS
    ) {
      throw new Error("friend request limit reached");
    }

    await ctx.db.insert("friendRequests", {
      fromUserId: user._id,
      toUserId: target.userId,
      createdAt: Date.now(),
    });
    return { status: "sent" as const };
  },
});

export const respondRequest = mutation({
  args: { requestId: v.id("friendRequests"), accept: v.boolean() },
  handler: async (ctx, { requestId, accept }) => {
    const user = await requireUser(ctx);
    const request = await ctx.db.get(requestId);
    // Only the addressee decides. A sender cancelling their own request deletes it below.
    if (!request) return { status: "gone" as const };
    if (request.toUserId !== user._id && request.fromUserId !== user._id)
      throw new Error("not yours");
    if (accept && request.toUserId === user._id)
      await link(ctx, request.fromUserId, request.toUserId);
    await ctx.db.delete(requestId);
    return { status: accept ? ("linked" as const) : ("declined" as const) };
  },
});

export const removeFriend = mutation({
  args: { friendId: v.string() },
  handler: async (ctx, { friendId }) => {
    const user = await requireUser(ctx);
    if (!validText(friendId, 256)) throw new Error("invalid friend id");
    await unlink(ctx, user._id, friendId);
    await unlink(ctx, friendId, user._id);
    return { status: "removed" as const };
  },
});

// Two rows, one per direction: neither side has to read the other's index to list its own friends.
async function link(ctx: MutationCtx, a: string, b: string) {
  const since = Date.now();
  for (const userId of [a, b]) {
    const rows = await ctx.db
      .query("friends")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(MAX_FRIENDS);
    if (rows.length >= MAX_FRIENDS) throw new Error("friend limit reached");
  }
  for (const [userId, friendId] of [
    [a, b],
    [b, a],
  ]) {
    const existing = await ctx.db
      .query("friends")
      .withIndex("by_pair", (q) =>
        q.eq("userId", userId).eq("friendId", friendId),
      )
      .unique();
    if (!existing) await ctx.db.insert("friends", { userId, friendId, since });
  }
}

async function unlink(ctx: MutationCtx, userId: string, friendId: string) {
  const row = await ctx.db
    .query("friends")
    .withIndex("by_pair", (q) =>
      q.eq("userId", userId).eq("friendId", friendId),
    )
    .unique();
  if (row) await ctx.db.delete(row._id);
}

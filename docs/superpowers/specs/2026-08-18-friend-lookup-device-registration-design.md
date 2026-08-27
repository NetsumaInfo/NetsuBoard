# Friend lookup and device registration repair

## Status

Approved through runtime feedback: the add-friend field must accept the Discord numeric id shown by
Discord, the current unique Discord username, and the existing NetsuBoard handle. The device card
must register the already-created native identity and must never render a structured native failure
as `[object Object]`.

## Goals

- Resolve an exact Discord snowflake, exact current Discord username, or exact NetsuBoard handle to
  one authenticated NetsuBoard account and send the existing friend request.
- Keep lookups indexed and bounded so the feature remains suitable for the Convex free plan.
- Bind Discord directory fields to the server-observed OAuth account, never renderer claims.
- Preserve the Discord id as the stable account link while allowing the mutable username to refresh.
- Register a native device when its optional label is absent.
- Keep the Tauri JSON contract camel-cased and show the structured native error message.

## Social directory contract

`profiles` gains optional `discordId` and `discordUsername` fields with exact indexes. They remain
optional for deployment compatibility: an existing account becomes searchable through Discord as
soon as it opens the updated authenticated application and the existing Discord profile action
refreshes `/users/@me`.

The Discord action records both `username` and `global_name` separately. After Discord authenticates
the request, an internal mutation upserts the caller's profile with the Better Auth user id, name,
avatar, stable Discord snowflake, and normalized current username. The renderer cannot submit either
Discord lookup field. When Discord proves that a username moved to another snowflake, stale profile
rows lose that username before the current row receives it.

The friend mutation accepts a single `identifier` string. It performs at most three exact indexed
lookups: NetsuBoard handle, Discord id for a decimal snowflake, and normalized Discord username. It
deduplicates matches by Better Auth user id. Zero matches return `unknown`; one match follows the
existing self/already/pending/sent/linked flow; multiple distinct accounts return `ambiguous` and do
not create a request. No prefix search, Discord-wide directory request, or renderer-supplied target
account id is introduced.

## Device and error contract

The native registration payload omits `label` when no device label is configured because Convex
`v.optional(v.string())` accepts an absent field but rejects JSON `null`. A focused Rust helper builds
that payload so serialization is covered without a live deployment.

`DeviceIdentityPublic` serializes with `camelCase`, matching the TypeScript `deviceId` contract. A
shared renderer helper extracts `message` from both JavaScript `Error` instances and Tauri's
serialized `{ code, message }` failures, falling back to localized copy for unknown values.

## UI and migration

The field copy names all three accepted identifiers. The existing single-field, single-button flow
is retained. `ambiguous` has distinct localized copy and never selects a person silently. All six
locales remain structurally identical.

No backfill scans are required. Profile synchronization is opportunistic on authenticated startup,
and every friend lookup stays an indexed point read. The updated Convex functions must be deployed
before runtime verification. Rust changes require the user to restart the existing Tauri window;
the agent does not launch, close, or rebuild it.

## Acceptance

- Unit tests distinguish and normalize NetsuBoard handles, Discord snowflakes, and Discord usernames.
- Policy tests prove ambiguous matches fail closed and stale username ownership is replaceable.
- Rust tests prove public identity camel-casing and label omission.
- Renderer tests prove structured Tauri errors never become `[object Object]`.
- Collaboration tests, locale parity, renderer build, core check, and `cargo check --locked` pass.
- Runtime remains explicitly unverified until Convex is deployed and the existing app is restarted.

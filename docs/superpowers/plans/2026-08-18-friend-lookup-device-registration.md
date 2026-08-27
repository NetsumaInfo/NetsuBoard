# Friend Lookup and Device Registration Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make friend requests resolve exact Discord ids, Discord usernames, or NetsuBoard handles and repair native device registration/error display.

**Architecture:** Discord-owned identity fields are synchronized by the authenticated Convex action into indexed optional profile fields, while the existing friend mutation resolves a bounded exact identifier. Native serialization helpers make optional JSON omission and camel-casing testable, and one renderer helper normalizes structured Tauri failures.

**Tech Stack:** Convex, Better Auth Discord OAuth, React/TypeScript, Tauri/Rust, Vitest, Cargo tests, i18next.

---

### Task 1: Lock the identifier and error contracts with failing tests

**Files:**
- Modify: `test/collab/convex-policy.test.ts`
- Create: `test/collab/client-errors.test.ts`
- Modify: `src-tauri/src/collab/identity.rs`
- Modify: `src-tauri/src/collab/service.rs`

- [ ] **Step 1: Add policy tests for all identifier forms**

Import and test pure `classifySocialIdentifier` and `uniqueProfileIds` helpers. Assert that
`1010539781551292598` is a Discord id, `netsuma` is a Discord username candidate,
`@netsuma-4jb1phz6tx8cfgcx` is normalized as a NetsuBoard handle, duplicate matches for one user are
deduplicated, and two user ids remain ambiguous.

- [ ] **Step 2: Add the renderer structured-error test**

Assert `collabErrorMessage({ code: "validation", message: "registration failed" }, "fallback")`
returns `registration failed`, while opaque objects return the fallback.

- [ ] **Step 3: Add Rust serialization tests**

Serialize a `DeviceIdentityPublic` fixture and assert it contains `deviceId`, `exchangePublic`, and
`createdAt`, not snake_case. Build registration arguments with `None` and assert `label` is absent;
with `Some("Laptop")`, assert it is present.

- [ ] **Step 4: Run the focused tests and verify RED**

Run: `npx vitest run test/collab/convex-policy.test.ts test/collab/client-errors.test.ts`

Expected: FAIL because the pure helpers do not exist.

Run from `src-tauri/`: `cargo test --locked collab::identity collab::service --lib`

Expected: FAIL because identity fields are snake-cased and registration arguments always include
`label: null`.

### Task 2: Implement the server-owned Discord directory

**Files:**
- Modify: `convex/schema.ts`
- Modify: `convex/discord.ts`
- Modify: `convex/social.ts`
- Modify: `src/components/settings/useDiscordProfile.ts`
- Modify: `src/components/settings/CollabSection.tsx`

- [ ] **Step 1: Add optional indexed Discord fields**

Add `discordId` and normalized `discordUsername` to `profiles`, plus `by_discord_id` and
`by_discord_username` indexes. Keep both optional so existing rows remain valid.

- [ ] **Step 2: Synchronize only verified Discord fields**

Return `username` and `displayName` separately from `/users/@me`. Call an internal social mutation
with the authenticated Better Auth user and API response. The mutation creates or patches the
profile, clears stale ownership of the current username, validates the snowflake/username, and never
accepts renderer identity claims.

- [ ] **Step 3: Resolve a bounded identifier**

Replace `sendRequest({ handle })` with `sendRequest({ identifier })`. Gather exact indexed matches,
deduplicate by `userId`, return `ambiguous` for more than one target, and otherwise reuse the existing
friendship state machine unchanged.

- [ ] **Step 4: Make the UI use the identifier contract**

Rename local state from `handle` to `identifier`, call the new mutation argument, keep the current
single button, and expose the new `ambiguous` status.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run test/collab/convex-policy.test.ts`

Expected: PASS.

### Task 3: Repair native registration and renderer errors

**Files:**
- Modify: `src-tauri/src/collab/identity.rs`
- Modify: `src-tauri/src/collab/service.rs`
- Modify: `src/lib/collab/client.ts`
- Modify: `src/components/settings/CollabSection.tsx`
- Test: `test/collab/client-errors.test.ts`

- [ ] **Step 1: Camel-case the public identity**

Add `#[serde(rename_all = "camelCase")]` to `DeviceIdentityPublic`.

- [ ] **Step 2: Omit an absent label**

Build registration JSON from mandatory statement/signature fields, inserting `label` only for a
non-empty configured label, then pass that object to `devices:registerDevice`.

- [ ] **Step 3: Normalize native errors**

Export `collabErrorMessage(error, fallback)` from the collaboration client and use it in all three
`CollabSection` native catches.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run test/collab/client-errors.test.ts`

Run from `src-tauri/`: `cargo test --locked collab::identity collab::service --lib`

Expected: both commands PASS.

### Task 4: Localize, document, and validate

**Files:**
- Modify: `src/locales/fr/settings.json`
- Modify: `src/locales/en/settings.json`
- Modify: `src/locales/de/settings.json`
- Modify: `src/locales/es/settings.json`
- Modify: `src/locales/ja/settings.json`
- Modify: `src/locales/zh/settings.json`
- Modify: `docs/collab.md`
- Modify: `docs/collab-acceptance.md`

- [ ] **Step 1: Update all six locale contracts**

Name Discord id, Discord username, and NetsuBoard id in subtitle/placeholder/unknown copy, and add a
distinct `ambiguous` status key.

- [ ] **Step 2: Record the indexed directory and runtime prerequisites**

Document server-owned Discord fields, exact bounded lookup, deployment requirement, native restart,
and the still-unverified two-account smoke test.

- [ ] **Step 3: Run repository verification**

Run separately: `npm run test:collab`, `npm run check:i18n`, `npm run check:core`, `npm run build`.

Run from `src-tauri/`: `cargo fmt --check`, then `cargo check --locked`.

Expected: every command exits zero. Do not launch, close, package, or rebuild the running app.

- [ ] **Step 4: Inspect scope**

Run: `git diff --check` and `git status --short`.

Expected: only the planned files plus the pre-existing untracked `docs/perso.lnk`; never stage the
shortcut. State that NetsuRush must receive the equivalent board/social fix manually.

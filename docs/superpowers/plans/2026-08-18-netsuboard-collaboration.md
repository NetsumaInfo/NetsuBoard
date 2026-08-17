# NetsuBoard Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete 2-to-10-person local-first collaboration contract in the approved design, including native authority, secure membership, offline recovery, P2P media, lifecycle UI, and acceptance evidence.

**Architecture:** A single Rust `CollabService` actor owns Loro, iroh, keys, durable SQLite state, media, and authenticated Convex HTTP calls. React renderers submit typed intent and render projections; Convex stores only authenticated metadata and encrypted recovery objects. Every production behavior is introduced through a failing Rust or Vitest test before implementation.

**Tech Stack:** Tauri 2.11, Rust 2021, Loro 1.x, iroh 1.x, Tokio, rusqlite, reqwest, XChaCha20-Poly1305, HPKE/X25519, Ed25519, BLAKE3, React 19, TypeScript 5.8, Vitest, Convex 1.44, Better Auth.

---

## File map

Native collaboration files remain focused under `src-tauri/src/collab/`:

- `error.rs`: serializable typed errors and stable error codes.
- `ids.rs`: validated identifiers, hashed storage keys, and confined paths.
- `identity.rs`: DPAPI-backed device identity and registration proofs.
- `store.rs`: SQLite schema, transactions, migration, durable updates, outbox, and blob metadata.
- `ops.rs`: versioned operation types and validation limits.
- `doc.rs`: Loro schema, atomic operation batches, snapshots, updates, and projections.
- `crypto.rs`: project key ring, sealing, signatures, envelopes, and rotation primitives.
- `convex.rs`: pinned authenticated Convex HTTP client and file uploads.
- `recovery.rs`: head publication, resume, CAS retry, and temporary-document compaction.
- `protocol.rs`: versioned iroh frames and handshake transcript.
- `net.rs`: endpoint lifecycle, authorization refresh, sync, presence, and bounded queues.
- `blobs.rs`: import grants, BLAKE3 store, resumable chunks, authorization, and GC.
- `service.rs`: the single actor and high-level command surface.
- `mod.rs`: exports only.

Renderer collaboration files live under `src/lib/collab/` instead of unrelated top-level helpers:

- `types.ts`: IPC, projection, role, status, and error contracts.
- `client.ts`: native command/event adapter and auth-token refresh.
- `projection.ts`: total conversion between native projection and `BoardItem`.
- `session.ts`: scene-bound project selection and lifecycle.
- `operations.ts`: board changes to typed native intent.

React files remain under `src/components/reference/` and settings. Convex modules use shared helpers in
`convex/collab/` so every public function follows the same authentication and authorization path.

## Task 1: Establish collaboration test harness and baseline

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vitest.config.ts`
- Create: `test/collab/smoke.test.ts`
- Create: `test/collab/convexHarness.ts`
- Modify: `src-tauri/src/collab/mod.rs`

- [ ] **Step 1: Add a failing renderer collaboration smoke test**

```ts
// test/collab/smoke.test.ts
import { describe, expect, it } from "vitest";
import { COLLAB_PROTOCOL_VERSION } from "../../src/lib/collab/types";

describe("collaboration contract", () => {
  it("starts at protocol version one", () => {
    expect(COLLAB_PROTOCOL_VERSION).toBe(1);
  });
});
```

- [ ] **Step 2: Install and run Vitest to verify RED**

Run: `npm install --save-dev vitest@latest convex-test@latest`

Run: `npx vitest run test/collab/smoke.test.ts`

Expected: FAIL because `src/lib/collab/types.ts` does not exist.

- [ ] **Step 3: Add the test configuration and minimal contract**

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
```

```ts
// test/collab/convexHarness.ts
import { convexTest } from "convex-test";
import schema from "../../convex/schema";

const modules = import.meta.glob("../../convex/**/*.ts");

export function createConvexHarness() {
  const backend = convexTest(schema, modules);
  const asAccount = (accountId: string) => backend.withIdentity({
    subject: accountId,
    issuer: "https://test.invalid",
    tokenIdentifier: `test|${accountId}`,
  });
  return { backend, asAccount };
}
```

```ts
// src/lib/collab/types.ts
export const COLLAB_PROTOCOL_VERSION = 1 as const;
```

Add `"test:collab": "vitest run test/collab"` to `scripts`.

- [ ] **Step 4: Verify GREEN and the existing static baseline**

Run: `npm run test:collab`

Expected: PASS.

Run: `cargo test --locked collab:: --lib` from `src-tauri/`.

Expected: the existing three identity tests pass before native replacement starts.

- [ ] **Step 5: Commit only harness files**

```bash
git add package.json package-lock.json vitest.config.ts test/collab/smoke.test.ts test/collab/convexHarness.ts src/lib/collab/types.ts
git commit -m "test(collab): add collaboration harness"
```

## Task 2: Validated identifiers, confined paths, and typed errors

**Files:**
- Create: `src-tauri/src/collab/error.rs`
- Create: `src-tauri/src/collab/ids.rs`
- Modify: `src-tauri/src/collab/mod.rs`
- Modify: `src-tauri/src/collab/crypto.rs`
- Modify: `src-tauri/src/collab/outbox.rs`
- Modify: `src-tauri/src/collab/blobs.rs`

- [ ] **Step 1: Write failing identifier and traversal tests**

```rust
#[test]
fn project_storage_key_never_contains_user_input() {
    let id = ProjectId::parse("jx71exampleproject").expect("valid id");
    assert_eq!(id.storage_key().len(), 64);
    assert!(id.storage_key().bytes().all(|byte| byte.is_ascii_hexdigit()));
}

#[test]
fn project_id_rejects_path_syntax() {
    for value in ["../escape", r"..\escape", "C:/escape", "a/b", "a:b"] {
        assert!(ProjectId::parse(value).is_err(), "accepted {value}");
    }
}

#[test]
fn opaque_token_is_random_and_expires() {
    let first = OpaqueToken::generate();
    let second = OpaqueToken::generate();
    assert_ne!(first, second);
    assert_eq!(first.as_str().len(), 64);
}
```

- [ ] **Step 2: Run the focused Rust test and verify RED**

Run: `cargo test --locked collab::ids --lib` from `src-tauri/`.

Expected: FAIL because `ids` and its types are absent.

- [ ] **Step 3: Implement validated newtypes and one confinement helper**

```rust
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct ProjectId(String);

impl ProjectId {
    pub fn parse(value: impl Into<String>) -> Result<Self, CollabError>;
    pub fn as_str(&self) -> &str;
    pub fn storage_key(&self) -> String;
}

pub fn confined_child(root: &Path, relative: &Path) -> Result<PathBuf, CollabError>;
```

`ProjectId::parse` accepts 1 to 128 ASCII alphanumeric, `_`, and `-` characters. `storage_key` is the
lowercase BLAKE3 hex digest. `confined_child` rejects absolute components, canonicalizes the root and
existing ancestor, and compares path components rather than string prefixes.

Define `CollabError { code: CollabErrorCode, message: String }` with stable codes for validation,
authorization, unavailable, conflict, corrupt, storage, network, key pending, and read-only.

- [ ] **Step 4: Replace raw project-id path joins**

Change key-ring, outbox, document, and blob paths to take `&ProjectId` and use `storage_key()`.

- [ ] **Step 5: Verify GREEN**

Run: `cargo test --locked collab::ids --lib` from `src-tauri/`.

Expected: PASS, including traversal and token tests.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/collab/error.rs src-tauri/src/collab/ids.rs src-tauri/src/collab/mod.rs src-tauri/src/collab/crypto.rs src-tauri/src/collab/outbox.rs src-tauri/src/collab/blobs.rs
git commit -m "fix(collab): confine native identifiers and paths"
```

## Task 3: Verified device identity and DPAPI key storage

**Files:**
- Modify: `src-tauri/src/collab/identity.rs`
- Create: `src-tauri/src/collab/device.rs`
- Modify: `src-tauri/src/collab/mod.rs`

- [ ] **Step 1: Write failing proof-binding tests**

```rust
#[test]
fn registration_proof_binds_every_public_identity() {
    let identity = DeviceIdentity::generate_for_test();
    let statement = RegistrationStatement::new(
        "challenge",
        "account",
        identity.device_id(),
        identity.signing_public(),
        identity.exchange_public(),
        identity.endpoint_id(),
    );
    let proof = identity.sign_registration(&statement);
    proof.verify(&statement).expect("valid proof");

    let changed = statement.with_endpoint("different-endpoint");
    assert!(proof.verify(&changed).is_err());
}
```

- [ ] **Step 2: Verify RED**

Run: `cargo test --locked registration_proof --lib` from `src-tauri/`.

Expected: FAIL because registration statements and proofs are absent.

- [ ] **Step 3: Implement domain-separated proof types**

```rust
#[derive(Serialize, Deserialize)]
pub struct RegistrationStatement {
    pub version: u16,
    pub challenge: String,
    pub account_id: String,
    pub device_id: String,
    pub signing_public: String,
    pub exchange_public: String,
    pub endpoint_id: String,
}

#[derive(Serialize, Deserialize)]
pub struct RegistrationProof {
    pub statement: RegistrationStatement,
    pub signature: String,
}
```

Canonical signing bytes are `b"netsuboard/device-registration/v1\0"` plus deterministic CBOR or a
length-prefixed field encoding. `deviceId` is the BLAKE3 digest of the Ed25519 public key.

- [ ] **Step 4: Harden DPAPI handling**

Keep signing and exchange secrets separate, zeroize plaintext buffers, pass immutable DPAPI input
buffers where the Windows API permits, write through a random temporary file, fsync, and atomically
replace the identity file.

- [ ] **Step 5: Verify GREEN**

Run: `cargo test --locked collab::identity collab::device --lib` from `src-tauri/`.

Expected: proof binding, reload stability, corrupt-file rejection, and different-key tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/collab/identity.rs src-tauri/src/collab/device.rs src-tauri/src/collab/mod.rs
git commit -m "feat(collab): prove and protect device identity"
```

## Task 4: Atomic SQLite project store and durable outbox

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Create: `src-tauri/src/collab/store.rs`
- Delete after migration: `src-tauri/src/collab/outbox.rs`
- Modify: `src-tauri/src/collab/mod.rs`
- Modify: `docs/distribution.md`

- [ ] **Step 1: Write a failing crash-boundary transaction test**

```rust
#[test]
fn local_commit_persists_update_sequence_and_exact_envelope_atomically() {
    let store = test_store();
    let envelope = sealed_fixture(7, b"ciphertext");
    store.commit_local(b"loro-update", &envelope).expect("commit");

    let reopened = store.reopen().expect("reopen");
    let pending = reopened.pending_outbox().expect("pending");
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].sequence, 7);
    assert_eq!(pending[0].ciphertext, b"ciphertext");
    assert_eq!(reopened.local_updates().expect("updates"), vec![b"loro-update".to_vec()]);
}
```

- [ ] **Step 2: Verify RED**

Run: `cargo test --locked commit_persists_update --lib` from `src-tauri/`.

Expected: FAIL because `ProjectStore` is absent.

- [ ] **Step 3: Add bundled SQLite and implement schema migration**

Add `rusqlite = { version = "0.37", features = ["bundled"] }`.

Create tables `meta`, `checkpoint`, `updates`, `outbox`, `remote_heads`, `key_epochs`, `roster_cache`,
`blobs`, and `transfers`. Set `journal_mode=WAL`, `foreign_keys=ON`, and `synchronous=FULL`. Open one
connection only inside the service actor or `spawn_blocking` worker.

```rust
pub fn commit_local(&mut self, update: &[u8], envelope: &SealedHead) -> Result<(), CollabError> {
    let tx = self.connection.transaction()?;
    insert_update(&tx, update)?;
    set_sequence(&tx, envelope.header.sequence)?;
    insert_outbox(&tx, envelope)?;
    tx.commit()?;
    Ok(())
}
```

- [ ] **Step 4: Add rollback, unpublished-retention, and migration tests**

Inject a failure after each statement and assert reopening sees either all three values or none.
Insert more than eight unpublished rows and assert none are deleted. Open schema version zero and
assert migration reaches version one without losing rows.

- [ ] **Step 5: Verify GREEN**

Run: `cargo test --locked collab::store --lib` from `src-tauri/`.

Expected: all transaction, reopen, rollback, and retention tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/collab/store.rs src-tauri/src/collab/outbox.rs src-tauri/src/collab/mod.rs docs/distribution.md
git commit -m "feat(collab): persist projects and outbox atomically"
```

## Task 5: Versioned operations and atomic Loro document

**Files:**
- Create: `src-tauri/src/collab/ops.rs`
- Replace: `src-tauri/src/collab/doc.rs`
- Modify: `src-tauri/src/collab/mod.rs`

- [ ] **Step 1: Write failing atomicity and Unicode tests**

```rust
#[test]
fn invalid_second_operation_rolls_back_first_operation() {
    let mut doc = CollabDocument::new("project").expect("doc");
    let batch = OperationBatch::v1(vec![
        CollabOp::AddItem(item_fixture("one")),
        CollabOp::TextDelete { item_id: "missing".into(), index: 0, len: 1 },
    ]);
    assert!(doc.apply(batch).is_err());
    assert!(doc.project().items.is_empty());
}

#[test]
fn text_indices_are_unicode_scalar_indices() {
    let mut doc = document_with_text("a👩🏽‍🎨z");
    doc.apply(OperationBatch::v1(vec![CollabOp::TextInsert {
        item_id: "note".into(), index: 1, text: "é".into(),
    }])).expect("insert");
    assert_eq!(doc.project().items[0].text.as_deref(), Some("aé👩🏽‍🎨z"));
}
```

- [ ] **Step 2: Verify RED**

Run: `cargo test --locked collab::doc --lib` from `src-tauri/`.

Expected: the prototype applies part of an invalid batch or lacks strict typed validation.

- [ ] **Step 3: Define strict operation types**

```rust
#[derive(Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CollabOp {
    AddItem(AddItem),
    DeleteItem { item_id: ItemId },
    SetGeometry { item_id: ItemId, geometry: Geometry },
    SetCrop { item_id: ItemId, crop: Option<Crop> },
    SetTrim { item_id: ItemId, trim: Option<Trim> },
    SetAppearance { item_id: ItemId, appearance: Appearance },
    SetTextStyle { item_id: ItemId, style: TextStyle },
    TextInsert { item_id: ItemId, index: u32, text: String },
    TextDelete { item_id: ItemId, index: u32, len: u32 },
    SetFrameStyle { item_id: ItemId, frame: FrameStyle },
    SetPlayback { item_id: ItemId, playback: Playback },
    SetMediaManifest { item_id: ItemId, manifest: Option<MediaManifest> },
    SetLink { item_id: ItemId, link: Option<LinkMetadata> },
    SetEmbed { item_id: ItemId, embed: Option<EmbedMetadata> },
    SetSequence { item_id: ItemId, sequence: Option<SequenceMetadata> },
    SetPalette { palette: BoardPalette },
    MoveItem { item_id: ItemId, before: Option<ItemId> },
    AddStroke(Stroke),
    DeleteStroke { stroke_id: StrokeId },
    UpsertShape(VectorShape),
    DeleteShape { shape_id: ShapeId },
}
```

Every nested type validates finite numbers, dimensions, crop/trim ranges, URL schemes, MIME length,
manifest hash and size, string length, array count, and supported item kind.

- [ ] **Step 4: Apply through a shadow state and one Loro commit**

Prevalidate sequential effects, retain a pre-batch snapshot, apply only after validation, commit once,
persist the resulting update, and restore from the snapshot on an unexpected persistence error.
Use the order list as the only z-order source. Use `LoroText` indices in Unicode scalar values.

- [ ] **Step 5: Add convergence coverage**

Create two documents with distinct peer ids, apply concurrent operations for every enum variant,
exchange updates in both orders, and assert identical projections and version vectors.

- [ ] **Step 6: Verify GREEN**

Run: `cargo test --locked collab::doc collab::ops --lib` from `src-tauri/`.

Expected: atomicity, validation, Unicode, all-operation, duplicate-import, and convergence tests pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/collab/ops.rs src-tauri/src/collab/doc.rs src-tauri/src/collab/mod.rs
git commit -m "feat(collab): make Loro operations typed and atomic"
```

## Task 6: Total board projection and operation diffing

**Files:**
- Create: `src/lib/collab/projection.ts`
- Create: `src/lib/collab/operations.ts`
- Create: `test/collab/projection.test.ts`
- Create: `test/collab/operations.test.ts`
- Remove after replacement: `src/lib/collabProjection.ts`

- [ ] **Step 1: Write failing empty, z-order, drawing, and Unicode diff tests**

```ts
it("projects an empty native document to an empty board", () => {
  expect(projectBoard({ revision: 1, items: [], order: [], strokes: [], shapes: [] })).toEqual([]);
});

it("takes z only from order", () => {
  const items = projectBoard(nativeProjectWithOrder(["b", "a"]));
  expect(items.map((item) => [item.id, item.z])).toEqual([["b", 0], ["a", 1]]);
});

it("diffs text by Unicode scalar value", () => {
  expect(diffText("note", "a👩🏽‍🎨z", "aé👩🏽‍🎨z")).toEqual([
    { type: "textInsert", itemId: "note", index: 1, text: "é" },
  ]);
});
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run test/collab/projection.test.ts test/collab/operations.test.ts`

Expected: FAIL on empty deletion, z overwrite, drawings, or code-unit indexing.

- [ ] **Step 3: Implement total projection**

Map every durable `BoardItem` field to the native contract. Recompute `src`, availability, and object
URLs locally. Rebuild `shapes` from stable native shapes/strokes. Ignore any geometry `z` field and
assign order indices after all item groups merge.

- [ ] **Step 4: Implement operation diffing**

Use `Array.from(text)` for scalar arrays, common prefix/suffix edits, stable field-group comparisons,
and explicit add/delete/move/drawing operations. Never serialize `src`, `loading`, selection,
playback position, or object URLs.

- [ ] **Step 5: Verify GREEN and field coverage**

Run: `npm run test:collab`

Expected: projection round-trips every durable fixture field and all focused tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/collab/projection.ts src/lib/collab/operations.ts test/collab/projection.test.ts test/collab/operations.test.ts src/lib/collabProjection.ts
git commit -m "feat(collab): cover the complete board projection"
```

## Task 7: Native CollabService actor and narrow Tauri IPC

**Files:**
- Create: `src-tauri/src/collab/service.rs`
- Create: `src-tauri/src/collab/commands.rs`
- Modify: `src-tauri/src/collab/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`
- Create: `src-tauri/permissions/collaboration.toml`
- Modify: `src-tauri/tauri.conf.json`
- Create: `src/lib/collab/client.ts`
- Modify: `src/lib/collab/types.ts`

- [ ] **Step 1: Write failing role and project-routing service tests**

```rust
#[tokio::test]
async fn viewer_cannot_apply_operations() {
    let service = TestService::open(Role::Viewer).await;
    let error = service.apply(batch_fixture()).await.expect_err("read only");
    assert_eq!(error.code, CollabErrorCode::ReadOnly);
}

#[tokio::test]
async fn closing_a_project_rejects_late_operations() {
    let service = TestService::open(Role::Editor).await;
    let project = service.active_project().await;
    service.close(project.clone()).await.expect("close");
    assert!(service.apply_to(project, batch_fixture()).await.is_err());
}
```

- [ ] **Step 2: Verify RED**

Run: `cargo test --locked collab::service --lib` from `src-tauri/`.

Expected: FAIL because the prototype exposes independent commands without an actor.

- [ ] **Step 3: Implement the actor API**

```rust
pub enum ServiceCommand {
    ConfigureAuth(AuthSession),
    Create(CreateProjectRequest),
    Open(ProjectId),
    Close(ProjectId),
    Apply { project_id: ProjectId, batch: OperationBatch },
    Projection(ProjectId),
    ImportGrant(ProjectId),
    RequestBlob { project_id: ProjectId, hash: BlobHash },
    Shutdown,
}
```

Use a bounded Tokio `mpsc` command queue and `oneshot` replies. Perform SQLite and large Loro work in
bounded blocking jobs. Emit revision/status events only after durable commit.

- [ ] **Step 4: Replace low-level commands with high-level commands**

Register only configure-auth, create/open/close, apply, projection, lifecycle, membership intent,
media intent, and status subscription commands. Remove commands that accept exchange public keys,
peer allowlists, arbitrary endpoints, arbitrary file sources, raw keys, or raw project paths.

- [ ] **Step 5: Scope capabilities and CSP**

Define collaboration permissions for `main` and `reference` only. No remote URL receives them. Add a
CSP that allows the app, local core connection, configured Convex origins, required image/media data
schemes, and HTTPS frame/embed origins while forbidding remote scripts and objects.

- [ ] **Step 6: Verify GREEN**

Run: `cargo test --locked collab::service --lib` from `src-tauri/`.

Expected: role, routing, queue-bound, close, and no-key-export tests pass.

Run: `cargo check --locked` from `src-tauri/`.

Expected: PASS with every command registered.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/collab/service.rs src-tauri/src/collab/commands.rs src-tauri/src/collab/mod.rs src-tauri/src/lib.rs src-tauri/capabilities/default.json src-tauri/permissions/collaboration.toml src-tauri/tauri.conf.json src/lib/collab/client.ts src/lib/collab/types.ts
git commit -m "refactor(collab): make Rust the collaboration authority"
```

## Task 8: Convex account identity, projects, invitations, roles, and devices

**Files:**
- Modify: `convex/schema.ts`
- Create: `convex/collab/access.ts`
- Create: `convex/collab/profiles.ts`
- Create: `convex/collab/projects.ts`
- Create: `convex/collab/devices.ts`
- Create: `test/collab/convex-access.test.ts`
- Remove after replacement: `convex/projects.ts`
- Remove after replacement: `convex/devices.ts`
- Remove after replacement: `convex/social.ts`

- [ ] **Step 1: Write failing Convex authorization tests**

```ts
it("does not let an editor invite a member", async () => {
  await expect(asEditor.mutation(api.collab.projects.invite, {
    projectId,
    inviteCode: targetCode,
    role: "editor",
  })).rejects.toThrow(/owner/i);
});

it("derives profile identity instead of trusting renderer copy", async () => {
  const profile = await asUser.mutation(api.collab.profiles.ensure, {});
  expect(profile.accountId).toBe(authenticatedUserId);
  expect(profile.inviteCode).toMatch(/^[A-Z0-9]{10}$/);
});
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run test/collab/convex-access.test.ts`

Expected: current writer invitation and renderer-supplied profile behavior fails the contract.

- [ ] **Step 3: Implement indexed bounded schema**

Create tables for profiles, projects, members, invitations, devices, device challenges, key envelopes,
checkpoints, heads, activities, media requests, and audit events. Use compound indexes matching every
lookup. Store project content bytes only on checkpoint/head rows or `_storage`.

- [ ] **Step 4: Implement shared guards**

```ts
export async function requireAccount(ctx: QueryCtx | MutationCtx) {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) throw new ConvexError("AUTH_REQUIRED");
  return user;
}

export async function requireRole(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"collabProjects">,
  allowed: readonly ProjectRole[],
) {
  const user = await requireAccount(ctx);
  const member = await memberByProjectAndAccount(ctx, projectId, user._id);
  if (!member || !allowed.includes(member.role)) throw new ConvexError("FORBIDDEN");
  return { user, member };
}
```

Enforce owner-only invitation/removal/role/delete, max ten members, max twenty pending invites, max
five active devices, stable invite codes, and no owner leave.

- [ ] **Step 5: Verify registration proof atomically**

Issue a five-minute single-use challenge. Verify Ed25519 proof over the canonical registration
statement with a permissively licensed audited dependency, then consume challenge and insert device
inside one mutation. Include the current user's other active devices in project rosters.

- [ ] **Step 6: Verify GREEN**

Run: `npm run test:collab`

Expected: unauthenticated, non-member, viewer, editor, owner, cap, replay, proof-substitution, and
same-account multi-device cases pass.

- [ ] **Step 7: Commit**

```bash
git add convex/schema.ts convex/collab/access.ts convex/collab/profiles.ts convex/collab/projects.ts convex/collab/devices.ts test/collab/convex-access.test.ts convex/projects.ts convex/devices.ts convex/social.ts
git commit -m "feat(collab): enforce Convex membership and device proofs"
```

## Task 9: Pinned authenticated native Convex client

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Create: `src-tauri/src/collab/convex.rs`
- Modify: `src-tauri/src/collab/service.rs`
- Modify: `src-tauri/build.rs`
- Modify: `src/lib/collab/client.ts`
- Create: `test/collab/auth-handoff.test.ts`

- [ ] **Step 1: Write failing URL-pinning and token-redaction tests**

```rust
#[test]
fn rejects_a_runtime_convex_host_change() {
    let config = ConvexConfig::compiled("https://good.convex.cloud").expect("config");
    assert!(config.validate_runtime_hint("https://evil.convex.cloud").is_err());
}

#[test]
fn auth_session_debug_never_prints_token() {
    let session = AuthSession::new("secret.jwt.value".into());
    assert!(!format!("{session:?}").contains("secret"));
}
```

- [ ] **Step 2: Verify RED**

Run: `cargo test --locked collab::convex --lib` from `src-tauri/`.

Expected: FAIL because no native client exists.

- [ ] **Step 3: Add the HTTP client**

Add `reqwest` with rustls and JSON features plus Tokio time/macros. `build.rs` reads the public
deployment URL used for packaging and exposes a compile-time value. Development may use a loopback
Convex URL only in debug builds.

```rust
pub async fn call<T: DeserializeOwned>(
    &self,
    kind: FunctionKind,
    path: &str,
    args: serde_json::Value,
) -> Result<T, CollabError>;
```

Send `{ path, args, format: "json" }`, `Authorization: Bearer`, strict content-length limits, a
ten-second timeout, and typed Convex error parsing. Never log headers, body ciphertext, or JWT.

- [ ] **Step 4: Implement renderer token refresh**

Call `authClient.convex.token({ fetchOptions: { throw: false } })`, pass the token to the native
configure command, refresh before expiry or after one unauthorized response, and clear native auth
on sign-out. Do not persist it in collaboration storage.

- [ ] **Step 5: Verify GREEN**

Run: `cargo test --locked collab::convex --lib` from `src-tauri/`.

Expected: pinning, timeout, response-size, auth, redaction, and error-map tests pass against a local
mock server.

Run: `npx vitest run test/collab/auth-handoff.test.ts`

Expected: refresh and clear-auth tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/collab/convex.rs src-tauri/src/collab/service.rs src-tauri/build.rs src/lib/collab/client.ts test/collab/auth-handoff.test.ts
git commit -m "feat(collab): authenticate native Convex access"
```

## Task 10: Project keys, envelopes, and two-phase rotation

**Files:**
- Replace: `src-tauri/src/collab/crypto.rs`
- Modify: `src-tauri/src/collab/store.rs`
- Create: `convex/collab/keys.ts`
- Create: `test/collab/convex-keys.test.ts`

- [ ] **Step 1: Write failing recipient and epoch tests**

```rust
#[test]
fn envelope_cannot_be_opened_by_another_device_or_project() {
    let envelope = owner.wrap_key(&project_a, 2, &target_a).expect("wrap");
    assert!(target_b.open_key(&project_a, &envelope).is_err());
    assert!(target_a.open_key(&project_b, &envelope).is_err());
}

#[test]
fn old_epoch_cannot_publish_after_rotation_begins() {
    let state = RotationState::pending(3);
    assert!(state.allows_publication(2).is_err());
}
```

- [ ] **Step 2: Verify RED**

Run: `cargo test --locked collab::crypto --lib` from `src-tauri/`.

Expected: prototype key-wrap API accepts renderer-selected public keys or lacks pending rotation.

- [ ] **Step 3: Implement native resolved-target envelopes**

Expose `wrap_for_device(project, epoch, VerifiedDevice)` only inside native code. Bind project, epoch,
sender, target, target exchange-key digest, and timestamp in HPKE info/AAD. DPAPI-wrap every durable
content key. Zeroize plaintext keys after use.

- [ ] **Step 4: Implement owner-only Convex rotation state**

`beginRemoval` removes membership and marks `rotationPending` atomically. `putEnvelope` accepts only
the owner, current member target, active verified device, and pending next epoch. `commitRotation`
checks every active target has an envelope before advancing epoch and clearing pending state.

- [ ] **Step 5: Verify GREEN**

Run: `cargo test --locked collab::crypto --lib`

Run: `npx vitest run test/collab/convex-keys.test.ts`

Expected: recipient, replay, downgrade, substitution, removal, missing-envelope, and commit tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/collab/crypto.rs src-tauri/src/collab/store.rs convex/collab/keys.ts test/collab/convex-keys.test.ts
git commit -m "feat(collab): rotate project keys after revocation"
```

## Task 11: Encrypted heads, file fallback, resume, and safe compaction

**Files:**
- Create: `convex/collab/recovery.ts`
- Remove after replacement: `convex/heads.ts`
- Create: `src-tauri/src/collab/recovery.rs`
- Modify: `src-tauri/src/collab/store.rs`
- Modify: `src-tauri/src/collab/service.rs`
- Create: `test/collab/convex-recovery.test.ts`

- [ ] **Step 1: Write failing CAS and notification consolidation tests**

```ts
it("preserves a concurrent head during checkpoint CAS", async () => {
  const selected = await readGeneration();
  await publishHead({ deviceId: deviceB, sequence: 8 });
  await compact({ generation: selected.generation, selectedHeads: [headA] });
  expect(await getHead(deviceB)).toMatchObject({ sequence: 8, absorbed: false });
});

it("does not rewrite an already unread activity", async () => {
  await publishHead({ sequence: 1 });
  const first = await activityFor(target);
  await publishHead({ sequence: 2 });
  expect(await activityFor(target)).toEqual(first);
});
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run test/collab/convex-recovery.test.ts`

Expected: current publication is unwired, lacks file fallback, or rewrites inbox rows.

- [ ] **Step 3: Implement bounded Convex recovery functions**

Add one-shot checkpoint/head reads, `generateUploadUrl`, finalize inline/file-backed head, per-device
CAS replacement, activity transition, acknowledgement after merged generation, checkpoint CAS, and
audited stale-head discard. Enforce 512 KiB inline and explicit encrypted-size limits.

- [ ] **Step 4: Implement native publication and exact retries**

Seal once, store exact bytes, publish after three-second idle and thirty-second maximum, reuse the
same outbox sequence on retry, and mark published only after Convex returns the committed head.

- [ ] **Step 5: Implement temporary-document compaction**

Create a new Loro document, import selected checkpoint plus selected heads, export its full snapshot,
seal it, CAS against generation and selected head sequences, then mark only those heads absorbed.
Never export the live actor document as the compacted checkpoint.

- [ ] **Step 6: Verify GREEN**

Run: `cargo test --locked collab::recovery --lib` from `src-tauri/`.

Run: `npx vitest run test/collab/convex-recovery.test.ts`

Expected: crash resume, exact retry, inline/file fallback, CAS race, concurrent head, unread no-op,
stale retention, and explicit discard tests pass.

- [ ] **Step 7: Commit**

```bash
git add convex/collab/recovery.ts convex/heads.ts src-tauri/src/collab/recovery.rs src-tauri/src/collab/store.rs src-tauri/src/collab/service.rs test/collab/convex-recovery.test.ts
git commit -m "feat(collab): recover encrypted offline branches"
```

## Task 12: Authenticated bounded iroh document sync

**Files:**
- Create: `src-tauri/src/collab/protocol.rs`
- Replace: `src-tauri/src/collab/net.rs`
- Modify: `src-tauri/src/collab/service.rs`

- [ ] **Step 1: Write failing handshake and frame-limit tests**

```rust
#[tokio::test]
async fn handshake_rejects_an_unregistered_endpoint() {
    let result = accept_handshake(roster_fixture(), handshake_from("unknown")).await;
    assert!(matches!(result, Err(CollabError { code: CollabErrorCode::Authorization, .. })));
}

#[test]
fn decoder_rejects_oversized_length_before_allocating() {
    let header = frame_header(MAX_DOCUMENT_FRAME + 1);
    assert!(FrameDecoder::new().push(&header).is_err());
}
```

- [ ] **Step 2: Verify RED**

Run: `cargo test --locked collab::protocol collab::net --lib` from `src-tauri/`.

Expected: prototype renderer allowlist or 64 MiB allocation policy violates the tests.

- [ ] **Step 3: Define versioned signed frames**

```rust
pub enum WireFrame {
    Hello(SignedHandshake),
    VersionVector(VersionVectorFrame),
    DocumentUpdate(EncryptedUpdateFrame),
    UpdateRequest(UpdateRequestFrame),
    Presence(PresenceFrame),
    Ack(AckFrame),
    Error(ProtocolErrorFrame),
}
```

Bind project digest, device id, endpoint id, protocol version, epoch, nonce, timestamp, and transcript
hash. Verify the native roster and proof before document exchange.

- [ ] **Step 4: Implement bounded sync**

Exchange version vectors, request missing ranges, import idempotently, acknowledge, and resync a slow
peer instead of buffering without limit. Add handshake, read, write, idle, and authorization-refresh
timeouts. Refresh roster every five minutes and pause sessions after fifteen minutes without fresh
authorization.

- [ ] **Step 5: Verify GREEN**

Run: `cargo test --locked collab::protocol collab::net --lib` from `src-tauri/`.

Expected: registered two-peer convergence, unknown/revoked peer, signature, replay, stale epoch,
duplicate, reorder, frame bound, slow-peer, timeout, and stale-roster tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/collab/protocol.rs src-tauri/src/collab/net.rs src-tauri/src/collab/service.rs
git commit -m "feat(collab): authenticate and bound iroh sync"
```

## Task 13: Secure blob import, resumable transfer, requests, and GC

**Files:**
- Replace: `src-tauri/src/collab/blobs.rs`
- Modify: `src-tauri/src/collab/protocol.rs`
- Modify: `src-tauri/src/collab/net.rs`
- Modify: `src-tauri/src/collab/store.rs`
- Create: `convex/collab/media.ts`
- Create: `test/collab/convex-media.test.ts`

- [ ] **Step 1: Write failing arbitrary-path, resume, and GC tests**

```rust
#[test]
fn guessed_import_token_cannot_read_a_file() {
    let store = test_blob_store();
    assert!(store.consume_import_grant("0000", Path::new("C:/secret.txt")).is_err());
}

#[test]
fn transfer_resumes_only_missing_verified_chunks() {
    let mut transfer = partial_transfer_fixture(&[0, 2]);
    assert_eq!(transfer.missing_chunks(), vec![1, 3]);
    transfer.finish_with_wrong_hash().expect_err("hash mismatch");
    assert!(!transfer.is_provider());
}

#[test]
fn referenced_and_outbox_blobs_survive_gc() {
    let store = gc_fixture();
    store.run_gc(day(31)).expect("gc");
    assert!(store.exists(REFERENCED));
    assert!(store.exists(OUTBOX));
    assert!(!store.exists(EXPIRED_ORPHAN));
}
```

- [ ] **Step 2: Verify RED**

Run: `cargo test --locked collab::blobs --lib` from `src-tauri/`.

Expected: current command accepts arbitrary paths or lacks resumable ranges and durable GC pins.

- [ ] **Step 3: Implement native import grants and blob store**

Create grants only from a native file dialog or trusted drag event. Store a random 256-bit token,
canonical path, allowed project, expiry, and consumed flag. Stream into a confined temporary file,
enforce type/size limits, calculate BLAKE3, fsync, and atomically move to a hash path.

- [ ] **Step 4: Implement resumable authorized chunks**

Use authenticated manifests, bounded chunk size/count, per-chunk BLAKE3, persisted received bitmap,
final full hash, cancellation, and transfer timeout. Serve only hashes referenced by a project for a
currently authorized peer. A partial file is never registered as a provider.

- [ ] **Step 5: Implement coalesced media requests and GC**

Convex stores one bounded hash set per project/requester and does not patch again inside the retry
window. Native GC pins current references, outbox, transfers, and local keep-offline rows; it starts a
thirty-day grace only after the last pin disappears.

- [ ] **Step 6: Verify GREEN**

Run: `cargo test --locked collab::blobs --lib` from `src-tauri/`.

Run: `npx vitest run test/collab/convex-media.test.ts`

Expected: import confinement, expiry, one-use token, oversize, wrong hash, resume, authorization,
request coalescing, pins, grace, collection, and placeholder-state tests pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/collab/blobs.rs src-tauri/src/collab/protocol.rs src-tauri/src/collab/net.rs src-tauri/src/collab/store.rs convex/collab/media.ts test/collab/convex-media.test.ts
git commit -m "feat(collab): transfer media securely over iroh"
```

## Task 14: Scene-bound sessions and one board authority

**Files:**
- Create: `src/lib/collab/session.ts`
- Modify: `src/components/reference/ReferencePanel.tsx`
- Modify: `src/components/reference/ReferenceWindow.tsx`
- Modify: `src/components/reference/useScenePersistence.ts`
- Modify: `src/components/reference/useAutosave.ts`
- Modify: `src/components/reference/useProjectActions.ts`
- Remove after replacement: `src/lib/collabSession.ts`
- Remove after replacement: `src/components/reference/CollabHost.tsx`
- Remove after replacement: `src/components/reference/useCollabBridge.ts`
- Remove after replacement: `src/components/reference/useCollabProject.ts`
- Create: `test/collab/session.test.ts`

- [ ] **Step 1: Write failing project-switch and empty-board tests**

```ts
it("closes project A before operations can target project B", async () => {
  const native = fakeNativeClient();
  const session = createCollabSession(native);
  await session.open(scene("A", "project-a"));
  await session.open(scene("B", "project-b"));
  expect(native.calls).toEqual([
    ["open", "project-a"],
    ["close", "project-a"],
    ["open", "project-b"],
  ]);
});

it("applies an empty authoritative projection", () => {
  expect(mergeAuthoritativeBoard(localItems(), [])).toEqual([]);
});
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run test/collab/session.test.ts`

Expected: global localStorage session or the empty-projection guard fails.

- [ ] **Step 3: Persist project binding in scene metadata**

Add optional `collaboration: { projectId, schemaVersion }` to durable scene/project metadata. Remove
the global active-project key. On scene change, await close before open. Keep local board unchanged if
creation fails before the initial checkpoint commit.

- [ ] **Step 4: Make native projection authoritative**

Disable solo autosave as a truth source while collaboration is active. Submit operations to native,
then update the board only from committed native revisions. Mount the same session client in the
detached reference window. Provide explicit local export rather than background competing saves.

- [ ] **Step 5: Verify GREEN**

Run: `npm run test:collab`

Expected: switch ordering, late-event rejection, empty deletion, creation rollback, solo autosave,
detached window, and explicit export tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/collab/session.ts src/components/reference/ReferencePanel.tsx src/components/reference/ReferenceWindow.tsx src/components/reference/useScenePersistence.ts src/components/reference/useAutosave.ts src/components/reference/useProjectActions.ts src/lib/collabSession.ts src/components/reference/CollabHost.tsx src/components/reference/useCollabBridge.ts src/components/reference/useCollabProject.ts test/collab/session.test.ts
git commit -m "feat(collab): bind collaboration to board scenes"
```

## Task 15: Complete collaboration UI and localized states

**Files:**
- Replace: `src/components/reference/CollaborationDialog.tsx`
- Modify: `src/components/reference/Toolbar.tsx`
- Modify: `src/components/settings/CollabSection.tsx`
- Modify: `src/components/settings/AccountPanel.tsx`
- Create: `src/components/reference/CollaborationStatus.tsx`
- Modify: `src/locales/{fr,en,de,es,ja,zh}/reference.json`
- Modify: `src/locales/{fr,en,de,es,ja,zh}/settings.json`
- Create: `test/collab/ui-state.test.ts`

- [ ] **Step 1: Write failing state-machine tests**

```ts
it.each([
  ["keyPending", "waitingForOwner"],
  ["rotationPending", "rotationPending"],
  ["mediaNoHolder", "noHolderOnline"],
  ["mediaArchived", "archivedMediaUnavailable"],
  ["offlineQueued", "offlineChangesQueued"],
  ["viewer", "readOnly"],
])("maps %s to distinct copy key", (state, key) => {
  expect(statusCopyKey(state as CollaborationState)).toBe(key);
});
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run test/collab/ui-state.test.ts`

Expected: current UI lacks lifecycle and distinct media states.

- [ ] **Step 3: Implement project and membership controls**

Support authenticated creation, invite code, pending invites, accept/reject, owner member list, role
change, removal, device list/revoke, leave, delete, key waiting, and rotation progress. Require login
only for collaboration; keep solo skip behavior unchanged. Disable shared mutation controls for
viewers and keep native enforcement.

- [ ] **Step 4: Implement compact board status**

Show connecting, peer count, offline queued, recovery failure, key pending, rotation pending, media
requested, no holder online, archived unavailable, and read-only without covering board content. Use
the project Tooltip component and no native `title=`.

- [ ] **Step 5: Add all six locales and verify GREEN**

Run: `npm run check:i18n`

Expected: PASS.

Run: `npm run test:collab`

Expected: status distinction, owner/editor/viewer controls, login requirement, and action tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/reference/CollaborationDialog.tsx src/components/reference/Toolbar.tsx src/components/settings/CollabSection.tsx src/components/settings/AccountPanel.tsx src/components/reference/CollaborationStatus.tsx src/locales/*/reference.json src/locales/*/settings.json test/collab/ui-state.test.ts
git commit -m "feat(collab): complete collaboration lifecycle UI"
```

## Task 16: Reconcile documentation and remove prototype dead paths

**Files:**
- Modify: `docs/collab.md`
- Modify: `docs/architecture.md`
- Modify: `docs/invariants.md`
- Modify: `docs/convex-setup.md`
- Modify: `docs/distribution.md`
- Modify: `AGENTS.md`
- Modify: `src-tauri/src/collab/mod.rs`
- Remove replaced files listed by Tasks 4, 6, 8, 11, and 14

- [ ] **Step 1: Write a failing static contract test**

```js
// test/collaboration-contract.test.cjs
test('collaboration docs and command surface contain no prototype claims', () => {
  const source = read('src-tauri/src/collab/mod.rs');
  assert.doesNotMatch(source, /implemented so far/i);
  assert.doesNotMatch(allCollabSources(), /collab_key_wrap|collab_net_allow/);
  assert.match(read('AGENTS.md'), /docs\/collab\.md/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test test/collaboration-contract.test.cjs`

Expected: prototype status or dangerous command names remain.

- [ ] **Step 3: Reconcile docs with implemented evidence**

Make `docs/collab.md` the operational contract matching the approved design and actual status. Add the
external reference row to `AGENTS.md`. Document SQLite bundling, native Convex URL provisioning,
upload storage, CSP origins, restart requirements, key/device limits, and precise media states.

- [ ] **Step 4: Remove dead prototype paths**

Use `rg` to prove every replaced helper, command, table, and low-level IPC name has no callsite before
deleting it. Preserve unrelated work and `docs/perso.lnk` untouched.

- [ ] **Step 5: Verify GREEN**

Run: `node --test test/collaboration-contract.test.cjs`

Expected: PASS.

Run: `rg -n "collab_key_wrap|collab_net_allow|nb\.collab\.project|implemented so far" src src-tauri convex docs AGENTS.md`

Expected: no obsolete implementation hit.

- [ ] **Step 6: Commit**

```bash
git add docs/collab.md docs/architecture.md docs/invariants.md docs/convex-setup.md docs/distribution.md AGENTS.md src-tauri/src/collab/mod.rs test/collaboration-contract.test.cjs src src-tauri convex
git commit -m "docs(collab): align contracts with the native service"
```

Before committing, inspect `git diff --cached --name-only` and unstage any unrelated path, especially
`docs/perso.lnk`.

## Task 17: Full acceptance audit and authorized validation

**Files:**
- Modify only when a failing acceptance check identifies a collaboration defect.

- [ ] **Step 1: Run focused collaboration tests**

Run: `npm run test:collab`

Expected: all Vitest collaboration tests pass with zero failures.

Run: `node --test test/collaboration-contract.test.cjs`

Expected: PASS.

Run: `cargo test --locked collab:: --lib` from `src-tauri/`.

Expected: all native collaboration tests pass.

- [ ] **Step 2: Run repository checks separately**

Run: `npm run check:i18n`

Run: `npm run check:core`

Run: `npm run build`

Run: `cargo fmt --check` from `src-tauri/`.

Run: `cargo clippy --locked --all-targets --all-features -- -D warnings` from `src-tauri/`.

Run: `cargo test --locked` from `src-tauri/`.

Run: `cargo check --locked` from `src-tauri/`.

Expected: every command exits zero. Existing quarantined Node suites are not used to excuse a new
collaboration failure.

- [ ] **Step 3: Audit the spec requirement by requirement**

For each heading and every bullet under `Verification and acceptance` in the design spec, record the
test name, command output, source location, or explicit runtime-only status that proves it. Treat an
uncertain or indirectly covered item as incomplete and add a focused failing test before fixing it.

- [ ] **Step 4: Inspect the final worktree and dependency/license surface**

Run: `git diff --check`

Run: `git status --short`

Run: `npm ls --depth=0`

Run: `cargo tree -e normal` from `src-tauri/`.

Expected: no accidental generated artifacts, no unrelated staged file, no missing dependency, and no
new non-redistributable runtime component.

- [ ] **Step 5: Request the required native restart for runtime validation**

Do not launch, close, rebuild, or package the running application. State that Rust/core changes need
the user to restart the existing Tauri window. After the user restarts it, verify create/invite/join,
two-device concurrent editing, offline recovery, member removal/rotation, image transfer, requested
video transfer, detached-window edits, and all visible error states. Record anything that cannot be
observed as not verified at runtime rather than complete.

- [ ] **Step 6: Keep acceptance fixes attributable**

When an acceptance check fails, return to the owning task, add the focused regression test there,
commit the exact test and implementation paths with that task's commit message, and rerun this full
audit. Do not create a catch-all commit that obscures which requirement failed.

## Completion rule

The feature is complete only when every checkbox above is satisfied, every approved design acceptance
item has direct evidence, all authorized static checks pass, and the required runtime restart has
either produced runtime evidence or is explicitly waiting on the user. A passing build alone is not
completion.

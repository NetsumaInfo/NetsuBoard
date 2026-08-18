# Collaboration acceptance record

This file is the closeout record for the collaboration design. It distinguishes source/unit evidence
from behavior that can only be observed after deploying Convex and restarting two Windows Tauri
instances. A runtime-only item is not represented as verified.

## Automated and source evidence

| Requirement | Evidence | Status |
|---|---|---|
| Two through ten replicas converge across the complete persisted board contract | `collab::doc::path_tests::two_through_ten_replicas_converge_across_the_complete_board_contract` | Automated |
| Empty remote state clears the renderer | Rust `empty_document_has_a_total_empty_projection` and Vitest `projects an empty native document to an empty board` | Automated |
| Unicode scalar indices, emoji, and combining text | Rust `text_indices_are_unicode_scalar_indices` and Vitest `diffs text by Unicode scalar value` | Automated |
| An invalid multi-operation batch is atomic | Rust `invalid_second_operation_rolls_back_the_first_operation` | Automated |
| Acknowledged edits, sequence, and the exact sealed outbox survive a crash boundary | Rust `local_commit_persists_update_sequence_and_exact_envelope_atomically`, `publication_confirmation_removes_only_the_confirmed_pending_entry`, and `unpublished_envelopes_are_never_trimmed_by_queue_length` | Automated |
| Duplicate, replayed, corrupt, oversized, wrongly signed, or stale-epoch payloads fail safely | Rust replay, signature-binding, frame-bound, operation-validation, and key-epoch tests; `crypto::open`, `net::read_update_frame`, and Convex `requireCurrentHeader` enforce the integrated path | Automated + source audit |
| Offline document branches recover without their author being online | Project open imports the sealed checkpoint and every retained device head in `service.rs::recover_from_convex`; Loro convergence/replay tests cover merge semantics | Source audit; live recovery pending |
| Checkpoint compaction cannot lose a concurrently changed head | Vitest `never consumes a head whose checkpoint epoch or revision changed`; Convex `commitCheckpoint` performs the same epoch/revision CAS | Automated + source audit |
| A removed member or revoked device cannot publish or open a fresh authorized P2P writer session | Convex membership/device/current-epoch guards on every write; durable `revokedDevices` tombstone; Rust `inbound_writes_require_the_exact_current_writer_endpoint`; static tombstone contract | Automated + source audit; live revocation pending |
| Rotation completes only after every current device envelope and the new epoch commit | `heads:commitKeyRotation` checks owner, expected epoch, target set, and envelope completeness; `key_rotation_requires_a_checkpoint_under_the_new_epoch` forces CAS re-encryption and old envelopes are pruned only after that checkpoint commits | Automated + source audit; live rotation pending |
| Renderer cannot select a raw key recipient, peer endpoint, blob hash, or arbitrary collaboration path | Static collaboration command-surface test; native roster resolution; project/hash reference checks; picker/drop/saved-scene import grants | Automated + source audit |
| Project/path/junction/symlink/short-name/token attacks remain confined | Rust identifier, confinement, canonical-file, and random one-use grant tests; Windows alias behavior remains in the runtime checklist | Automated; Windows adversarial runtime pending |
| Chunked media resumes and rejects a mismatched final hash | Bounded resume offsets, per-chunk BLAKE3, exact declared length, final BLAKE3, and atomic promotion in `blobs.rs`/`net.rs` | Source audit; interrupted transfer pending |
| Current references, outbox references, transfers, and pins survive GC; orphans expire | Rust `collection_grace_starts_when_the_last_pin_disappears`; source audit of pin/partial/transfer exclusions | Automated + source audit |
| Repeated activity, key-provisioning, and media requests remain consolidated | Vitest media coalescing test; invitation acceptance, `heads::notify`, and `media:request` reuse the same bounded row | Automated + source audit |
| Scene/project switching and detached windows cannot write to the wrong document | Node `reference-collaboration-scene.test.cjs`; native project leases, complete peer-roster replacement, closed-document media denial, and exact project checks | Automated; detached-window runtime pending |
| Viewer mode is enforced before and behind IPC | Vitest `viewer-readonly.test.ts`, Rust `viewer_cannot_apply_operations`, P2P writer bit, and Convex role guards | Automated + source audit |
| Convex functions are authenticated, role checked, indexed, and bounded | `convex/schema.ts`, shared policy helpers, project/device/list caps, payload reservations, and successful Convex TypeScript compilation | Source audit |
| Friend lookup accepts an exact Discord id, Discord username, or NetsuBoard handle without trusting renderer claims | Vitest identifier classification/deduplication tests; authenticated Discord action plus internal profile sync; exact optional indexes | Automated + source audit; two-account lookup pending |
| Native device registration omits an absent optional label and renderer errors remain readable | Rust JSON contract test source, successful `cargo check`, and Vitest structured-error tests | Static + renderer automated; Rust test execution and restarted-runtime registration pending |
| Documentation contains no prototype command/key escape hatch | `test/collaboration-contract.test.cjs` | Automated |

## Static validation snapshot

Fresh closeout results recorded on 2026-08-18:

| Command or audit | Result |
|---|---|
| `npm run test:collab` | 5 files, 17 tests passed |
| `node --test test/collaboration-contract.test.cjs` | 3 tests passed |
| `node --test test/core-origin-security.test.cjs test/reference-collaboration-scene.test.cjs` | 2 tests passed |
| `npx tsc --noEmit -p convex/tsconfig.json` | Passed |
| `npm run check:i18n` | All 13 namespaces match across 6 locales |
| `npm run check:core` | Passed |
| `npm run build` | TypeScript and Vite production build passed |
| `cargo fmt --check` | Passed |
| `cargo clippy --locked --all-targets --all-features -- -D warnings` | Passed with no warning |
| `cargo test --locked` | 45 tests passed |
| `cargo check --locked` | Passed |
| Non-quarantined Node matrix from `.github/workflows/ci.yml` | 51 files, 368 tests passed |
| `npm audit --audit-level=high` | 0 vulnerabilities |
| `npm ls --depth=0` and `cargo tree -e normal` | Dependency graphs resolve successfully |
| HPKE feature audit | X25519/HKDF-SHA-256/ChaCha20-Poly1305 only; no `ml-kem` or `x-wing` dependency |
| Direct Rust dependency licence audit | New CRDT, P2P, storage, hashing, signature, and encryption crates report permissive MIT, Apache-2.0, BSD-3-Clause, or CC0-compatible licences |
| `git diff --check` | Passed; Git only reports existing CRLF normalization notices |

### Friend lookup and device registration repair

Targeted static evidence recorded later on 2026-08-18:

- `npm run test:collab`: 6 files and 21 tests passed, including exact Discord id/username/handle
  classification, ambiguity deduplication, and structured Tauri error extraction;
- `npm run check:i18n`, `npm run check:core`, `npm run build`, Convex TypeScript compilation,
  `cargo fmt --check`, and `cargo check --locked` passed;
- the configured development deployment accepted the optional Discord profile fields, their exact
  indexes, and the updated actions/mutations;
- Rust regression tests were added for camel-cased identity serialization and omitted optional
  device labels but were not executed while the existing Tauri `cargo run` owned the default target;
  repository rules permit only `cargo check` without stopping that runtime.

## Runtime smoke snapshot

Fresh development-runtime evidence recorded on 2026-08-18:

- the configured Convex development deployment accepted the complete collaboration schema and all
  new indexes, then reported its functions ready;
- the current Rust binary, Tauri window, embedded player, and Node core launched successfully;
- `GET /healthz` returned `200` for the native/no-origin client and the two intended loopback renderer
  origins, while a remote origin returned `403`;
- an unauthenticated `projects:createProject` call was rejected server-side with `not signed in`, and
  anonymous list queries disclosed no project, device, profile, friendship, or request row;
- the native service initialized the DPAPI-protected device identity under the NetsuBoard collaboration
  home without exposing its contents.

Windows was locked at the PIN screen during the UI pass. No authentication input was attempted, so
the interactive and visual scenarios below remain deliberately unverified.

## Required live acceptance

These checks require a deployed/pinned Convex backend, a deliberate restart of the existing Tauri
window, and two distinct Windows accounts/devices. They remain pending until that environment exists:

1. find the second account by Discord numeric id and current Discord username, then send/accept the
   friend request and confirm both profile rows were synchronized server-side;
2. confirm the existing DPAPI identity registers without a label and the UI never shows
   `[object Object]` after restarting the Tauri window;
3. create, invite, accept, and open the same scene as owner/editor/viewer;
4. edit text, geometry, ordering, drawing, deletion, links, images, and video concurrently;
5. edit each branch offline, close the author, then recover both through Convex;
6. interrupt and resume an image and explicitly requested video transfer;
7. distinguish `No holder online` from `Archived media unavailable`;
8. remove a member, forget a device, complete rotation, and prove the old device cannot reconnect or
   publish;
9. edit from the detached board window and switch scenes while updates are in flight;
10. confirm head/inbox/media/upload cardinalities and Free-plan usage in the Convex dashboard.

The repository rules prohibit the implementation task from launching, closing, rebuilding, or
packaging the already-running application. That operational boundary is why these items are listed as
pending rather than inferred from passing source tests.

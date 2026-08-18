# Collaboration

**Implementation status:** complete in source, statically verified, not yet validated in a live
two-machine session. Native changes require a Tauri window restart before the running application can
exercise them.

NetsuBoard supports local-first shared boards for **2 to 10 members**. Members can edit the complete
persisted board contract: item creation and deletion, geometry, ordering, text, drawing, crop and trim,
appearance, playback, palettes, sequences, links, embeds, and media manifests.

The design has three deliberately separate jobs:

| Job | Owner | Data |
|---|---|---|
| Authoritative document and local durability | Rust `CollabService` + Loro + SQLite | Plaintext while open, local snapshots, encrypted outbox |
| Live transport and original media | iroh over authenticated QUIC | Signed Loro updates and hash-addressed chunks |
| Identity, recovery, and invitations | Better Auth + Convex | Membership metadata, encrypted checkpoints/heads, wrapped keys, consolidated notices |

Convex is not the live document server and iroh is not the authorization database. Loro determines
document convergence; Convex determines current membership; iroh moves already-authorized bytes.

## Runtime architecture

`src-tauri/src/collab/service.rs` runs one actor for the process. It owns every open Loro document,
project role, key epoch, local SQLite store, outbox, peer roster, media-retention pins, and Convex
client. The actor serializes document mutations so two renderer windows cannot race the same project.

The React renderer is a projection consumer. It submits versioned typed operations and replaces its
board state with the total projection returned by Rust. It does not own a second Loro document, export
CRDT updates, select arbitrary peers or key recipients, or persist keys. The main and detached board
windows obtain independent leases on the same native project; the final lease closing releases it.

The renderer obtains a short-lived Convex JWT from Better Auth and passes it to Rust in memory. Rust
validates the deployment URL, keeps the token out of logs and disk, registers the device, and calls the
pinned deployment directly. The renderer refreshes authentication every five minutes while a shared
scene is open. Collaboration pauses when the session cannot refresh, but accepted local edits remain
durable in SQLite.

Each collaborative project is bound to one saved scene id. Solo scene autosave is no longer an
authority for its items: it saves the scene binding and view metadata while the Loro document owns the
shared items. `Save As` is blocked because duplicating a scene id without defining a new collaboration
project would create two local names for one remote truth. Explicit export remains available.

## Document and operation contract

The document format and the renderer-to-native operation protocol are independently versioned at
version 1. Unknown versions fail closed.

The document contains fixed maps/lists for metadata, items, item order, strokes, and stroke order.
Items and strokes use never-reused ids and tombstones. Projection filters tombstoned children even if
a concurrent move leaves an order entry behind, so deletion wins over stale movement.

Operations are typed Rust enums with `deny_unknown_fields`. The contract covers:

- item lifecycle, geometry, crop, trim, appearance, text style, frames, and playback;
- Unicode text insert/delete using scalar indices;
- media variants, links, remote embeds, YouTube ids, sequences, and palettes;
- ordering, finished drawing strokes, and stroke deletion.

A batch is validated completely before it is committed. Non-finite geometry, invalid ranges,
oversized arrays/strings, unsupported URL schemes, sender file paths, malformed hashes, unknown fields,
and unknown protocols are rejected. If any operation is invalid, no operation in the batch is applied.

Geometry, crop, trim, and other coupled values are atomic registers instead of unrelated scalar keys.
Text uses Loro text operations. A finished stroke is one immutable encoded value, not thousands of
point operations; erasing part of a stroke deletes it and creates replacement segments. Undo and redo
are local Loro history actions and cannot undo another member's action.

Drag previews, selection, pan/zoom, active tools, in-progress strokes, and playback position remain
local in V1. Geometry is published after the committed gesture, not on every pointer frame. Shared
cursors and presence are intentionally not claimed by this version.

## Local durability and offline recovery

Every acknowledged native edit is committed in one SQLite transaction with:

1. the Loro update;
2. a monotonically increasing device sequence;
3. the exact sealed and signed outbox envelope.

The network send happens only afterward. A crash therefore republishes the same sequence, ciphertext,
hash, and signature. Convex accepts an identical retry and rejects sequence reuse with different
content.

Publications are scheduled after three idle seconds and no later than thirty seconds after the first
unpublished edit. Transient failures retry at 30, 60, 120, 240, 480, then 900 seconds. Authorization
or read-only failures do not retry blindly. Every durable publish rechecks membership and role in
Convex.

Convex stores one encrypted checkpoint per project and at most one unabsorbed head per proved device.
Small ciphertexts are inline; larger ciphertexts use file storage. A file-backed payload must first be
registered to the authenticated project, account, and device. Cleanup accepts only such a reservation,
so an arbitrary Convex storage id cannot be deleted through a collaboration mutation.

Opening a project imports the checkpoint and every head, verifies their Ed25519 signatures and
XChaCha20-Poly1305 authentication, merges them, and republishes any local branch. Consequently, text,
layout, drawing, URLs, and media manifests recover even when their author is offline.

Compaction never snapshots the live document directly. It builds a temporary Loro document from the
selected checkpoint and selected server heads, then commits with compare-and-swap on the checkpoint
epoch and every consumed head revision. A head changed during compaction survives. Published,
unabsorbed heads are never deleted automatically. After thirty days, the owner sees the device, age,
and encrypted size and may discard one only through a second destructive confirmation. That decision
is written to the bounded project audit trail.

## Identity, authorization, and keys

The native service creates one persistent Ed25519 device identity. Its public key is also the iroh
EndpointId. A separate X25519 key receives project-key envelopes; Ed25519 material is never converted
into an exchange key. Private identity and project-key files are protected with Windows DPAPI for the
current account and are written with replace-existing, write-through atomic replacement.

Device registration is challenge based and single use. The device signs a versioned statement binding
the Convex account, challenge, device id, signing key, exchange key, and endpoint id. Convex verifies
the proof before the device may publish or receive an envelope. An account may register at most five
devices. Forgetting a device writes a durable server tombstone before deleting its active row, so the
same native identity cannot silently re-enrol itself with a still-live web session.

Roles are `owner`, `editor`, and `viewer`:

- owner: invite, change roles, remove members, rotate keys, delete the project, and edit;
- editor: edit and provision a newly registered authorized device for the current epoch;
- viewer: recover and render, but cannot publish or mutate shared state.

Viewer checks exist in controls, Zustand mutators, native commands, P2P admission, and Convex
mutations. Possessing a project key is not authorization.

Project content uses a random 32-byte key per epoch. Heads, checkpoints, and direct P2P updates use
domain-separated XChaCha20-Poly1305 subkeys and random nonces; their authenticated clear header
carries project, device, sequence, checkpoint base, key epoch, purpose, and ciphertext hash. Project
keys are wrapped per device with HPKE X25519/HKDF-SHA256/ChaCha20-Poly1305, with protocol, project,
epoch, and the resolved recipient exchange key bound into the HPKE context.

Removing a member, downgrading a writer, or forgetting a device marks rotation pending and removes the
affected envelopes. During rotation, new publications are rejected. The owner writes envelopes for
all current proved devices at `currentEpoch + 1`; Convex advances the epoch only after every envelope
exists. The owner's next recovery immediately rewrites the selected checkpoint and heads under the
new key using the normal CAS path; a failed attempt is retried on the next security refresh. Only a
successfully committed checkpoint prunes obsolete key envelopes. A removed device retains anything it
legitimately decrypted before removal, but cannot obtain the new epoch or publish a new head.

Device revocation is not account-session revocation. The tombstone blocks the forgotten native
identity used by NetsuBoard; an attacker who also controls the account session and deliberately creates
a brand-new native identity is an account-compromise case and must be handled by revoking the account
session/credentials.

## P2P synchronization

iroh runs one persistent endpoint with versioned ALPNs for document and blob protocols. QUIC proves
the remote EndpointId. Connections start closed and are admitted through:

1. the global device allowlist derived from current shared projects;
2. the per-project roster;
3. the writer bit for inbound document updates;
4. a versioned Ed25519 signature binding author, project, and exact payload.

As soon as a refreshed active-project roster contains another device, the endpoint starts listening;
it does not wait for the local user to make the next edit. Rebuilding authority replaces the complete
per-project roster map, so closing the final lease removes that project's network authorization even
when the same peer remains connected for another project.

Frames and version vectors have hard size limits, exchanges time out after thirty seconds, and media
requests are bound to a hash currently referenced by the open project. An inbound P2P write refreshes
the online Convex roster at most once per project every thirty seconds; durable publication always
checks again. If Convex is unreachable, the service may use its locally signed cached roster. This
preserves local-first availability but delays a revocation until connectivity returns.

Direct connections are preferred and iroh's encrypted relay fallback is accepted. Relay operators can
observe connection metadata and ciphertext sizes, not document or media plaintext.

## Media

The CRDT stores a manifest, never an absolute path or object URL. A local asset manifest contains a
lowercase BLAKE3 hash, safe display name, MIME type, and byte length. Remote links, embeds, and YouTube
items synchronize their URL/id metadata and are fetched independently.

Local bytes live in Rust's separate `collab/blobs` store. Import is authorized by a random 256-bit,
one-use, fifteen-minute grant created only by the native file picker or a trusted WebView2 OS drop.
The recovery path for an already saved scene accepts only a canonical regular file found in that scene
or the application-owned reference asset directory. Canonicalization occurs before confinement and
rejects links. Images are capped at 2 GiB and videos at 256 GiB.

Transfers are requested on demand over the project-authorized iroh connection. They resume from the
partial length, use 256 KiB chunks with per-chunk BLAKE3 verification, enforce the declared final size,
then verify the full hash before atomic promotion. HTTP range playback is served only through
`http://collab.localhost/<project>/<hash>` after the active native lease proves the project is open
and its document references that hash. The protocol rejects non-Tauri/non-development browser
origins and never emits wildcard CORS.

The board projection appears before media downloads. Up to four missing assets resolve in the
background. A video original therefore does not block notes, links, geometry, or other collaborators.
Failed P2P attempts create at most one media-request notification per project/hash/hour from that
device; Convex coalesces at most 64 hashes into one requester/project row. Other members are told to
open the scene and stay online.

Availability has two honest states:

- **No holder online:** the manifest exists, but no authorized source is reachable now.
- **Archived media unavailable:** this device collected its retained copy and recovery elsewhere is
  only best effort.

Current references are pinned per local project. When the final pin disappears, a marker starts a
thirty-day grace period; the file's original creation date is irrelevant. Re-pinning removes the
marker. Interrupted partials expire after 24 hours. Leaving, deleting, or aborting a project drops its
pin file so it cannot retain media forever.

## Convex data and free-plan controls

Convex can read account ids, public profiles, friendships, project ids, roles, device public keys,
timestamps, epochs, ciphertext sizes, media hashes requested by a member, and traffic patterns. It
cannot read board plaintext, project keys, sender paths, or original media.

Collaboration uses these tables: `profiles`, `friends`, `friendRequests`, `userDevices`,
`revokedDevices`, registration challenges, `projects`, `projectMembers`, `projectInvites`, `projectKeyEnvelopes`,
`projectCheckpoints`, `projectHeads`, `projectPayloadUploads`, `projectInbox`,
`projectMediaRequests`, and the bounded `projectAuditEvents` security history.

Cost controls are structural:

- live document and original-media traffic bypass Convex;
- membership is capped at 10, devices at 5/account, and projects at 100/account;
- point-in-time recovery calls replace live document subscriptions;
- Account settings reads lightweight project summaries; member profiles and pending invitations are
  fetched only for the single board whose collaboration dialog is open;
- one current head per device and one checkpoint per project bound recovery rows;
- each device may hold at most three registered unfinished recovery uploads; reservations expire
  after one hour when the next upload is registered;
- one unread activity row per user/project is reused and is not rewritten for repeat edits by the
  same actor;
- missing-media notices are coalesced for an hour in native code and on the server;
- normal publication performs one roster query; the second occurs only after key rotation;
- P2P authorisation reads are cached for thirty seconds;
- queries use indexes and bounded `take` calls on user-controlled lists;
- audit writes occur only for rare member, device, rotation, and stale-head decisions and retain at
  most 200 rows/project;
- original images and videos never consume Convex file egress.

As of August 2026, the documented Convex Free limits include 1,000,000 function calls/month,
0.5 GiB database storage, 1 GiB database I/O/month, 1 GiB file storage, and 1 GiB data egress/month.
Limits are team-wide and may change; verify the current official limits before capacity decisions.
Encrypted recovery payloads and bug-report attachments, not media originals, are the expected egress
drivers. Exceeding Free limits can cause function errors, so SQLite/outbox durability is required and
the UI must never report backend recovery as complete before acknowledgement.

## Invitations, activity, and lifecycle

NetsuBoard keeps its own friend graph because Discord OAuth identifies the account but does not expose
the Discord friend list. Profiles, friends, pending requests, projects, and invitations are bounded.
Only friends may be invited. Invitations expire after seven days, reserve one of ten seats, and grant
editor or viewer—not owner.

Project creation is transactional at product level: Convex metadata is created, Rust opens the local
document, imports existing board items and assets, then forces the initial encrypted checkpoint. The
scene becomes collaborative only after that checkpoint and the owner envelope are recoverable. A
failure before this boundary calls the empty-project rollback.

Convex keeps one consolidated activity row per recipient/project. Repeat edits by the same actor do
not cause repeat inbox writes until the row is cleared; another actor is added to the same row. On the
next authenticated launch, the app shows a transient localized toast unless that project is already
open, and keeps the durable message in Account settings until dismissed. Media requests use the same
row with distinct wording that asks a holder to open the scene and remain online.

Accepting an invitation marks the same row as key-provisioning-needed for existing writers. An
already-running app reacts to that single backend change by refreshing its native roster and wrapping
the current project key for every missing proved device; there is no project polling loop.

Leaving closes the native project, removes local retention pins, deletes the caller's envelopes,
pending uploads, request and inbox rows, and forces rotation. Deleting a project is owner-only and
deletes every Convex row and referenced recovery storage object. The owner cannot leave; they must
delete. The current running device cannot revoke itself.

## Limits and residual risks

- The WebView renderer is trusted to display plaintext that the user can already see. A renderer
  compromise can read visible board content and invoke other pre-existing desktop capabilities; raw
  collaboration keys still never enter JS.
- Previously authorized members may retain old plaintext, exported files, screenshots, and old key
  epochs. Cryptographic revocation cannot erase them.
- A signed cached roster preserves offline collaboration, so membership revocation is delayed during
  a Convex outage. Rotation and durable publishing remain blocked until the backend returns.
- Authorized writers are not treated as Byzantine adversaries. Signatures make corruption detectable,
  but a legitimate editor can intentionally create undesirable valid edits or consume their bounded
  share of resources.
- Convex upload URLs are capabilities. Retained file payloads require ownership reservations, but a
  malicious authorized writer could still abandon a raw upload before registration; operational
  storage monitoring remains necessary.
- The pre-existing Tauri asset protocol still has broad scope for solo-board local media. Collaboration
  imports do not rely on that scope, but it remains a renderer-compromise impact outside this feature.
- There is no background Windows service. Closed applications do not transfer media; recovery and
  notifications resume at the next launch.
- Media deleted after all peers' grace periods may be gone everywhere. The placeholder is final unless
  an independently retained copy reconnects.
- V1 does not provide shared cursors, background sync while the app is closed, Byzantine moderation,
  server-readable search, or shallow history truncation.

## Verification and operations

Automated acceptance covers 2–10-replica convergence across the full board contract, Unicode edits,
atomic invalid-batch rollback, durable outbox sequencing, exact head confirmation, checkpoint CAS,
signed P2P binding, viewer enforcement, path and token confinement, media range/grant behavior,
thirty-day GC transitions, Convex policy helpers, scene binding, renderer build, core type checking,
locale parity, Clippy, Rust tests, and `cargo check --locked`.

Before release, perform a real two-machine Windows session with two distinct accounts:

1. restart both Tauri windows so the new Rust core is running;
2. create a project from an existing board and verify its initial checkpoint;
3. invite an editor and a viewer, then exercise concurrent text, move, reorder, drawing, and delete;
4. disconnect each machine in turn and verify SQLite edits recover through Convex after reconnect;
5. close the media holder, verify `No holder online`, reopen it, and verify resumable transfer;
6. revoke a device and remove a member, verify rotation blocks publication until committed, then
   verify the old device cannot publish or reconnect;
7. inspect the Convex dashboard for one head/device, one inbox row/recipient/project, bounded media
   requests, no original media, and no orphaned retained upload reservations;
8. inspect Free-plan function, database I/O, file storage, and egress metrics after the session.

The board also exists in NetsuRush, but this collaboration stack is intentionally implemented only in
NetsuBoard. Mirroring renderer files alone would be unsafe: NetsuRush would need its own Convex schema,
auth deployment, Rust service, home, ports, CSP, native commands, documentation, and product decision.

# NetsuBoard local-first collaboration

## Status

Validated product direction: a collaborative moodboard for 2 to 10 participants, with Loro as the
document authority, iroh as the live and media transport, and Convex limited to identity, access,
rendezvous, encrypted recovery data, and consolidated activity notices.

This design replaces the renderer-led collaboration prototype currently present in the worktree.
That prototype is useful implementation evidence, but it is not a security or persistence contract.

## Goals

- Let 2 to 10 people edit the same board concurrently: create, delete, move, resize, reorder, write,
  draw, crop, trim, style, and change supported media and embed properties.
- Keep local editing available without Convex or another participant being online.
- Make live collaboration peer-to-peer and keep Convex usage low enough for a small free-plan beta.
- Recover committed CRDT changes even when their author is offline.
- Transfer original local media only between authorized project devices, on demand, with resumable
  and hash-verified transfers.
- Keep project keys and device private keys out of Convex and out of renderer storage.
- Make every durable transition testable: no best-effort-only save path may be presented as saved.

## Non-goals

- Convex is not the real-time document transport and never stores plaintext board content.
- Original local videos never enter Convex. Original images do not enter Convex in V1 either.
- V1 has no public project links, anonymous guests, browser client, server-rendered board, or more
  than 10 members.
- V1 does not use shallow Loro history. Compaction retains the complete history needed by active
  replicas.
- V1 does not promise push delivery while NetsuBoard is fully closed. It shows consolidated activity
  when the app reconnects and may use a Windows notification while the native process is running.
- The system cannot protect visible board plaintext from arbitrary code execution inside the trusted
  main renderer: that renderer must display the board and already holds the user's authenticated
  session. The design prevents that renderer from receiving raw private keys, choosing arbitrary key
  recipients, authorizing arbitrary peers, or adding a new arbitrary-file-read collaboration API.

## Chosen architecture

The Rust shell owns a `CollabService` actor. The actor owns all mutable collaboration state for open
projects: Loro documents, durable journals, device identity, project key rings, peer sessions, blob
transfers, Convex HTTP calls, and synchronization scheduling.

Renderers are clients of this service. They render immutable projections and send typed user
intent. They do not run an independently writable Loro document, decide membership, construct key
envelopes, provide peer allowlists, or publish encrypted heads.

The renderer obtains a short-lived Better Auth Convex JWT and hands it to Rust in memory. Rust calls
the pinned Convex deployment directly through the documented `/api/query`, `/api/mutation`, and
upload endpoints. The deployment URL is embedded in the native build configuration; an IPC caller
cannot replace it with an attacker-controlled host. JWTs are never written to disk and are refreshed
before expiry.

The two rejected alternatives are:

- **Renderer courier and security authority.** It is smaller, but makes key wrapping and peer access
  depend on attacker-controlled IPC arguments.
- **Convex real-time document transport.** It is operationally simpler, but turns every interaction
  into backend traffic and defeats the local-first and free-plan goals.

## Component boundaries

### Rust `CollabService`

One actor serializes state transitions. Async network work sends results back to the actor instead of
holding document locks across `await` points.

Its public API is intentionally high level:

- configure or clear the in-memory authenticated session;
- create, open, close, leave, or delete a collaborative project;
- invite, accept, reject, remove, or change a member role;
- register or revoke this device;
- apply a typed operation batch;
- request an immutable projection and status stream;
- import a user-selected media file through an opaque native import grant;
- request, cancel, pin, or release a referenced blob;
- request compaction or an immediate recovery publication.

No command accepts an arbitrary recipient public key, a renderer-provided peer allowlist, a raw
filesystem destination, or an unrestricted source path.

### Renderer clients

The main and detached reference windows share the same native service. Each subscribes to project
revision events and asks for a projection when the revision changes. Both can submit operations when
their role allows it; neither mutates a separate writable truth.

Transient view state remains local: selection, viewport, active tool, drag previews, a stroke still
being drawn, playback time, hover state, and cursors. Presence and cursors are ephemeral iroh
messages and never enter Loro or Convex.

### Convex

Convex owns account-bound metadata and encrypted recovery objects only:

- projects and roles;
- pending project invitations;
- verified devices and revocation state;
- key envelopes by project, epoch, and target device;
- one checkpoint generation per project;
- at most one unabsorbed head per active device;
- one consolidated unread activity record per project and target user;
- coalesced media-wanted requests;
- an audit trail for destructive membership, key, and stale-head decisions.

All public functions authenticate through Better Auth and perform authorization inside the function.
Client-side visibility is never treated as access control.

The Better Auth user id is the account authority. Display names and avatars are copied only from the
authenticated server identity, never from renderer arguments. Invitations target a unique,
server-issued invite code or an already-known account id; a mutable or duplicated Discord display
name is not an authorization identifier. V1 does not require a separate friendship relationship to
join a project.

## Trust model and security invariants

### Protected assets

- device signing and exchange private keys;
- project content keys and prior key epochs;
- encrypted checkpoint and head integrity;
- project membership and roles;
- local CRDT durability and unpublished branches;
- original media bytes and local filesystem paths.

### Attacker capabilities considered

- an unauthenticated internet client calling public Convex functions;
- an authenticated non-member or read-only member;
- a removed member retaining old keys and a still-valid account session;
- a malicious or malformed iroh peer;
- a compromised Convex database or storage bucket;
- replay, reordering, duplication, truncation, and corruption of network messages;
- malicious project, device, item, filename, and payload identifiers;
- a renderer issuing arbitrary collaboration IPC calls with the current user's session.

### Device proof

Each device has an Ed25519 signing key, X25519 exchange key, and iroh endpoint identity. Private
material is encrypted with Windows DPAPI for the current user.

`deviceId` is derived from the signing public key. Registration uses a short-lived, single-use Convex
challenge. The device signs a domain-separated statement binding the challenge, account identifier,
device identifier, signing key, exchange key, and iroh endpoint. Convex verifies the proof before an
atomic challenge consumption and device insert. A changed exchange or endpoint key requires a new
proof and is surfaced as a device identity change. Forgetting a device persists a server tombstone
before deleting its active row, preventing the same native identity from enrolling itself again.

### Membership and peer admission

Rust fetches the project roster directly from Convex over TLS and accepts only proof-registered
devices. iroh's authenticated QUIC handshake proves possession of the registered EndpointId. The
inner encrypted update is independently signed by that same device and binds project id, device id,
protocol purpose, key epoch, sequence/base metadata, and the exact ciphertext hash.

Inbound P2P authorization reuses an online roster for at most thirty seconds before attempting a
refresh. If Convex is unavailable, the service may continue with its locally signed cached roster so
existing collaborators can keep working offline. Revocation can therefore be delayed for the length
of a backend outage; durable publication and key rotation still require Convex and fail closed. This
availability tradeoff is explicit in the UI/operational contract and threat model.

Every Convex head write verifies, in the same mutation, that the device is active, belongs to the
authenticated account, is still a project member, has a writer role, and uses the current key epoch.
Possession of an old project key is never sufficient write authority.

### Renderer and Tauri boundary

Private keys and project keys are never returned over IPC. Key wrapping accepts a target device id;
Rust resolves and verifies the target through its native Convex client. Peer synchronization accepts
no renderer-provided endpoint or allowlist.

Collaboration commands receive dedicated Tauri permissions and are available only to the local main
and reference windows. Remote URLs receive no capabilities. The implementation also introduces a
restrictive CSP compatible with the existing Convex, media, embed, and development origins rather
than leaving CSP disabled.

The current unrestricted asset protocol and token-authenticated core media bridge remain trusted
renderer surfaces for the existing local board. They must be audited while integrating collaboration,
but are not replaced with a second unrestricted path. Collaboration media ingestion uses native
selection or an opaque, single-use import grant with canonical path confinement, a random identifier,
and an expiry.

### Path and payload safety

Raw project ids never become path components. Native storage directories use a fixed-length BLAKE3
digest of the validated id. Temporary and blob paths are built from validated hashes, canonicalized,
and checked for confinement after resolving Windows junctions, links, and short names.

All incoming frames, operations, manifests, strings, arrays, dimensions, timestamps, and chunk
counts have explicit limits. External I/O has timeouts and cancellation. Invalid batches and imports
leave the live document and durable journal unchanged.

## Project roles and lifecycle

Roles are `owner`, `editor`, and `viewer`.

- One owner exists at a time. V1 does not transfer ownership.
- Only the owner invites, removes, changes roles, discards a stale head, or deletes a project.
- Editors may publish document changes and media they hold.
- Viewers receive state and media but their UI and native service both reject write operations.

The owner cannot leave or delete their own membership while the project still exists. Projects are
limited to ten members including the owner and five active devices per account. Pending invitations
reserve the remaining project seats, so a project can never have more than nine. Expired, accepted,
and rejected invitations do not remain active quota rows.

A collaborative project id is stored in the board scene/project metadata. It is never selected from a
single global `localStorage` value. Opening or changing a scene closes the previous native session
before another project can receive operations.

Creating collaboration imports the current board into a new native Loro document, creates epoch 1,
persists it locally, creates the Convex project, registers the owner device, publishes the initial
encrypted checkpoint, and only then marks the scene collaborative. Failure before the final step
leaves the solo board untouched and offers retry or cleanup.

Solo NetsuBoard remains usable without signing in. Creating, joining, or managing collaboration
requires an active authenticated session. A previously opened collaborative project may still be
edited locally during an offline authentication grace period because its durable role and keys are
already present; network admission and Convex publication resume only after native authorization is
fresh again.

Accepting an invitation creates membership but does not imply key availability. The project shows
`Waiting for the owner to share access` until an active owner device publishes a verified envelope.
The owner receives a consolidated request on reconnect.

Removing a member is a two-phase rotation:

1. Convex atomically removes the membership, marks rotation pending, and blocks publications using
   the previous epoch.
2. An owner device creates a fresh key, wraps it only for currently active member devices, uploads
   the envelopes, and commits the new epoch.

While rotation is pending, local edits remain durable but remote publication pauses. The UI never
claims revocation is complete before the new epoch is committed.

## Loro document contract

The Rust Loro document is the only collaborative truth. The schema has an explicit document version
and every wire operation has an explicit protocol version.

Top-level containers are:

- project metadata and board-wide palette;
- items keyed by stable item id;
- stacking order as the sole movable list;
- drawing objects keyed by stable shape or stroke id;
- tombstones and schema metadata.

Item child maps store complete durable board state. Operation groups that should not produce mixed
states are atomic values: geometry, crop, trim, appearance, text style, frame style, playback, media
manifest, link/embed metadata, and sequence metadata. `z` is not part of geometry; stacking order is
derived only from the order list.

Text is a `LoroText`. Renderer edits become Unicode-code-point-safe insert and delete operations.
The adapter computes a minimal common-prefix/common-suffix edit when an existing UI surface only
provides a replacement string. JavaScript UTF-16 indices never cross the Rust boundary.

Finished freehand strokes are immutable compact binary values with a stable stroke id. Creating or
deleting a stroke is one CRDT operation. Editing a stroke creates replacement stroke objects. Vector
shapes retain independently mergeable style and geometry groups. Stroke-in-progress points remain
ephemeral until the stroke ends.

Projection is total: an empty remote item set projects to an empty board, deleted items disappear,
and every durable `BoardItem` field is either mapped to Loro or explicitly classified as local or
derived. `src`, object URLs, loading state, playback time, selection, and availability probes are
never persisted. Media `ref` is a hash manifest; `src` is resolved locally.

### Atomic operation batches

The actor prevalidates an entire batch against a shadow state, including operations that depend on
earlier operations in the same batch. It then applies the batch under one Loro commit. A pre-batch
snapshot is retained until persistence succeeds; any unexpected Loro or storage failure restores the
previous document. Renderers receive either the committed revision or a typed error, never a partial
batch.

## Native persistence and outbox

Each project uses one SQLite database in WAL mode, compiled into the Rust binary. A single writer
owned by the actor provides transactions without cross-file atomicity assumptions.

The database stores:

- the last durable checkpoint and its version vector;
- imported remote updates not yet compacted;
- local Loro updates;
- the monotonic local sequence;
- the exact sealed head header, ciphertext, signature, base version, and publication state;
- project key epochs and trusted-roster cache metadata;
- blob references, pins, grace deadlines, and transfer progress.

A local edit transaction writes the Loro update, increments the sequence, and records the exact
outbox envelope before acknowledging the renderer. Publication retries reuse those bytes and that
sequence. Unpublished entries are never dropped to enforce an arbitrary queue length.

Startup imports the durable checkpoint and all journaled updates, verifies signatures and hashes,
then resumes unpublished outbox work. Corrupt rows are quarantined with a visible recovery error;
they are not silently ignored.

Identity private keys and every locally stored project content key are individually DPAPI-wrapped in
native-owned files. SQLite holds the local Loro journal, signed cached roster, and already sealed
outbox but never a plaintext project/device key. No plaintext key is made durable.

## Encryption and envelopes

Every checkpoint, head, and direct Loro update is encrypted with XChaCha20-Poly1305 under the current
project epoch. The random nonce is carried inside the encoded ciphertext. The clear signed header is
limited to project id, device id, sequence, base checkpoint epoch, key epoch, purpose, and ciphertext
hash. Stable protocol/project/purpose fields are AEAD associated data. The device signs the canonical
complete header plus ciphertext, so the non-circular ciphertext hash and all routing metadata are
authenticated.

Project key distribution uses HPKE with X25519, HKDF-SHA256, and ChaCha20-Poly1305. Its HPKE context
binds protocol, project, epoch, and the resolved recipient exchange key. Convex separately binds the
envelope row to the proved target device and current membership. Native code rejects cross-project,
cross-epoch, and cross-recipient substitution.

Convex therefore learns membership, device metadata, sizes, timing, and encrypted object churn, but
not board content or original media bytes.

## Live synchronization over iroh

The collaboration protocol uses a versioned ALPN and a mutually authenticated handshake. After
authorization, peers exchange version vectors and request only missing Loro updates. Duplicate,
reordered, or already-known updates are harmless and acknowledged without reapplication.

Document frames have a conservative maximum size. Larger state recovery uses the checkpoint/head
path rather than an unbounded in-memory frame. Every read, write, handshake, and idle session has a
timeout. Per-peer queues are bounded; slow peers trigger resynchronization instead of unlimited
buffer growth.

Presence, drag previews, cursors, and stroke previews use a separate lossy channel. They are rate
limited and may be discarded without affecting document correctness.

## Convex recovery protocol

### Publication

Direct iroh delivery is immediate. Convex publication is coalesced after three seconds of inactivity,
at least every thirty seconds while dirty, on project close, and before an orderly application exit.
The local outbox remains the truth when publication fails.

An encrypted payload of roughly 512 KiB or less is stored inline (the implementation caps its Base64
wire body below 768 KiB). A larger payload uses a short-lived Convex upload URL and is finalized with
its storage id, BLAKE3 digest, length, header, and signature. Failed or abandoned uploads are cleaned
without changing the active head.

Each active device owns at most one unabsorbed server head. Replacing it requires compare-and-swap
against its previous sequence and checkpoint generation. A server mutation verifies authorization,
epoch, bounds, and CAS before replacing the pointer. The old file is deleted only after the new row
commits.

### Resume and compaction

Opening a project performs point-in-time reads for the checkpoint, active heads, envelopes, roster,
and activity state. These are not long-lived React subscriptions. Rust verifies and imports the
checkpoint, then every compatible head, and publishes any local unpublished branch.

Compaction builds a separate temporary Loro document from the selected checkpoint and selected
heads. It never snapshots the live document directly. The new encrypted checkpoint is committed by
CAS with the selected head sequences. Only that successful mutation marks those heads absorbed. A
concurrent head survives for the next compaction.

After a membership/device rotation commits, an existing writer immediately re-encrypts the selected
checkpoint/head set under the new key. Any failure is retried on the next security refresh, and old
per-device envelopes are pruned only by the successful new-key checkpoint mutation.

Unabsorbed heads are not automatically deleted after thirty days. The owner sees the device, age,
and encrypted size and may explicitly discard one through an audited destructive action.

## Notifications and offline behavior

CRDT changes do not require the author to come back online: their encrypted Convex head is sufficient
for another authorized device to recover text, layout, drawings, manifests, and links.

Convex keeps at most one unread activity row per project and target user. The first publication after
acknowledgement creates or marks it unread. Later heads do not rewrite it while it remains unread.
Acknowledgement occurs only after the target device has actually merged the advertised generation.
This bounds notification fan-out to one write per recipient per unread period instead of one write
per interaction.

Media bytes are different. When a manifest is present but no authorized holder is online, the item
shows `No holder online`. An explicit request creates or updates one coalesced media-wanted row per
project and requester, with a bounded set of hashes and a retry window. A holder later sees that a
collaborator needs media and the native service offers the blobs over iroh. `Archived media
unavailable` remains a separate state when no retained copy is known to exist.

## Media storage and transfer

Loro stores only a media manifest: BLAKE3 hash, byte length, MIME type, kind, safe display name,
dimensions or duration when known, poster/proxy hashes, and provenance fields needed by the board.
It never stores an absolute sender path or object URL.

The Rust `collab-blobs` store owns bytes and metadata. Import streams into a temporary file, enforces
per-kind limits, computes BLAKE3, fsyncs, and atomically moves the verified file into its hash path.
The temporary file and its opaque grant expire after an interrupted operation.

Transfers use bounded chunks with chunk hashes, an authenticated manifest, persisted received ranges,
resume negotiation, cancellation, and final full-file verification. A partial or oversized transfer
cannot become a provider. Requests are authorized for the project and hash, not merely for a globally
known friend or endpoint.

Links, YouTube ids, and ordinary embeds synchronize as small metadata only. Images fetch on demand.
For videos, the poster or light proxy is requested first and the original only after an explicit play,
export, or keep-offline action. Once verified, a receiver may serve the blob to other authorized
members.

Blobs referenced by current state, an unpublished outbox entry, an active transfer, or a local
keep-offline pin are not collected. An unreferenced blob receives a thirty-day grace period. Historical
time travel to collected media shows `Archived media unavailable` and may attempt best-effort peer
recovery. A local keep-offline pin never imposes disk use on other members.

## Cost controls

- Live document, presence, cursor, and media traffic bypass Convex.
- Checkpoints and heads use point-in-time native HTTP reads instead of React subscriptions.
- Publication is debounced and has a thirty-second maximum interval, independent of pointer-event
  frequency.
- One current head per device bounds metadata rows and write contention.
- Activity writes stop while a recipient already has an unread row.
- Media-wanted requests are bounded and coalesced; original media is never backend egress.
- Project membership is capped at ten, invitations and devices have explicit caps, and every list is
  indexed and bounded.
- Convex functions avoid scans, JavaScript filtering after collection, `Date.now()` inside reactive
  queries, and hot parent-document heartbeats.
- Inline and file-backed bytes are measured separately so beta telemetry can identify the real quota
  consumer before introducing more infrastructure.

## UI contract

The collaboration dialog supports project creation, invitation by verified account identity,
pending invitations, active role, member and device management, leaving, deletion, and revocation
progress. It never reports a project as shared before the initial checkpoint and owner envelope exist.

The board displays compact states for connecting, live peers, offline edits queued, recovery upload
failed, key pending, rotation pending, media requested, no holder online, archived media unavailable,
and read-only access. Viewer controls that mutate shared state are disabled before interaction and the
native service still enforces the role.

Switching scenes or projects cannot leak operations into the previous project. The detached reference
window receives the same revision stream. Solo autosave is disabled as an authority while a
collaborative session is active; a local export remains available as an explicit user action.

All new visible copy is added to all six locales. The French locale remains the source wording.

## Failure handling

- **Convex unavailable:** local edits commit to SQLite; direct peers continue only while roster
  authorization is fresh; outbox retries with bounded exponential backoff.
- **iroh unavailable:** local edits and Convex recovery continue; media waits for a holder.
- **JWT expired:** native publication pauses, renderer refreshes the short-lived token, and no durable
  data is discarded.
- **CAS conflict:** fetch the winning checkpoint/head set, import it, reseal the local unabsorbed
  branch, and retry.
- **Key unavailable:** keep ciphertext durable and show key-pending; never discard or mislabel it as
  corrupt.
- **Malformed remote input:** reject before mutation, score the peer failure, and disconnect after a
  small threshold.
- **Disk full or SQLite failure:** reject the local edit acknowledgement and keep the prior rendered
  revision; never show an unsaved operation as committed.
- **Blob corruption:** quarantine the partial file, retain the manifest, and retry from another
  authorized holder.

## Migration from the current prototype

The existing prototype is not migrated in place as a trusted format because it has never shipped.
Implementation keeps reusable typed definitions and UI work only where they satisfy this contract.
Renderer-controlled key wrapping, peer allowlists, direct paths, global project selection, incomplete
projection, non-atomic outbox writes, and dead synchronization helpers are removed or replaced.

No production user data migration is required. Development-only prototype databases and key rings
use a protocol/schema version; incompatible versions fail closed with an explicit development reset
message.

## Verification and acceptance

Completion requires automated evidence for all of the following:

- two through ten replicas converge after concurrent create, edit, move, reorder, delete, palette,
  text, drawing, crop, trim, media-manifest, embed, and sequence operations;
- an empty remote board clears the local projection;
- Unicode text edits, including emoji and combining characters, use correct code-point positions;
- invalid multi-operation batches leave the document and SQLite journal unchanged;
- a crash after local acknowledgement and before network publication resumes the exact sealed outbox;
- duplicate, reordered, missing, stale-epoch, corrupt, oversized, and wrongly signed frames are safe;
- offline branches merge through Convex even when their original device is offline;
- a checkpoint CAS racing a new head never loses that head;
- a removed member and revoked device cannot publish or establish a fresh session;
- rotation does not claim completion until all current target envelopes and the new epoch commit;
- a renderer cannot choose an arbitrary key recipient, peer endpoint, blob hash, or collaboration file
  path;
- project id, temporary path, junction, symlink, short-name, and guessed-token attacks remain confined;
- chunked media resumes after interruption and rejects a mismatched final hash;
- current references, outbox references, transfers, and pins survive GC; expired orphans are collected;
- activity writes remain consolidated during repeated publications;
- project/scene switching and the detached window cannot write to the wrong document;
- viewer mode is enforced in both UI and native code;
- every new Convex query is indexed and bounded, and every mutation enforces authentication and role;
- renderer build, core type check, locale parity, targeted Node tests, Rust formatting, Clippy, Rust
  tests, and `cargo check --locked` pass with fresh output.

Runtime validation requires a deliberate Tauri window restart because native and core changes are not
hot-reloaded. The implementation does not start, close, rebuild, or package the running application
without separate authorization.

## Repository scope

This implementation changes NetsuBoard only. The existing board has a manual NetsuRush mirror, so
the final handoff must list every board-facing change that NetsuRush would need. Collaboration itself
remains disabled in NetsuRush until its own authentication, deployment, native shell, and product
decision are explicitly prepared; copying only renderer files would be unsafe.

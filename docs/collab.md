# Real-time collaboration — specification

**Status: specification only. Nothing in this document is implemented.** No code, schema or dependency described here exists in the tree yet. Implementation starts once this document is validated.

Scope: shared moodboard projects for **2 to 10 people**. Participants place, move and organise items, write, draw and add media at the same time. Local-first: every machine holds a complete copy of the **collaborative state** and stays fully usable offline. Original media remains on-demand unless it has been downloaded or pinned locally.

The board also exists in NetsuRush. There is no shared package or automatic synchronisation between repositories. Every implementation change to the collaborative board — data model, conflict rule, IPC, persistence, media behaviour or UI — must be mirrored manually in NetsuRush, and the PR must state exactly what needs mirroring.

## 1. Layers and ownership

| Layer | Component | Owns | Never holds |
|---|---|---|---|
| Collaborative truth | **Loro** | project state, merge of concurrent edits, local undo | media bytes |
| Transport | **iroh** | direct QUIC connections, live updates, media transfer | authority over state |
| Rendezvous | **Convex** | invites, members, devices, key envelopes, checkpoint, heads, inbox | plaintext board content or media |

Convex necessarily sees account and routing metadata: project id, membership, roles, device ids, timestamps, epochs and ciphertext sizes. Project names and notification copy are encrypted unless the product explicitly chooses to expose them; an inbox entry may identify its actors but must not require a plaintext board name.

`iroh-docs` is **not** used: Loro fills that role, and stacking both creates two competing sync systems.

For 2–10 participants, peers connect through iroh directly when possible and through an encrypted relay fallback otherwise. `iroh-gossip` is only considered if group size grows.

## 2. Process layout

`CollabDocumentService` lives in **Rust, `src-tauri/`**, using the `loro` crate. It is the single authority.

The service owns: the Loro document, local persistence of its snapshot, the local `UndoManager`, import/export, checkpoint and head production, project keys, encryption, device signature, and the projection pushed to renderers.

Rationale: the highest-frequency paths are *update → network* and *update → windows*. Both are in-process or one native hop from Rust. The low-frequency paths (autosave, `.netsu` export) are the ones that cross a boundary. Project keys never enter a JS heap or a WebView.

Renderers hold a **read-only replica** (`loro-crdt`, WASM), one per window. A replica never exports, never persists, never accepts an update from anywhere but the service, and sends every write to the service as an operation. It rebuilds its state from the service after a reload. One authority, N caches — not two truths.

### 2.1 IPC contracts

**Renderers ↔ service** — Tauri commands and events.

- Commands: `collab_apply(projectId, ops[])`, `collab_bootstrap(projectId)`, `collab_undo`, `collab_redo`, `collab_ephemeral(state)`.
- Binary transport: Loro updates travel over a per-window `Channel` typed on **`InvokeResponseBody::Raw`**, or as a command returning **`tauri::ipc::Response`**. A `Channel<T>` over a `serde` struct and a plain `Vec<u8>` return both serialise to JSON — they compile and work, and only measurement reveals the mistake.
- JSON events carry only: presence, connection state, transfer progress, and the identifier or sequence of an available update.

**Service ↔ iroh** — in-process. No IPC.

**Service ↔ core Node** — there is no direct Rust↔Node bus. The renderer is the courier for rare operations (snapshot save, `.netsu` export). Bytes do not travel through the renderer:

1. Rust writes the payload into a dedicated directory under the NetsuBoard home.
2. The renderer forwards an **opaque, unguessable identifier** — never a path.
3. The core rebuilds the path itself, canonicalises it (resolving junctions, symlinks and 8.3 short names **before** the containment test), verifies it stays inside that directory, enforces a maximum size and the expected type, consumes the file **once**, and deletes it.
4. The temporary file carries its own TTL, so an interrupted flow leaves nothing behind.

A renderer that could hand over an arbitrary path would be a file-read primitive for a compromised WebView.

The temporary directory must not reuse any of the paths listed as known collisions at the end of `docs/invariants.md`.

Any new core channel is declared in the three usual places: `core/rpc.js`, `NrApi` + implementation in `src/lib/coreClient.ts`, `mock` in `src/lib/bridge.ts`.

**Service ↔ Convex** — the renderer is the courier. The Convex client and the Better Auth session stay in the renderer; the service produces sealed, signed envelopes and the renderer uploads opaque bytes. Consequence, accepted: **no synchronisation while NetsuBoard is closed.** At next launch the session is restored, the renderer reads `projectInbox` and the heads, hands the ciphertext to the service, and the service decrypts, verifies and merges. A background service is a possible V2, not a requirement.

## 3. Document model

The Loro document holds project metadata, items indexed by id, their committed geometry, texts as `LoroText`, finished strokes, stacking order as a movable list, and media references and manifests.

### 3.1 Operation vocabulary

Renderers never write into containers by path. A generic `set(path)` API allows invalid states and bypasses the atomicity rules below. Writes are versioned operations, produced by TypeScript, **validated and applied by Rust**:

The initial vocabulary is normative, not illustrative:

`AddItem`, `DeleteItem`, `SetGeometry`, `SetCrop`, `SetTrim`, `SetItemAppearance`, `SetTextStyle`, `TextInsert`, `TextDelete`, `SetFrameStyle`, `SetPlayback`, `SetMediaManifest`, `SetLink`, `SetEmbed`, `SetSequence`, `SetPalette`, `MoveItem`, `AddStroke`, `DeleteStroke`.

Together these operations must cover every writable persisted field of `BoardItem`. Unknown fields and unknown operation versions are rejected. Adding a persisted field to `BoardItem` therefore requires, in the same change, a schema decision, a typed operation or an explicit local-only classification, Rust validation, TypeScript projection, migration coverage and the NetsuRush mirror.

Two independent version numbers, with different lifetimes:

- **Document schema version**, stored inside the Loro document. A build that does not understand it refuses to open the project rather than corrupting it.
- **Operation protocol version**, on the Rust↔TypeScript wire.

Compatibility tests cover both directions.

### 3.2 Container schema and lifecycle

The document has a versioned, fixed root layout:

- `meta`: project id, display metadata and document schema version; any copy of that display metadata stored separately in Convex is encrypted;
- `items`: map keyed by random, never-reused item ids;
- `order`: movable list of item ids;
- `strokes`: map keyed by random, never-reused stroke ids;
- `strokeOrder`: movable list of stroke ids.

Each item is a mergeable child map with typed fields. Concurrent initialisation uses Loro's mergeable-container API; a renderer never creates containers directly. Text content is a `LoroText`. Geometry, crop, trim, appearance groups, playback state, frame style, media manifest, link, embed, sequence metadata and palette state are each stored as one atomic value for their operation group, not as independently writable scalar keys.

Deletion is a tombstone, not removal of the child container. `DeleteItem` sets the lifecycle tombstone and removes the id from `order`; projection filters every tombstoned id even if a concurrent move leaves or reinserts an order entry. Item ids are never reused, so a stale `AddItem` cannot resurrect a deleted item. Strokes use the same tombstone rule. Local undo may create a new lifecycle operation through Loro's `UndoManager`; it never mutates history in place.

Only Rust runs document migrations. A newer unknown schema is opened read-only with an explicit incompatibility error; it is never rewritten. Migrations are deterministic and covered by golden snapshots shared with the TypeScript projection tests.

### 3.3 Ephemeral, never committed

Personal pan and zoom, selection, cursors, active tool, intermediate positions during a drag, the current point of a stroke in progress, video playback position.

These travel through Loro's `EphemeralStore` over iroh. Never through Convex, never into the document.

Geometry is committed **on pointer release**. A stroke is synchronised **once finished**. This split is what keeps operation count proportional to gestures rather than to frames.

### 3.4 Strokes

A finished stroke is stored as a **single encoded binary value**, not as a Loro list of points: one operation per stroke instead of thousands. A stroke is immutable once committed; it can only be deleted.

Consequence: the eraser cannot split a stroke. Erasing part of a stroke deletes it and creates the remaining segments as new strokes.

### 3.5 Conflict rules

Loro guarantees convergence, not a desirable outcome. Per-field decisions:

| Field | Rule |
|---|---|
| Delete vs move | delete wins |
| Geometry | `{x, y, w, h, rotation}` is **one LWW register**, serialised — never five map keys |
| Crop | atomic rectangle |
| Video trim | atomic range |
| Text | `LoroText` |
| Stacking order | movable list |
| Finished stroke | immutable, then deletable |
| Media source | atomic manifest, identified by hash |
| Pan, zoom, selection, playback | local or ephemeral |

Five separate keys for geometry produce exactly the field-by-field merge to avoid: Alice's position with Bob's size.

Accepted consequence: two people resizing the same item by different handles — one wins entirely. The result must be **visible** on screen (the item jumps), never silent.

Undo uses Loro's local `UndoManager`, so nobody undoes someone else's work.

## 4. Media

**Links, YouTube, embeds** — only the URL and metadata are synchronised. Each participant fetches from the source.

**Local images** — the manifest is synchronised immediately: content hash, name, MIME type, size and dimensions. The original travels over `iroh-blobs`. An optional encrypted WebP thumbnail may live in Convex so the board stays readable when every holder is offline.

**Local videos** — the original never enters Convex. Order of operations: show the item and its availability state immediately; transfer a poster or light proxy first; transfer the original **on demand only**; resume interrupted transfers; verify with the hash. Once received, the receiver becomes an iroh provider too.

Availability is live or explicitly labelled as stale. On connection, peers advertise the BLAKE3 hashes they can currently provide. The UI may say *three online sources* or *last known on Alice*; it must never present a last-known holder as a currently available copy. A missing asset distinguishes: online provider available, only stale provider knowledge, no known provider, and locally collected.

### 4.1 Blob store

The board asset store and `iroh-blobs` do not share a hash function or an owner today. For collaborative projects:

- **BLAKE3** is the network identity of a blob.
- Rust owns the `collab-blobs` store and its GC.
- Node reads it during `.netsu` export.
- The manifest carries hash, local path, size, MIME and availability.

Rust and Node never write concurrently into the same directory. Existing solo assets stay in their current store until solo → collaborative conversion.

### 4.2 Retention

Blob retention is **decoupled from Loro history**. Loro stores references and hashes, not bytes; keeping full CRDT history does not require keeping every past media file.

Pinned, never collected: blobs referenced by the current state, by the outbox, or by an active transfer.

A blob no longer referenced by the current state enters a **30-day grace period**, then becomes collectable.

An older document state that references a collected blob shows a placeholder and attempts best-effort P2P recovery. Other peers may have different grace deadlines or a local pin, so recovery is possible but never promised. Its wording must be distinct from the "no holder online" state — otherwise the user waits forever for a file that may no longer exist anywhere:

- *archived media unavailable* — collected locally, recovery uncertain;
- *no holder online* — the file exists, nobody is reachable right now.

Thumbnails are cached locally by hash and downloaded once per device. Convex egress is counted in downloads; without this cache, thumbnails are the single line of code that decides the monthly ceiling.

A future **keep offline** pin is local to one device. It must not silently impose disk usage on every collaborator. Project-wide replication policy is a separate future feature.

## 5. Convex

Convex stores invites, memberships, device changes, key envelopes, a checkpoint, at most one unmerged head per device and consolidated notifications. Live sync, cursors and all media go over iroh.

Tables: `projects`, `projectMembers`, `projectInvites`, `userDevices`, `projectCheckpoints`, `projectHeads`, `projectInbox`, per-device key envelopes.

`projectHeads` has a unique logical index on `(projectId, deviceId)`.

`projectInbox` holds **one consolidated notification per user and project**, updated in place, never inserted repeatedly. The server-side copy contains no plaintext project name. Example payload meaning: *Alice and Karim edited a shared project*; after decryption, the client may decorate it with the local project name.

Every query and mutation authenticates the Better Auth session and checks project membership server-side. Head and checkpoint publication require a writer role; compaction requires a writer role and the CAS described below; invitations, membership changes, key-envelope changes and destructive head disposal require owner/admin rights; inbox reads are scoped to the current user. Convex cannot validate encrypted CRDT contents, but it validates ids, roles, epochs, sequence uniqueness, sizes and quotas before accepting their opaque payloads.

Convex is **not** a presence system. Availability is determined by trying to reach EndpointIds over iroh. No polling, no heartbeat.

Retention is bounded, quotas are per project so a bug cannot fill storage, and old checkpoint files are deleted only after a successful CAS.

### 5.1 No shallow snapshots in V1

An empty head set does **not** prove that no offline device holds unpublished work. A shallow snapshot cannot import concurrent operations that predate its cut point, so a device returning after the cut would be unable to merge.

V1: full Loro checkpoints only, no CRDT history deletion, full resync accepted when needed. Shallow arrives later with a coordinated epoch protocol or an explicit rebase mechanism for late devices.

### 5.2 Heads

One head per device, carrying its unmerged branch as a **delta from the checkpoint's version vector**. A delta is not guaranteed small: under a measured threshold it lives in a Convex document, above it in file storage, with the same CAS path on the pointer. Convex documents are capped at 1 MiB, and file storage has no in-place patch — each upload yields a new `storageId`.

**Local work always goes through a head. A checkpoint only ever absorbs heads.** Injecting local work straight into a checkpoint reintroduces lost updates: two devices compacting the same heads plus their own local work would overwrite each other. When a checkpoint only merges already-published material, overwriting is harmless because both results converge.

**Stale-head threshold: 30 days.** After 30 days without refresh, the head is marked stale and the project owner is warned. An unabsorbed published head is **never deleted automatically**: the originating disk may be gone, so the server copy may be the only surviving branch. It remains bounded by the one-head-per-device invariant.

The owner may explicitly discard a stale, unabsorbed head after a destructive warning that names the device, age and byte size and states that published edits may be permanently lost. That decision is audited. This is the only retention path allowed to lose a published operation.

### 5.3 Envelope

Cleartext but authenticated header: `projectId`, `deviceId`, `seq`, `baseCheckpointEpoch`, `keyEpoch`, ciphertext hash.

`keyEpoch` must be readable **without decrypting** — otherwise a device cannot know which key to try.

Encrypted body: start version vector, end version vector, Loro delta.

The device signature covers header and ciphertext. Convex verifies nothing about CRDT inclusion; it guarantees only the CAS on epoch and head revisions. Inclusion is computed client-side after decryption.

### 5.4 Compaction

The compactor **never exports its live document**, which may contain unpublished local work. It builds a temporary document containing only the current checkpoint and the heads selected at the start of compaction, imports them, produces the new checkpoint, then commits. Local edits made meanwhile stay in the device's own head.

The commit is a single mutation carrying `expectedEpoch`, the new checkpoint `storageId`, the exact list of consumed heads, and each head's observed revision. In one transaction: verify the epoch matches; verify every head still exists with the same revision; replace the checkpoint pointer; increment the epoch; delete only the consumed head records.

If a head or the epoch changed, the mutation fails and compaction restarts. Convex mutations are transactional.

Head deletion is expressed in version vectors, not intent:

```
delete head H  ⟺  VV(checkpoint_new) ⊇ VV(H)  AND  H unchanged since read (CAS)
```

### 5.5 Outbox

A monotonic sequence is not enough on its own. Order is mandatory:

1. produce and encrypt the head;
2. record it in a **durable local outbox**, in the same atomic write as the `seq` counter, before any send;
3. only then upload to Convex;
4. mark the entry published on confirmation.

After a crash the device republishes **exactly the same head**, same `(projectId, deviceId, seq, hash)`, and Convex treats that tuple idempotently. Same `(projectId, deviceId, seq)` with a **different hash** is rejected, never upserted: it signals a bug or a cloned device.

If `seq` were incremented in memory and the crash happened before the write, the device would reuse a sequence number for different content and idempotency would not catch it.

## 6. Keys, membership, permissions

Each device holds a **persistent** iroh identity — never regenerated at startup — used to authenticate connections, plus a **dedicated X25519 exchange key**, registered in Convex and signed by the device identity. No key material is derived from the Ed25519 iroh identity.

### 6.1 Cryptographic profile

The wire format is versioned and uses maintained, audited library implementations only:

- device identity and envelope signatures: the persistent Ed25519 iroh identity;
- project-key wrapping: HPKE with DHKEM(X25519, HKDF-SHA256), HKDF-SHA256 and ChaCha20-Poly1305;
- project master key: 32 random bytes from the operating-system CSPRNG for each `keyEpoch`;
- checkpoint, head and thumbnail encryption: XChaCha20-Poly1305 with a fresh random 192-bit nonce for every ciphertext;
- subkeys: HKDF-SHA256 from the project master key with distinct, versioned labels for checkpoints, heads and thumbnails;
- integrity and content identity: BLAKE3 where a content hash is required; AEAD authentication remains the security boundary.

The canonical header bytes are authenticated as AEAD associated data. The signature covers the format version, canonical header, nonce and ciphertext. Parsers reject non-canonical encodings, unknown versions, nonce reuse detected within a local outbox, oversized inputs and any authentication failure. Secret buffers are zeroised where the libraries permit it. No custom cipher, key conversion or signature construction is introduced.

On Windows, device secrets, exchange secrets and the project-key ring are encrypted at rest with DPAPI scoped to the current Windows user. Metadata and outbox commits use atomic replace semantics. A corrupt or unavailable key ring is a hard, visible error: NetsuBoard never silently regenerates an identity. Recovery means enrolling a new device through another authorised member; local unpublished work whose key material is irrecoverable may be lost, and the UI must say so before any reset.

Each project has its own symmetric key, distributed as **one HPKE envelope per authorised device**. Convex stores those envelopes and never the bare key. An authorised device creates the new device's envelope after verifying its signed exchange key; once published, the recipient can enrol without the inviter remaining online.

Invites are time-limited and, where possible, single-use.

**Revocation.** A new key is generated, re-wrapped for the remaining devices, and used for new writes only. Devices still authorised keep retired keys **read-only, protected on disk**. A retired key may only be destroyed once every head of its epoch has been absorbed into a checkpoint re-encrypted under the current key, or after the owner explicitly discards every remaining stale head of that epoch with the destructive warning above.

Rotation protects the future only. A removed member keeps everything already received locally. This is irreducible in a local-first design.

**Access control is server-side, not key-based.** A revoked device may still hold a valid Better Auth session, so the head-write mutation must verify `projectMembers` on every call. Possession of a key is not authorisation.

**Read-only** is enforced on both paths: Convex rejects writes from a member without the write role, and every Rust peer rejects a direct device-signed update whose locally cached membership role is not writer. That is real applicative control for a trusted group. It is not resistance to a byzantine collaborator who already holds the project key. And a reader holding the project key **reads everything, permanently**: read-only bounds writing, never reading. No CRDT can express a reader who cannot decrypt.

Authorisation to connect lives in the EndpointId. iroh verifies the remote public key at accept time:

```
if remoteEndpointId ∉ local allowlist → refuse before any exchange
```

The allowlist is derived from Convex but stored locally, default closed, so an unavailable Convex neither opens nor breaks anything.

Key substitution by a compromised Convex deployment is mitigated by **TOFU**: the key is pinned at first pairing and any change raises a loud alert. A short verification code compared out of band is an optional hardening.

## 7. Source of truth and migration

For a collaborative project: Loro is the only source. SQLite/JSON stores its snapshot. `BoardItem[]` becomes a projection. `.netsu` exports from Loro. Autosave persists the Loro document.

Only **solo → collaborative** conversion exists. A project is never maintained as a modifiable solo version and a modifiable collaborative version at the same time.

## 8. Sizing

Document size is **not** assumed to be a few tens of kilobytes. The ephemeral/committed split reduces operation count sharply, but drawings can carry very many points and text history grows. Measure separately:

current state size, history size, full checkpoint size, head sizes, stroke contribution, and import/export time.

These measurements decide when shallow snapshots become necessary. Nothing else does.

## 9. Network and cost

Convex carries no original media and no live traffic. Its egress still includes encrypted checkpoints, large heads stored as files, optional thumbnails and existing outbound application traffic such as bug-report relay. Beta telemetry must measure each category separately; the dominant category is not assumed in advance.

The real cost is the **iroh relay**. When a direct connection cannot be established, all media traffic is relayed. Public n0 relays are free but rate-limited, development-grade, and carry no uptime guarantee; a dedicated cloud relay is billed by the hour and is expensive under continuous operation.

No fixed direct-connection rate is assumed. During beta, measure the share of relayed traffic and, above all, the **relayed video volume**, then decide between a dedicated relay and self-hosting.

A Windows Defender inbound rule is **not** shipped preemptively: iroh degrades to relay behind a firewall that blocks inbound UDP. The rule is judged on the share of direct connections it actually gains, measured on a clean Windows install, with CGNAT and corporate VPN cases included. The question is cost and throughput, not connectivity.

## 10. Implementation order

1. Specification of document ownership and the security model.
2. Persistent device identity.
3. Allowlist and iroh authentication.
4. Direct connection and `iroh-blobs` transfer test.
5. Local Loro model and solo → collaborative conversion.
6. Cryptographic profile, DPAPI key ring, key distribution and rotation.
7. Direct live synchronisation.
8. Convex checkpoint and heads with CAS.
9. Media, cached thumbnails, resumable transfers.
10. Direct versus relayed traffic measurement.

## 11. Test matrix

No scenario may lose a published operation except an explicit, audited owner decision to discard an unabsorbed stale head after the destructive warning.

- Two devices edit offline, then publish two heads.
- Two compactors start simultaneously.
- A head changes during compaction.
- The compactor produces local work during compaction.
- A device returns after several checkpoint changes.
- Network failure between upload and CAS.
- Old checkpoint file correctly cleaned up.
- Crash before and after the Convex upload.
- Idempotent republication of the same `(projectId, deviceId, seq, hash)`.
- Old head decrypted after key rotation.
- New device without the retired key.
- Stale head retained after 30 days with no automatic data loss.
- Explicit owner discard of a stale head, with audit record and destructive warning.
- Key retirement blocked by an unreachable device, then unblocked by absorption or explicit stale-head discard.
- Two windows editing the same project simultaneously.
- `.netsu` export during an edit.
- BLAKE3 blob imported by Node with no concurrent write.
- Compromised renderer sending an invalid operation, rejected by Rust.
- Read-only or revoked member rejected on both direct iroh and every Convex write path.
- Corrupt DPAPI key ring produces a visible recovery flow and never a silent identity reset.
- Concurrent delete and move leaves the item tombstoned and absent from projection.
- Unknown schema and operation versions are rejected without rewriting the document.
- Update large enough to prove no JSON event is used.
- Blob GC versus time travel: a collected media shows a placeholder, never a crash or a silent empty frame.
- Sessions with 2, then 5, then 10 collaborators.

## 12. Remaining measured decisions

- **Stroke encoding format.** It must be versioned, deterministic and decoded identically by Rust and TypeScript. Select it through a compatibility prototype before implementing collaborative drawing.
- **Document/file threshold.** Start with a conservative 768 KiB maximum measured with Convex's size calculation, leaving room below the 1 MiB document limit; confirm or lower it from real encrypted-head measurements. Larger heads use file storage.

Version vectors remain encrypted. A device caches the checkpoint vector locally to compute its delta; Convex does not inspect CRDT causality.

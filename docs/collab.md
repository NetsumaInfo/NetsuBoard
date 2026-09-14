# Collaboration

**Implementation status:** complete in source, statically verified, not yet validated in a live
two-machine session. Native changes require a Tauri window restart before the running application can
exercise them.

NetsuBoard supports local-first shared boards for **2 to 15 members**. Members can edit the complete
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

Sharing a file-backed board converts it into a library scene; the `.netsu` stays on disk as a frozen
export. The file's recents entry is linked to that scene (`sourceSceneId`), and the home screen hides
the file card while the linked scene is collaborative — otherwise the board shows twice with nothing
relating the two cards, and the file card is the wrong one to edit. Leaving or deleting the project
removes the scene and the file card returns.

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

### Renderer bridge

The Zustand board is a render cache; the Loro document is authoritative. Four rules keep the two from
fighting each other, and breaking any of them makes the board unusable rather than merely wrong:

- **Local edits are coalesced.** The device-local performance profile batches board mutations over a
  60 ms (Live), 200 ms (Balanced), or 900 ms (Economy) window, and each window leaves as one
  operation batch. One batch per pointer frame saturates the outbox and the publication debounce.
  Live and Balanced resolve original media ahead of time; Economy resolves originals when a visible
  card requests them, so one slower device does not change another member's cadence.
- **A local apply never triggers a projection reload.** The native side announces every apply,
  including this window's own; the announcement carrying the revision the local apply just returned
  is consumed, not acted on. Rebuilding the board from the document mid-gesture destroys the item
  objects the gesture holds.
- **A projection never touches selection beyond dead references.** Selection, edit target, crop
  target, and shape selection belong to the user; only ids that no longer exist are dropped. A
  projection that arrives while a local batch is pending is held until the batch has left, then
  re-read.
- **A pending batch belongs to the project the board was on.** Leaving a shared board — home
  screen, another scene, a solo board — replaces the renderer's items in the same store. Diffing
  those against what the project last sent produces a deletion of the entire document, so a batch
  whose project is no longer the board's project is dropped instead of sent.
- **Stacking is diffed on `z`, not on array position.** Bring-to-front rewrites `z` and leaves the
  array untouched; the document order is the render order, and the projection numbers `z` from it.
- **The projection rebuilds a display address, it does not only forward one.** A hashed media is
  addressed through the native protocol, which the renderer cannot compute; everything else follows
  the board's ordinary rule — a YouTube item plays its id, an embed card its rebuilt iframe URL.
  Forwarding only the hashed case left those two arriving with an empty `src`: no playback, no loop
  and no in/out at the recipient, while the document itself carried all three. Previous and local
  media variants take the same path.
- **A shared media carries its declared type.** Addressing by fingerprint drops the file extension,
  so the type stated by the document is the only thing left that identifies an animated image; the
  freeze control needs it to stop a shared GIF the way it stops a local one. The type also decides
  how the media protocol answers a request with no `Range`: only a video or audio blob is capped at
  a first chunk, because only those ask for the rest. An `<img>` issues one plain request and takes
  whatever body it gets for the whole file, so an image above the cap arrived truncated — broken or
  frozen on its first rows, with no error anywhere.
- **A stroke holds no editable field, so editing one is a delete plus an add on the same id.** The
  document keeps a tombstone rather than removing the entry, so the add must be allowed to revive
  it; refusing every id already present rejected the whole batch, which is how any change to an
  existing pen stroke on a shared board silently failed and left the toolbar stuck on "sync
  pending". A LIVE id is still refused — that one is a genuine collision.
- **`collab:<hash>` is not a path, and no feature may hand it to the core.** The Node service only
  knows files on disk; a shared media exists only as bytes in the blob store. Palette extraction is
  the worked example: its file route is skipped for such a ref, and the pixels are read over the
  native blob protocol, which does grant CORS to the renderer's own origin — the on-screen element
  is loaded without `crossOrigin` and taints the canvas, so that protocol is the only readable
  route. Any feature that resolves a ref against the disk needs the same guard (`isCoreFileRef`),
  and a feature that cannot work on a shared media must be withheld at its ENTRY POINT rather than
  refused at the bottom of its chain — an upscale offered, configured, then rejected is worse than
  one not offered.
- **One registry answers "where is this shared media", for display and for the disk.** The
  projection names a display address for each item's own media, but not for what it does not
  enumerate — a sequence's frames, the strip under the player, the off-DOM renderer behind image
  and SVG export, the clipboard. Those read `displaySrc`, which resolves a `collab:` ref through
  `lib/collab/currentProject.ts`; before it did, every one of them silently produced blank frames,
  a tainted canvas, or an export that failed whole. The same registry hands the core real file
  paths when a shared board is exported to a `.netsu`, which otherwise wrote a document made
  entirely of "relocate" placeholders while reporting success. A media still travelling has no
  path: its item is passed through untouched, so the core reports it missing — recoverable —
  rather than silently emptied.

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
lowercase BLAKE3 hash, safe display name, MIME type, and byte length — and may carry the hash and
size of a small JPEG preview (2 MiB cap, refused without a hashed original), rendered by the owner's
ffmpeg thumbnailer at import and stored as its own blob. Remote links, embeds, and YouTube items
synchronize their URL/id metadata and are fetched independently.

Local bytes live in Rust's separate `collab/blobs` store. Import is authorized by a random 256-bit,
one-use, fifteen-minute grant created only by the native file picker or a trusted WebView2 OS drop.
The recovery path for an already saved scene accepts only a canonical regular file found in that scene
or the application-owned reference asset directory. Canonicalization occurs before confinement and
rejects links. Images are capped at 2 GiB and videos at 256 GiB. That check reads the scene **as
stored**, so the board is written to the scene library immediately before a project is created;
otherwise a file the board displays but the saved scene does not yet mention is refused.

A collaborative scene stores no items — the document is authoritative — so it stores the durable
locators of the board's local media beside them, and the grant check reads that list too. Without it
a shared board can never accept another local file: the stored scene mentions nothing. The list is
rewritten before every batch leaves, so a file dropped on the board is authorised by the time its
bytes are asked for.

Before any of that, dead paths are healed. A library scene keeps absolute paths, so a companion
folder that moved or was emptied leaves references to files that no longer exist — while the bytes
usually still live elsewhere, and the file name carries their content fingerprint (`<slug>-<md5:12>`
from adoption, `<md5>` in the asset store). The core relocates by name alone — the open project's
companion folder first, then the asset store, then every known project's companion — reading zero
bytes; the import recomputes the true content hash anyway, so a name collision can at worst expose
another of the user's own media, never corrupt a document. The board heals on scene open and again
right before sharing (so the stored scene, the one grants are checked against, only knows living
paths), and a failed import retries once at the relocated address. Right before sharing, a path that
stays dead but keeps its online origin is re-downloaded from it (the typical case: media grabbed
from a website, companion folder gone since), and whatever remains dead after that is marked missing
on the board so the recovery gestures — folder relocation in particular — take over.

A media that still cannot be read stops the publication with a localized message naming the files;
the wall of absolute paths and OS errors is gone. The document carries a
hash, a remote URL or a YouTube id and nothing else, so an item whose import failed would enter the
shared board stripped of its media, for everyone including its author. During editing the same failure
is not fatal: the diff refuses to emit the manifest or sequence operation that would clear the media,
the document keeps what it already holds, and the unreadable files are reported instead.

Transfers are requested on demand over the project-authorized iroh connection. One connection
carries the whole media: chunks are requested over successive streams on it, each bounded by its
own timeout. They resume from the partial length, use 4 MiB chunks with per-chunk BLAKE3
verification, enforce the declared final size, then verify the full hash before atomic promotion. HTTP range playback is served only through
`http://collab.localhost/<project>/<hash>` after the active native lease proves the project is open
and its document references that hash. The protocol rejects non-Tauri/non-development browser
origins and never emits wildcard CORS.

A `collab:<hash>` locator is served by the shell's own protocol and is **neither a remote link nor a
file the core service can open**. Any board code asking "is this local?" must exclude it
(`isCoreFileRef`): handing it to the core yields a dead address, which the local retry reads as a
disappeared file, which marks the item missing, which sends the auto-recovery to re-download its
source page. Cutting a trimmed clip, building a still, extracting frames and upscaling all stay
unavailable on a shared media, and its bytes are refreshed by the collaborative resolver alone.

The board projection appears before media downloads, and it carries the set of content hashes whose
bytes are already in the local blob store: the renderer paints a placeholder for anything absent
instead of pointing an element at a blob URL that would 404 (one media error per element on a fresh
join). Previews resolve in a batch of their own (four at a time) before any original, so an image
paints low-res within one small transfer while the heavy file follows; a video keeps its placeholder
until poster support exists. Originals resolve images first, then the rest by ascending size, two at
a time — one on machines with four cores or fewer, whose disk, CPU, and decoder saturate together —
and each media repaints as its bytes land. A video original therefore does not block notes, links,
geometry, or other collaborators.
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
the Discord friend list. The authenticated Discord `/users/@me` response synchronizes the account's
stable numeric Discord id and current normalized Discord username into optional, exact profile
indexes; the renderer cannot claim either value. A friend request accepts that Discord id, that
username, or the existing NetsuBoard handle. It performs bounded exact index reads, deduplicates one
account found through multiple keys, and fails closed when distinct accounts match. Existing profiles
gain the Discord fields on their next authenticated app start, with no table scan or prefix search.
Profiles, friends, pending requests, projects, and invitations are bounded.
Only friends may be invited. Invitations expire after seven days, reserve one of fifteen seats, and grant
editor or viewer—not owner.

Project creation is transactional at product level: Convex metadata is created, Rust opens the local
document, imports existing board items and assets, then forces the initial encrypted checkpoint. The
scene becomes collaborative only after that checkpoint and the owner envelope are recoverable. A
failure before this boundary calls the empty-project rollback.

The toolbar of a shared board carries a status pill: who is there, and what is still owed. Presence
is what this machine has OBSERVED — the last time it successfully exchanged with one of that
person's devices — never a claim received from them. Nothing is broadcast for it and no extra
traffic is created, since those exchanges happen anyway; a person is shown by their most recently
reached device, so someone working on a laptop is present even with their desktop off. Beyond 90
seconds the panel stops saying "online" and says when they were last seen, because "offline" is
something this machine cannot honestly assert: an unreachable peer may simply be unreachable from
here. The same panel names what is pending and who can clear it — queued edits, a key rotation, a
member still waiting for the key. "Everything is in sync" is claimed only when someone could
actually have received: with nobody reachable the work is waiting here whatever the local outbox
says, and saying otherwise let the user believe the others already had their edits.

On the home screen, a shared board's card carries that state itself: the "Shared" badge turns amber
and names in one or two words what the board is waiting for — key, media, or a change made while
away. Only invitations, which need a real decision, still appear as a floating card. A notice with
no matching local scene has nowhere to land and stays in Account settings, which keeps the durable
copy.

Convex keeps one consolidated activity row per recipient/project. Repeat edits by the same actor do
not cause repeat inbox writes until the row is cleared; another actor is added to the same row. On the
next authenticated launch, the app shows a transient localized toast unless that project is already
open, and keeps the durable message in Account settings until dismissed. Media requests use the same
row with distinct wording that asks a holder to open the scene and remain online.

Invitations and activity also surface as pop-up cards on the home screen — join, decline, or later
(snoozed for the session; Account settings keeps the durable copy). Joining from the card creates the
linked scene (never a duplicate) and opens the board directly. An activity card appears only for a
project whose linked scene exists locally, since opening it is the answer; the collaboration dialog
additionally shows the sync line — queued edits leave on their own as soon as a device is reachable,
nobody sends anything by hand.

Accepting an invitation marks the same row as key-provisioning-needed for existing writers. An
already-running app reacts to that single backend change by refreshing its native roster and wrapping
the current project key for every missing proved device; there is no project polling loop.

Accepting creates at most one local scene per project — a re-invitation (after a leave, or a stale
invite from an old build) never mints a second identical board on the home screen. The account
settings list names each project by its linked scene, or by its creation date when no scene links it,
and offers delete (owner) or leave (member) directly on the row: a project an old build left behind
has no scene to open, so the board dialog could never reach it. Deleting or leaving also removes the
linked scene, and resets the open board if it was projecting that very document. Projects with no
scene on this machine are collapsed behind one count line — expanding gives each its add and delete
controls — and a row only mentions the role when it is not owner, and the rotation when pending.

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

Automated acceptance covers 2–15-replica convergence across the full board contract, Unicode edits,
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

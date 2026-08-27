# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security flaw.**

Use one of these two private channels instead:

- the **Security ▸ Report a vulnerability** tab of the GitHub repository (*private vulnerability
  reporting*);
- a private message to the maintainer from the [NetsumaInfo GitHub profile](https://github.com/NetsumaInfo).

A useful report states what is affected, how to reproduce it, the impact you estimate, and your
NetsuBoard and Windows versions.

Expect a few days for a first reply. The fix ships before the detailed description of the flaw, and
you are credited if you want to be.

## Scope

NetsuBoard is a desktop application running on the user's machine. The areas that matter most:

- the **core service** (HTTP/SSE on `127.0.0.1`, on a free port picked at launch): it only listens
  on the loopback interface; RPC/SSE/health require a loopback Host and a Tauri or loopback renderer
  Origin, and RPC additionally requires bounded JSON. Its channels run ffmpeg and `yt-dlp`;
- the **media routes** (`/media`, `/stream`): arbitrary file reads, path traversal. They carry no
  CORS header on purpose — a third-party page in a browser must not be able to read their content —
  and are gated by a local token (`mediaGuard`);
- the **YouTube relay** (`/ytstream`): URLs resolved by `yt-dlp` from user-supplied input;
- the **`.netsu` container**: a project file is a SQLite database with embedded media, opened from
  disk or from a drop, so it is untrusted input;
- the **bug reporter**: masking of paths, e-mails and tokens before sending.
- the **native collaboration service** (`src-tauri/src/collab/`): Loro parsing, SQLite durability,
  DPAPI-protected identities and project keys, authenticated Convex calls, role enforcement, key
  rotation, checkpoint/head verification and compaction;
- the **iroh protocols**: authenticated EndpointIds, project-scoped writer rosters, signed document
  frames, bounded QUIC exchanges, and resumable hash-verified media chunks;
- the **Convex collaboration functions**: invitations, membership, device-registration proofs,
  encrypted recovery payloads, file-upload ownership receipts, consolidated inbox rows, media
  requests, and a bounded administrative audit trail. Cross-project access, role bypass, or
  arbitrary storage deletion are in scope;
- the **collaborative media boundary**: native one-use import grants, canonical path confinement,
  BLAKE3 manifests, the `collab` URI scheme, partial-file cleanup, and retention pins.

**Out of scope**:

- vulnerabilities in ffmpeg, mpv, `yt-dlp` or any upstream dependency — report those to their
  vendor;
- anything requiring physical or administrator access already obtained on the machine;
- the NetsuRush code still present in the tree but unreachable from the application (timeline
  transfer, voice, roto). Report a flaw there to
  [NetsuRush](https://github.com/NetsumaInfo/NetsuRush) instead.

## Supported versions

Only the latest published release receives security fixes. NetsuBoard is in beta: earlier branches
are not maintained.

## Secrets

No secret belongs in the repository. NetsuBoard ships public Convex deployment URLs but no backend
credentials. Better Auth and Discord secrets and the production bug-report webhook live in Convex
environment variables. A development-only direct webhook may live in `nr.config.json` under
`NR_HOME` (`%LOCALAPPDATA%\NetsuBoard` by default) or in `NR_BUG_WEBHOOK`—never in the bundle.
`.env.local` is Git-ignored and `.env.example` holds public/example values only.

The collaboration device identity and project key ring are local secrets protected with Windows
DPAPI for the current account. They must never be copied into logs, renderer storage, reports, or
Convex. Convex stores only per-device wrapped project keys and sealed board recovery payloads.

The repository-specific threat model is [`NetsuBoard-threat-model.md`](NetsuBoard-threat-model.md).

If you find an exposed secret in the history, report it privately rather than opening an issue.

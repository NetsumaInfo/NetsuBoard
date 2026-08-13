# Inherited NetsuRush documentation

NetsuBoard was split out of [NetsuRush](https://github.com/NetsumaInfo/NetsuRush). The split is not
finished: the working tree still carries NetsuRush modules that the application never reaches.

**Nothing in this folder describes NetsuBoard.** These files document inherited code, inherited
research, or features that were never part of the board. They are kept because the code they
describe is still physically present in `core/`, `test/` and `src-tauri/resources/`, and deleting
the notes before the code would leave that code unreadable.

| File | What it documents | Code still in the tree |
|---|---|---|
| `host-bridges.md` | Adobe CEP panel, timeline transfer between hosts | `core/adobe*.js`, `core/transfer/`, `core/ae/`, `src-tauri/resources/adobe-cep/` |
| `timeline-transfer-research.md` | Research log for host-to-host timeline transfer | same as above |
| `ai-agent-mcp.md` | AI copilot and MCP servers | `core/agent/` |
| `search-siglip2.md` | Semantic shot search | `core/search*.js` |
| `transcription.md` | Speech-to-text engines | `core/voice*.js`, `core/asrCpp.js` |
| `model-venv-families.md` | Python ML environment families | `core/venvs.js`, `core/models.js` |
| `the-anime-scripter-models.md` | ML model inventory | `core/models.js` |
| `auth-setup.md` | Convex + Better Auth + Discord sign-in | `src/components/auth/` (inactive without `VITE_CONVEX_URL`; the `netsurush://` deep link it depends on is **no longer registered** by the Rust shell) |
| `community-hub.md` | Phase-2 community design, never built | none |
| `p2p-sharing-iroh.md` | Iroh peer-to-peer sharing research, never built | none |

Do not extend any of this from NetsuBoard. When a module is removed from the tree, remove its file
here in the same change.

//! Collaborative projects (`docs/collab.md`).
//!
//! The Rust side is the single authority for collaborative state: it will own the Loro document,
//! the iroh endpoint and every secret. Renderers hold read-only replicas and never see key material.
//!
//! Implemented so far: the persistent device identity and the peer-to-peer endpoint that is built
//! from it. The Loro document and the media store come next.

pub mod blobs;
pub mod crypto;
pub mod device;
pub mod doc;
pub mod error;
pub mod identity;
pub mod ids;
pub mod net;
pub mod ops;
pub mod outbox;
pub mod store;

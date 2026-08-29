//! Wire-level types and conversions for the snapshot/delta envelope.
//!
//! task-054: the snapshot payload is no longer a `AIGB` placeholder. It is a
//! `WorldSnapshotBodyProto` (full snapshot) or `WorldSnapshotDeltaProto`
//! (delta), both defined in `protocol/v1/aigent.proto` and generated through
//! `aigent_protocol`.
//!
//! The Rust types here are the canonical in-server form: they hold a
//! `prost::Message` so encode/decode is one call. Conversion from the
//! authoritative entity store ([`crate::entity::EntitySnapshot`]) into the
//! wire form is `PartialEq`-stable, so a same-build round trip is bit-identical
//! for the same store state. That property is what the shared
//! Rust+TypeScript fixture relies on.

pub mod snapshot;

#[allow(unused_imports)] // Call-sites in fanout.rs/transport.rs land in this commit.
pub use snapshot::{
    encode_world_snapshot_body, encode_world_snapshot_delta, metres_to_mm_i64, RealEntityRecord,
    WorldSnapshotBody, WorldSnapshotDelta, BODY_VERSION, DELTA_VERSION,
};

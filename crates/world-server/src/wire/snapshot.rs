//! Server-side wire body and delta for [`aigent_protocol::FullSnapshot`] /
//!
//! task-054: the snapshot payload is no longer the `AIGB` placeholder. It is a
//! [`aigent_protocol::WorldSnapshotBodyProto`] (full snapshot) or
//! [`aigent_protocol::WorldSnapshotDeltaProto`] (delta), both defined in
//! `protocol/v1/aigent.proto` and generated through `aigent_protocol`.
//!
//! The Rust types here are the canonical in-server form: they hold a
//! `prost::Message` so encode/decode is one call. Conversion from the
//! authoritative entity store ([`crate::entity::EntitySnapshot`]) into the
//! wire form is `PartialEq`-stable, so a same-build round trip is bit-identical
//! for the same store state. That property is what the shared
//! Rust+TypeScript fixture relies on.
//!
//! Position is carried in `sint64` millimetres (canonical fixed-point, see
//! `world/v1/CONTRACT.md` §3.1 and `protocol/v1/CONTRACT.md`). Half-to-even
//! rounding maps a canonical metre `f64` into an `i64`; the same conversion
//! runs on the decoder side so a same-build round trip is exact for every
//! axis whose millimetre value is representable in `i64`. World bounds
//! (`±100 km`) keep every value well inside `i64`, so a valid [`Position`]
//! always converts.

use crate::entity::{EntitySnapshot, Position, ShapeSlot};
use crate::lease::LeaseSnapshot;
use crate::movement::MoveIntent;
use aigent_protocol::{
    MoveAim, RealEntityRecord as RealEntityRecordProto, ShapeTree, Vector3Millimeters,
    WorldSnapshotBodyProto, WorldSnapshotDeltaProto,
};
use prost::Message as ProstMessage;

/// Wire format version of [`WorldSnapshotBodyProto`].
pub const BODY_VERSION: u32 = 1;

/// Wire format version of [`WorldSnapshotDeltaProto`].
pub const DELTA_VERSION: u32 = 1;

/// In-server canonical record for one real entity.
///
/// Equal to the entity-store snapshot, with the opaque `ShapeSlot` decoded into
/// a [`ShapeTree`] and the canonical `Position` projected into
/// `sint64` millimetres. A corrupt shape returns a typed encoding failure.
///
/// `Eq` is not derived because the embedded `ShapeTree` carries `f64` rotations
/// and the `prost` generated type is only `PartialEq`. The structural equality
/// we need is therefore `PartialEq`, which matches the proto wire form.
#[derive(Debug, Clone, PartialEq)]
pub struct RealEntityRecord {
    pub entity_id: u64,
    pub revision: u64,
    pub position_mm: (i64, i64, i64),
    pub shape: Option<ShapeTree>,
    pub aim: Option<MoveAim>,
}

/// Failure to turn authoritative entity state into a complete wire record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SnapshotEncodeError {
    pub entity_id: u64,
    pub cause: String,
}

impl std::fmt::Display for SnapshotEncodeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "entity {} shape: {}", self.entity_id, self.cause)
    }
}

impl std::error::Error for SnapshotEncodeError {}

impl RealEntityRecord {
    /// Build a complete record, or return the corrupt authoritative entity.
    pub fn from_snapshot(snapshot: &EntitySnapshot) -> Result<Self, SnapshotEncodeError> {
        Self::from_snapshot_with_lease(snapshot, None)
    }

    /// Project physical intent from the lease frozen with this entity's generation.
    pub fn from_snapshot_with_lease(
        snapshot: &EntitySnapshot,
        lease: Option<&LeaseSnapshot>,
    ) -> Result<Self, SnapshotEncodeError> {
        let aim = lease.map(|lease| MoveAim {
            target_x_mm: lease.target_x_mm,
            target_z_mm: lease.target_z_mm,
            speed_mm_per_s: lease.speed_mm_per_s,
        });
        if lease.is_some_and(|lease| lease.body_id != snapshot.entity_id)
            || aim.as_ref().is_some_and(|aim| !valid_aim(aim))
        {
            return Err(SnapshotEncodeError {
                entity_id: snapshot.entity_id,
                cause: "invalid same-entity movement aim".into(),
            });
        }
        let shape = snapshot
            .shape
            .as_ref()
            .map(decode_shape_slot)
            .transpose()
            .map_err(|cause| SnapshotEncodeError {
                entity_id: snapshot.entity_id,
                cause,
            })?;
        Ok(Self {
            entity_id: snapshot.entity_id,
            revision: snapshot.revision,
            position_mm: position_to_mm(snapshot.position),
            shape,
            aim,
        })
    }
}

/// A full-snapshot body: every authoritative entity in the connection's
/// interest set, in AOI rank order (nearest-first, ties by ascending
/// `entity_id`); the server builds the wire list from the output of
/// [`crate::aoi::truncate_nearest`].
#[derive(Debug, Clone, PartialEq)]
pub struct WorldSnapshotBody {
    pub tick: u64,
    pub generation_digest: [u8; 32],
    pub bodies: Vec<RealEntityRecord>,
    pub self_body_id: Option<u64>,
}

impl WorldSnapshotBody {
    #[must_use]
    pub fn encode(&self) -> WorldSnapshotBodyProto {
        WorldSnapshotBodyProto {
            version: BODY_VERSION,
            tick: self.tick,
            generation_digest: self.generation_digest.to_vec(),
            bodies: self.bodies.iter().map(record_to_proto).collect(),
            self_body_id: self.self_body_id,
        }
    }

    #[must_use]
    pub fn decode(proto: &WorldSnapshotBodyProto) -> Option<Self> {
        if proto.version != BODY_VERSION || proto.self_body_id == Some(0) {
            return None;
        }
        let generation_digest = <[u8; 32]>::try_from(proto.generation_digest.as_slice()).ok()?;
        let bodies = proto
            .bodies
            .iter()
            .map(record_from_proto)
            .collect::<Option<Vec<_>>>()?;
        Some(Self {
            tick: proto.tick,
            generation_digest,
            bodies,
            self_body_id: proto.self_body_id,
        })
    }
}

/// A delta body: explicit `entered`, `modified`, and `left_ids`.
#[derive(Debug, Clone, PartialEq)]
pub struct WorldSnapshotDelta {
    pub generation_digest: [u8; 32],
    pub entered: Vec<RealEntityRecord>,
    pub modified: Vec<RealEntityRecord>,
    pub left_ids: Vec<u64>,
    pub self_body_id: Option<u64>,
}

impl WorldSnapshotDelta {
    #[must_use]
    pub fn encode(&self) -> WorldSnapshotDeltaProto {
        WorldSnapshotDeltaProto {
            version: DELTA_VERSION,
            generation_digest: self.generation_digest.to_vec(),
            entered: self.entered.iter().map(record_to_proto).collect(),
            modified: self.modified.iter().map(record_to_proto).collect(),
            left_ids: self.left_ids.clone(),
            self_body_id: self.self_body_id,
        }
    }

    #[must_use]
    pub fn decode(proto: &WorldSnapshotDeltaProto) -> Option<Self> {
        if proto.version != DELTA_VERSION || proto.self_body_id == Some(0) {
            return None;
        }
        let generation_digest = <[u8; 32]>::try_from(proto.generation_digest.as_slice()).ok()?;
        let entered = proto
            .entered
            .iter()
            .map(record_from_proto)
            .collect::<Option<Vec<_>>>()?;
        let modified = proto
            .modified
            .iter()
            .map(record_from_proto)
            .collect::<Option<Vec<_>>>()?;
        let left_ids = proto.left_ids.clone();
        Some(Self {
            generation_digest,
            entered,
            modified,
            left_ids,
            self_body_id: proto.self_body_id,
        })
    }
}

#[must_use]
pub fn encode_world_snapshot_body(body: &WorldSnapshotBody) -> Vec<u8> {
    body.encode().encode_to_vec()
}

#[must_use]
pub fn encode_world_snapshot_delta(delta: &WorldSnapshotDelta) -> Vec<u8> {
    delta.encode().encode_to_vec()
}

#[must_use]
pub fn metres_to_mm_i64(metres: f64) -> i64 {
    debug_assert!(metres.is_finite(), "Position is invariant-validated");
    half_to_even_i64(metres * 1000.0)
}

fn position_to_mm(position: Position) -> (i64, i64, i64) {
    (
        metres_to_mm_i64(position.x()),
        metres_to_mm_i64(position.y()),
        metres_to_mm_i64(position.z()),
    )
}

fn record_to_proto(record: &RealEntityRecord) -> RealEntityRecordProto {
    let (x_mm, y_mm, z_mm) = record.position_mm;
    RealEntityRecordProto {
        entity_id: record.entity_id,
        revision: record.revision,
        position_mm: Some(Vector3Millimeters { x_mm, y_mm, z_mm }),
        shape: record.shape.clone(),
        aim: record.aim,
    }
}

fn record_from_proto(proto: &RealEntityRecordProto) -> Option<RealEntityRecord> {
    if proto.aim.as_ref().is_some_and(|aim| !valid_aim(aim)) {
        return None;
    }
    let position_mm = proto
        .position_mm
        .as_ref()
        .map_or((0, 0, 0), |v| (v.x_mm, v.y_mm, v.z_mm));
    Some(RealEntityRecord {
        entity_id: proto.entity_id,
        revision: proto.revision,
        position_mm,
        shape: proto.shape.clone(),
        aim: proto.aim,
    })
}

fn valid_aim(aim: &MoveAim) -> bool {
    MoveIntent::new(aim.target_x_mm, aim.target_z_mm, aim.speed_mm_per_s).is_ok()
}

fn decode_shape_slot(slot: &ShapeSlot) -> Result<ShapeTree, String> {
    if slot.is_empty() {
        return Err("empty slot".to_string());
    }
    ShapeTree::decode(slot.as_bytes()).map_err(|e| format!("prost decode: {e}"))
}

/// IEEE-754 round-to-nearest, ties to even (`banker's rounding`).
///
/// Implemented manually because Rust's stable `f64::round` rounds half
/// away from zero, not half to even. The two sides of the wire must agree:
/// the encoder (Rust) and the decoder (TypeScript) both apply this rule so
/// a same-build round trip on a millimetre value is exact.
#[must_use]
pub fn half_to_even_i64(value: f64) -> i64 {
    debug_assert!(value.is_finite());
    let truncated = value.trunc();
    let diff = value - truncated;
    let truncated_i = truncated as i64;
    if diff > 0.5 {
        truncated_i + 1
    } else if diff < -0.5 {
        truncated_i - 1
    } else if diff == 0.5 || diff == -0.5 {
        // Exact half: round to the even neighbour.
        if truncated_i.rem_euclid(2) == 0 {
            truncated_i
        } else if value > 0.0 {
            truncated_i + 1
        } else {
            truncated_i - 1
        }
    } else {
        truncated_i
    }
}

/// Test-only helper: decode the wire bytes of a `WorldSnapshotBodyProto` and
/// return the entity ids of every body, in the order the wire carries them.
///
/// Used by the integration tests that want to assert the bodies that arrived
/// without having to construct the full protobuf.
pub fn decode_world_snapshot_body_ids(bytes: &[u8]) -> Option<Vec<u64>> {
    let proto = WorldSnapshotBodyProto::decode(bytes).ok()?;
    if proto.version != BODY_VERSION {
        return None;
    }
    Some(proto.bodies.iter().map(|b| b.entity_id).collect())
}

/// Test-only helper: decode a `WorldSnapshotDeltaProto` and return the
/// explicit `left_ids` list.
pub fn decode_world_snapshot_delta_left_ids(bytes: &[u8]) -> Option<Vec<u64>> {
    let proto = WorldSnapshotDeltaProto::decode(bytes).ok()?;
    if proto.version != DELTA_VERSION {
        return None;
    }
    Some(proto.left_ids)
}

#[cfg(test)]
fn hex_decode(hex: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(hex.len() / 2);
    let mut iter = hex.iter().copied();
    while let Some(high) = iter.next() {
        let low = iter.next().expect("hex pairs must be complete");
        out.push((hex_nibble(high) << 4) | hex_nibble(low));
    }
    out
}

#[cfg(test)]
fn hex_nibble(b: u8) -> u8 {
    match b {
        b'0'..=b'9' => b - b'0',
        b'a'..=b'f' => b - b'a' + 10,
        b'A'..=b'F' => b - b'A' + 10,
        _ => panic!("invalid hex character: {b}"),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::entity::Position;
    use aigent_protocol::shape_node::Primitive;
    use aigent_protocol::BoxPrimitive;
    use std::fmt::Write;

    fn sample_shape() -> ShapeTree {
        ShapeTree {
            nodes: vec![aigent_protocol::ShapeNode {
                node_id: 1,
                parent_node_id: 0,
                transform: None,
                primitive: Some(Primitive::Box(BoxPrimitive {
                    size_x_mm: 1000,
                    size_y_mm: 1000,
                    size_z_mm: 1000,
                })),
                joint_name: None,
                color: None,
                material_tags: Vec::new(),
            }],
        }
    }

    fn encoded_shape_slot() -> ShapeSlot {
        ShapeSlot::from_encoded(sample_shape().encode_to_vec())
    }

    fn sample_record(entity_id: u64) -> EntitySnapshot {
        EntitySnapshot {
            entity_id,
            revision: 1,
            position: Position::new(1.5, 0.0, -2.25).expect("valid"),
            shape: Some(encoded_shape_slot()),
        }
    }

    #[test]
    fn position_to_mm_is_canonical_and_half_to_even() {
        let position = Position::new(1.5, 0.0, -2.25).expect("valid");
        assert_eq!(position_to_mm(position), (1500, 0, -2250));
    }

    #[test]
    fn half_to_even_rounds_zero_dot_five_down() {
        // Banker's rounding: ties go to the even neighbour.
        assert_eq!(half_to_even_i64(0.5), 0);
        assert_eq!(half_to_even_i64(1.5), 2);
        assert_eq!(half_to_even_i64(2.5), 2);
        assert_eq!(half_to_even_i64(3.5), 4);
        assert_eq!(half_to_even_i64(-0.5), 0);
        assert_eq!(half_to_even_i64(-1.5), -2);
        assert_eq!(half_to_even_i64(-2.5), -2);
    }

    #[test]
    fn real_entity_record_from_snapshot_decodes_shape() {
        let record =
            RealEntityRecord::from_snapshot(&sample_record(1)).expect("valid entity record");
        assert_eq!(record.entity_id, 1);
        assert_eq!(record.position_mm, (1500, 0, -2250));
        assert!(record.shape.is_some());
    }

    #[test]
    fn real_entity_record_from_snapshot_keeps_shape_none_when_slot_empty() {
        let snapshot = EntitySnapshot {
            entity_id: 2,
            revision: 0,
            position: Position::origin(),
            shape: None,
        };
        let record = RealEntityRecord::from_snapshot(&snapshot).expect("valid entity record");
        assert_eq!(record.entity_id, 2);
        assert_eq!(record.position_mm, (0, 0, 0));
        assert!(record.shape.is_none());
    }

    #[test]
    fn body_round_trip_is_bit_identical() {
        let body = WorldSnapshotBody {
            self_body_id: None,
            tick: 42,
            generation_digest: [0xAB; 32],
            bodies: vec![
                RealEntityRecord::from_snapshot(&sample_record(1)).expect("valid entity record"),
                RealEntityRecord::from_snapshot(&sample_record(2)).expect("valid entity record"),
            ],
        };
        let bytes = encode_world_snapshot_body(&body);
        let proto = WorldSnapshotBodyProto::decode(bytes.as_slice()).expect("decode");
        let decoded = WorldSnapshotBody::decode(&proto).expect("server-side decode");
        assert_eq!(decoded, body);
    }

    #[test]
    fn delta_round_trip_is_bit_identical() {
        let delta =
            WorldSnapshotDelta {
                self_body_id: None,
                generation_digest: [0xCD; 32],
                entered: vec![RealEntityRecord::from_snapshot(&sample_record(10))
                    .expect("valid entity record")],
                modified: vec![RealEntityRecord::from_snapshot(&sample_record(11))
                    .expect("valid entity record")],
                left_ids: vec![12, 13],
            };
        let bytes = encode_world_snapshot_delta(&delta);
        let proto = WorldSnapshotDeltaProto::decode(bytes.as_slice()).expect("decode");
        let decoded = WorldSnapshotDelta::decode(&proto).expect("server-side decode");
        assert_eq!(decoded, delta);
    }

    #[test]
    fn unknown_body_version_rejects_at_decode() {
        let mut proto = WorldSnapshotBodyProto {
            self_body_id: None,
            version: BODY_VERSION,
            tick: 1,
            generation_digest: vec![0; 32],
            bodies: Vec::new(),
        };
        proto.version = 999;
        assert!(WorldSnapshotBody::decode(&proto).is_none());
    }

    #[test]
    fn unknown_delta_version_rejects_at_decode() {
        let mut proto = WorldSnapshotDeltaProto {
            self_body_id: None,
            version: DELTA_VERSION,
            generation_digest: vec![0; 32],
            entered: Vec::new(),
            modified: Vec::new(),
            left_ids: Vec::new(),
        };
        proto.version = 999;
        assert!(WorldSnapshotDelta::decode(&proto).is_none());
    }
    /// Encode the canonical fixture and compare it byte-for-byte against
    /// the checked-in conformance files. A change in the encoder that
    /// shifts any byte (including a half-to-even change) fails this test
    /// before the on-disk fixture is touched, so the contract is owned
    /// by the committed files and the test only verifies parity.
    #[test]
    fn conformance_fixtures_match_committed_bytes() {
        let body = WorldSnapshotBody {
            self_body_id: None,
            tick: 42,
            generation_digest: [0xAB; 32],
            bodies: vec![
                RealEntityRecord::from_snapshot(&sample_record(1)).expect("valid entity record"),
                RealEntityRecord::from_snapshot(&sample_record(2)).expect("valid entity record"),
            ],
        };
        let body_bytes = encode_world_snapshot_body(&body);
        let delta = WorldSnapshotDelta {
            self_body_id: None,
            generation_digest: [0xCD; 32],
            entered: vec![
                RealEntityRecord::from_snapshot(&sample_record(10)).expect("valid entity record")
            ],
            modified: Vec::new(),
            left_ids: vec![13],
        };
        let delta_bytes = encode_world_snapshot_delta(&delta);
        let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../protocol/v1/conformance/binary");
        let committed_body = std::fs::read(dir.join("world-snapshot-body.hex"))
            .expect("read committed body fixture");
        let committed_delta = std::fs::read(dir.join("world-snapshot-delta.hex"))
            .expect("read committed delta fixture");
        // The committed files store hex; decode and compare.
        let committed_body_bytes = hex_decode(&committed_body);
        let committed_delta_bytes = hex_decode(&committed_delta);
        assert_eq!(
            body_bytes, committed_body_bytes,
            "encoded WorldSnapshotBody does not match the committed fixture;              regenerate with WRITE_CONFORMANCE_FIXTURES=1 if the change is intentional",
        );
        assert_eq!(
            delta_bytes, committed_delta_bytes,
            "encoded WorldSnapshotDelta does not match the committed fixture;              regenerate with WRITE_CONFORMANCE_FIXTURES=1 if the change is intentional",
        );
    }

    /// Opt-in regenerator: only runs when WRITE_CONFORMANCE_FIXTURES=1 is
    /// set in the environment. The default `cargo test` path is the
    /// match-check above, which is read-only against the source tree.
    #[test]
    fn write_conformance_fixtures_opt_in() {
        if std::env::var_os("WRITE_CONFORMANCE_FIXTURES").is_none() {
            // Skip silently; the read-only check above is the real test.
            return;
        }
        let body = WorldSnapshotBody {
            self_body_id: None,
            tick: 42,
            generation_digest: [0xAB; 32],
            bodies: vec![
                RealEntityRecord::from_snapshot(&sample_record(1)).expect("valid entity record"),
                RealEntityRecord::from_snapshot(&sample_record(2)).expect("valid entity record"),
            ],
        };
        let body_bytes = encode_world_snapshot_body(&body);
        let delta = WorldSnapshotDelta {
            self_body_id: None,
            generation_digest: [0xCD; 32],
            entered: vec![
                RealEntityRecord::from_snapshot(&sample_record(10)).expect("valid entity record")
            ],
            modified: Vec::new(),
            left_ids: vec![13],
        };
        let delta_bytes = encode_world_snapshot_delta(&delta);
        let out_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../protocol/v1/conformance/binary");
        std::fs::create_dir_all(&out_dir).expect("create conformance binary dir");
        fn hex(bytes: &[u8]) -> String {
            let mut out = String::with_capacity(bytes.len() * 2);
            for b in bytes {
                let _ = write!(out, "{:02x}", b);
            }
            out
        }
        std::fs::write(out_dir.join("world-snapshot-body.hex"), hex(&body_bytes))
            .expect("write body fixture");
        std::fs::write(out_dir.join("world-snapshot-delta.hex"), hex(&delta_bytes))
            .expect("write delta fixture");
    }
    #[test]
    fn binding_aim_conformance_variants() {
        let mut record = RealEntityRecord::from_snapshot(&sample_record(1)).unwrap();
        record.aim = Some(MoveAim {
            target_x_mm: 1500,
            target_z_mm: -500,
            speed_mm_per_s: 500,
        });
        let body = WorldSnapshotBody {
            tick: 42,
            generation_digest: [0xAB; 32],
            self_body_id: Some(1),
            bodies: vec![
                record.clone(),
                RealEntityRecord::from_snapshot(&sample_record(2)).unwrap(),
            ],
        };
        record.aim.as_mut().unwrap().target_x_mm = 2500;
        let delta = WorldSnapshotDelta {
            generation_digest: [0xCD; 32],
            self_body_id: Some(1),
            entered: vec![],
            modified: vec![record],
            left_ids: vec![2],
        };
        let body_bytes = encode_world_snapshot_body(&body);
        let delta_bytes = encode_world_snapshot_delta(&delta);
        let directory = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../protocol/v1/conformance/binary");
        for (name, bytes) in [
            ("world-snapshot-body-aim.hex", &body_bytes),
            ("world-snapshot-delta-aim.hex", &delta_bytes),
        ] {
            let path = directory.join(name);
            if std::env::var_os("WRITE_BINDING_AIM_FIXTURES").is_some() {
                use std::fmt::Write;
                let mut hex = String::with_capacity(bytes.len() * 2);
                for byte in bytes {
                    write!(hex, "{byte:02x}").unwrap();
                }
                std::fs::write(&path, hex).unwrap();
            }
            assert_eq!(*bytes, hex_decode(&std::fs::read(path).unwrap()));
        }
        assert_eq!(
            WorldSnapshotBody::decode(
                &WorldSnapshotBodyProto::decode(body_bytes.as_slice()).unwrap()
            ),
            Some(body)
        );
        assert_eq!(
            WorldSnapshotDelta::decode(
                &WorldSnapshotDeltaProto::decode(delta_bytes.as_slice()).unwrap()
            ),
            Some(delta)
        );
    }

    #[test]
    fn optional_binding_and_aim_reject_invalid_values() {
        let mut proto = WorldSnapshotBodyProto {
            version: 1,
            tick: 1,
            generation_digest: vec![0; 32],
            bodies: vec![],
            self_body_id: Some(0),
        };
        assert!(WorldSnapshotBody::decode(&proto).is_none());
        let mut delta = WorldSnapshotDeltaProto {
            version: 1,
            generation_digest: vec![0; 32],
            self_body_id: Some(0),
            ..Default::default()
        };
        assert!(WorldSnapshotDelta::decode(&delta).is_none());
        proto.self_body_id = Some(1);
        delta.self_body_id = Some(1);
        for aim in [
            MoveAim {
                target_x_mm: 0,
                target_z_mm: 0,
                speed_mm_per_s: 0,
            },
            MoveAim {
                target_x_mm: 100_000_001,
                target_z_mm: 0,
                speed_mm_per_s: 1,
            },
            MoveAim {
                target_x_mm: 0,
                target_z_mm: -100_000_001,
                speed_mm_per_s: 1,
            },
        ] {
            let mut record =
                record_to_proto(&RealEntityRecord::from_snapshot(&sample_record(1)).unwrap());
            record.aim = Some(aim);
            proto.bodies = vec![record.clone()];
            delta.modified = vec![record];
            assert!(WorldSnapshotBody::decode(&proto).is_none());
            assert!(WorldSnapshotDelta::decode(&delta).is_none());
        }
        let mut lease = LeaseSnapshot {
            body_id: 2,
            aigent_id: b"a".to_vec(),
            sequence: 1,
            granted_tick: 1,
            expire_tick: 201,
            target_x_mm: 0,
            target_z_mm: 0,
            speed_mm_per_s: 500,
            consecutive_no_progress_ticks: 0,
        };
        assert!(
            RealEntityRecord::from_snapshot_with_lease(&sample_record(1), Some(&lease)).is_err()
        );
        lease.body_id = 1;
        assert!(
            RealEntityRecord::from_snapshot_with_lease(&sample_record(1), Some(&lease)).is_ok()
        );
        lease.target_z_mm = 100_000_001;
        assert!(
            RealEntityRecord::from_snapshot_with_lease(&sample_record(1), Some(&lease)).is_err()
        );
    }
}

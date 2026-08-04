//! Stub placeholder body payload encode/decode (task-036).

use world_server::{
    decode_placeholder_payload, encode_placeholder_payload, placeholder_body_from_lease,
    ImmutableGeneration, LeaseSnapshot, StubSnapshotPayload,
};

#[test]
fn placeholder_payload_round_trips_bodies() {
    let lease = LeaseSnapshot {
        body_id: 42,
        aigent_id: b"a".to_vec(),
        sequence: 3,
        granted_tick: 1,
        expire_tick: 200,
    };
    let body = placeholder_body_from_lease(&lease);
    let digest = [7u8; 32];
    let bytes = encode_placeholder_payload(9, &digest, &[body.clone()]);
    let (tick, decoded_digest, bodies) = decode_placeholder_payload(&bytes).unwrap();
    assert_eq!(tick, 9);
    assert_eq!(decoded_digest, digest);
    assert_eq!(bodies, vec![body]);
}

#[test]
fn stub_payload_from_generation_includes_active_leases() {
    let mut leases = std::collections::BTreeMap::new();
    leases.insert(
        7,
        LeaseSnapshot {
            body_id: 7,
            aigent_id: b"agent".to_vec(),
            sequence: 2,
            granted_tick: 1,
            expire_tick: 50,
        },
    );
    let generation = ImmutableGeneration {
        generation: 3,
        tick: 3,
        world_value: 0,
        ruleset_generation_id: 1,
        active_leases: leases,
        applied_commands: vec![],
        expired_leases: vec![],
        rng_draws: vec![],
    };
    let payload = StubSnapshotPayload::from_generation(&generation);
    assert_eq!(payload.bodies.len(), 1);
    assert_eq!(payload.bodies[0].sequence, 2);
    let wire = payload.encode_wire();
    let (_, _, bodies) = decode_placeholder_payload(&wire).unwrap();
    assert_eq!(bodies[0].body_id, 7);
}

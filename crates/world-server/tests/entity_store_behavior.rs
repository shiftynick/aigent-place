//! Authoritative entity state inside the fixed-tick world core (task-046).
//!
//! Every expectation here is derived from ADR-0002 identity/coordinate rules,
//! ADR-0004 terminal revision, and ADR-0005 durable-before-apply ordering — not
//! from whatever the implementation happened to produce. Expected entity tables
//! are constructed independently and compared against the published generation.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Duration;

use world_server::{
    replay_log, CommandEffect, DurableJournal, EntitySnapshot, JournalError, Position,
    PositionRequest, QueuedCommand, ShapeSlot, TickAdvance, World, WorldConfig, FIRST_ENTITY_ID,
    WORLD_BOUND_METRES,
};

fn temp_db(name: &str) -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!(
        "aigent-place-entity-{}-{}-{}.sqlite",
        name,
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time")
            .as_nanos()
    ));
    path
}

fn cmd(arrival_tick: u64, aigent: &[u8], sequence: u64, effect: CommandEffect) -> QueuedCommand {
    QueuedCommand {
        arrival_tick,
        aigent_id: aigent.to_vec(),
        sequence,
        effect,
    }
}

fn create_at(x: f64, y: f64, z: f64) -> CommandEffect {
    CommandEffect::CreateEntity {
        position: PositionRequest::new(x, y, z),
        shape: None,
    }
}

fn move_to(entity_id: u64, x: f64, y: f64, z: f64) -> CommandEffect {
    CommandEffect::SetEntityPosition {
        entity_id,
        position: PositionRequest::new(x, y, z),
    }
}

/// Expected record built from the contract, independent of the store.
fn expect_entity(
    entity_id: u64,
    revision: u64,
    position: (f64, f64, f64),
    shape: Option<&[u8]>,
) -> (u64, EntitySnapshot) {
    (
        entity_id,
        EntitySnapshot {
            entity_id,
            revision,
            position: Position::new(position.0, position.1, position.2).expect("legal position"),
            shape: shape.map(|bytes| ShapeSlot::from_encoded(bytes.to_vec())),
        },
    )
}

#[test]
fn accepted_creations_allocate_ascending_ids_and_publish_them() {
    let mut world = World::new(WorldConfig::default());
    // Canonical order is (arrival_tick, aigent_id, sequence), so these apply as
    // a, b, c regardless of enqueue order: accept, reject, accept.
    world
        .enqueue(cmd(
            1,
            b"c",
            1,
            CommandEffect::CreateEntity {
                position: PositionRequest::new(-4.5, 0.0, 8.25),
                shape: Some(ShapeSlot::from_encoded(vec![7, 7])),
            },
        ))
        .unwrap();
    world
        .enqueue(cmd(1, b"b", 1, create_at(f64::NAN, 0.0, 0.0)))
        .unwrap();
    world
        .enqueue(cmd(1, b"a", 1, create_at(1.5, -2.0, 3.25)))
        .unwrap();

    let generation = world.advance_tick().expect("tick 1").clone();

    // Derived from ADR-0002: the rejected creation consumes no public ID, so the
    // two accepted creations take 1 and 2 in canonical order and the allocator
    // stands at 3.
    let expected: BTreeMap<u64, EntitySnapshot> = [
        expect_entity(1, 1, (1.5, -2.0, 3.25), None),
        expect_entity(2, 1, (-4.5, 0.0, 8.25), Some(&[7, 7])),
    ]
    .into_iter()
    .collect();
    assert_eq!(generation.entities, expected);
    assert_eq!(generation.next_entity_id, 3);
    assert_eq!(world.entities().snapshots(), expected);
    assert_eq!(world.entities().next_entity_id(), 3);

    // The rejection is a recorded result, not a tick failure.
    let summaries: Vec<&str> = generation
        .applied_commands
        .iter()
        .map(|command| command.summary.as_str())
        .collect();
    assert_eq!(summaries.len(), 3);
    assert!(
        summaries[1].contains("rejected=non_finite_position_x"),
        "middle command should be the recorded rejection, got {summaries:?}"
    );

    // Entity state is inside the generation digest: an otherwise identical world
    // whose one entity sits one millimetre away must digest differently.
    let mut shifted = World::new(WorldConfig::default());
    shifted
        .enqueue(cmd(
            1,
            b"c",
            1,
            CommandEffect::CreateEntity {
                position: PositionRequest::new(-4.5, 0.0, 8.25),
                shape: Some(ShapeSlot::from_encoded(vec![7, 7])),
            },
        ))
        .unwrap();
    shifted
        .enqueue(cmd(1, b"b", 1, create_at(f64::NAN, 0.0, 0.0)))
        .unwrap();
    shifted
        .enqueue(cmd(1, b"a", 1, create_at(1.5, -2.0, 3.251)))
        .unwrap();
    let shifted_generation = shifted.advance_tick().expect("tick 1").clone();
    assert_ne!(shifted_generation.digest(), generation.digest());
}

#[test]
fn rejections_and_no_ops_leave_state_and_revision_unchanged() {
    let mut world = World::new(WorldConfig::default());
    world
        .enqueue(cmd(1, b"a", 1, create_at(10.0, 0.0, -10.0)))
        .unwrap();
    world.advance_tick().expect("tick 1");

    let baseline = world.entities().get(1).cloned().expect("entity 1");
    assert_eq!(baseline.revision, 1);

    // Same position, unknown entity, out-of-bound, non-finite, unchanged shape.
    world
        .enqueue(cmd(2, b"a", 2, move_to(1, 10.0, 0.0, -10.0)))
        .unwrap();
    world
        .enqueue(cmd(2, b"a", 3, move_to(9, 0.0, 0.0, 0.0)))
        .unwrap();
    world
        .enqueue(cmd(
            2,
            b"a",
            4,
            move_to(1, WORLD_BOUND_METRES + 0.0004, 0.0, 0.0),
        ))
        .unwrap();
    world
        .enqueue(cmd(2, b"a", 5, move_to(1, 0.0, f64::INFINITY, 0.0)))
        .unwrap();
    world
        .enqueue(cmd(
            2,
            b"a",
            6,
            CommandEffect::SetEntityShape {
                entity_id: 1,
                shape: None,
            },
        ))
        .unwrap();
    let generation = world.advance_tick().expect("tick 2").clone();

    assert_eq!(
        world.entities().get(1),
        Some(&baseline),
        "no rejection or semantic no-op may change stored state or revision"
    );
    assert_eq!(generation.entities.get(&1), Some(&baseline));
    assert_eq!(
        world.entities().next_entity_id(),
        2,
        "no rejection may consume a public entity id"
    );

    let summaries: Vec<&str> = generation
        .applied_commands
        .iter()
        .map(|command| command.summary.as_str())
        .collect();
    assert!(summaries[0].contains(":noop:"), "{summaries:?}");
    assert!(
        summaries[1].contains("rejected=unknown_entity"),
        "{summaries:?}"
    );
    assert!(
        summaries[2].contains("rejected=position_out_of_bound_x"),
        "{summaries:?}"
    );
    assert!(
        summaries[3].contains("rejected=non_finite_position_y"),
        "{summaries:?}"
    );
    assert!(summaries[4].contains(":noop:"), "{summaries:?}");

    // One accepted externally visible change increments the revision once.
    world
        .enqueue(cmd(3, b"a", 7, move_to(1, 11.0, 0.0, -10.0)))
        .unwrap();
    let third = world.advance_tick().expect("tick 3").clone();
    let expected: BTreeMap<u64, EntitySnapshot> = [expect_entity(1, 2, (11.0, 0.0, -10.0), None)]
        .into_iter()
        .collect();
    assert_eq!(third.entities, expected);

    // The closed world bound itself is legal.
    world
        .enqueue(cmd(
            4,
            b"a",
            8,
            move_to(1, WORLD_BOUND_METRES, -WORLD_BOUND_METRES, 0.0),
        ))
        .unwrap();
    let fourth = world.advance_tick().expect("tick 4").clone();
    assert_eq!(
        fourth.entities,
        [expect_entity(
            1,
            3,
            (WORLD_BOUND_METRES, -WORLD_BOUND_METRES, 0.0),
            None
        )]
        .into_iter()
        .collect::<BTreeMap<_, _>>()
    );
}

#[test]
fn entity_mutations_install_only_after_durable_success() {
    let path = temp_db("install");
    let mut world = World::with_journal(
        WorldConfig::default(),
        DurableJournal::async_sqlite(&path).unwrap(),
    );
    world
        .journal_mut()
        .as_async_sqlite_mut()
        .unwrap()
        .inject_delay_next(Duration::from_millis(150));

    world
        .enqueue(cmd(1, b"a", 1, create_at(3.0, 0.0, 4.0)))
        .unwrap();
    assert!(matches!(
        world.advance_tick_nonblocking().unwrap(),
        TickAdvance::Submitted { generation: 1 }
    ));
    assert!(world.has_tentative());
    assert!(
        world.entities().is_empty(),
        "entity state must stay tentative until the durable commit succeeds"
    );
    assert_eq!(
        world.entities().next_entity_id(),
        FIRST_ENTITY_ID,
        "a tentative creation must not consume the public id before commit"
    );
    assert!(world.last_generation().is_none());

    let published = world.wait_durable().unwrap().clone();
    let expected: BTreeMap<u64, EntitySnapshot> = [expect_entity(1, 1, (3.0, 0.0, 4.0), None)]
        .into_iter()
        .collect();
    assert_eq!(published.entities, expected);
    assert_eq!(world.entities().snapshots(), expected);
    assert_eq!(
        world.journal().last_committed().unwrap().entities,
        expected,
        "the durable packet carries the same entity table it authorized"
    );
    assert_eq!(world.journal().last_committed().unwrap().next_entity_id, 2);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn failed_durable_write_consumes_no_entity_id_and_retries_cleanly() {
    let path = temp_db("fail");
    let mut world = World::with_journal(
        WorldConfig::default(),
        DurableJournal::async_sqlite(&path).unwrap(),
    );
    world
        .journal_mut()
        .as_async_sqlite_mut()
        .unwrap()
        .inject_fail_next(JournalError::Storage("injected write failure".into()));

    world
        .enqueue(cmd(1, b"a", 1, create_at(6.0, 0.0, 0.0)))
        .unwrap();
    assert!(matches!(
        world.advance_tick_nonblocking().unwrap(),
        TickAdvance::Submitted { .. }
    ));
    assert!(world.wait_durable().is_err());
    assert!(world.entities().is_empty());
    assert_eq!(
        world.entities().next_entity_id(),
        FIRST_ENTITY_ID,
        "ADR-0005: a tentative id is not an authoritative allocation"
    );
    assert!(world.last_generation().is_none());

    // The restored command retries and takes the id the failed attempt drafted.
    let published = world.advance_tick().unwrap().clone();
    assert_eq!(
        published.entities,
        [expect_entity(1, 1, (6.0, 0.0, 0.0), None)]
            .into_iter()
            .collect::<BTreeMap<_, _>>()
    );
    let _ = std::fs::remove_file(&path);
}

#[test]
fn same_build_replay_reproduces_entity_state_and_digest() {
    let config = WorldConfig {
        world_seed: *b"entity-store-replay-seed-0123456",
        lease_ttl_ms: 10_000,
    };
    let log = vec![
        cmd(1, b"a", 1, create_at(1.0, 2.0, 3.0)),
        cmd(1, b"b", 1, create_at(-1.0, 0.0, -1.0)),
        cmd(1, b"z", 1, create_at(f64::NEG_INFINITY, 0.0, 0.0)),
        cmd(2, b"a", 2, move_to(1, 1.5, 2.0, 3.0)),
        cmd(2, b"a", 3, move_to(1, 1.5, 2.0, 3.0)),
        cmd(
            2,
            b"b",
            2,
            CommandEffect::SetEntityShape {
                entity_id: 2,
                shape: Some(ShapeSlot::from_encoded(vec![1, 2, 3])),
            },
        ),
    ];

    let mut live = World::new(config.clone());
    for command in &log {
        live.enqueue(command.clone()).unwrap();
    }
    live.advance_ticks(2).unwrap();
    let live_generation = live.published().unwrap().clone();

    // Derived expectation: two accepted creations (ids 1 and 2, the rejected one
    // consumes nothing), one accepted move and one repeated no-op move on 1, one
    // accepted shape change on 2.
    let expected: BTreeMap<u64, EntitySnapshot> = [
        expect_entity(1, 2, (1.5, 2.0, 3.0), None),
        expect_entity(2, 2, (-1.0, 0.0, -1.0), Some(&[1, 2, 3])),
    ]
    .into_iter()
    .collect();
    assert_eq!(live_generation.entities, expected);
    assert_eq!(live_generation.next_entity_id, 3);

    let replayed = replay_log(config, &log, 2).unwrap();
    assert_eq!(replayed.entities, expected);
    assert_eq!(replayed.next_entity_id, 3);
    assert_eq!(replayed.digest(), live_generation.digest());
}

#[test]
fn restart_recovers_entities_and_never_reuses_an_id() {
    let path = temp_db("recover");
    let journal = DurableJournal::sqlite(&path).unwrap();
    let mut world = World::with_journal(WorldConfig::default(), journal);
    world
        .enqueue(cmd(1, b"a", 1, create_at(2.0, 0.0, 2.0)))
        .unwrap();
    world
        .enqueue(cmd(
            1,
            b"b",
            1,
            CommandEffect::CreateEntity {
                position: PositionRequest::new(-3.0, 1.0, 0.0),
                shape: Some(ShapeSlot::from_encoded(vec![4, 2])),
            },
        ))
        .unwrap();
    world.advance_tick().unwrap();
    world
        .enqueue(cmd(2, b"a", 2, move_to(1, 2.5, 0.0, 2.0)))
        .unwrap();
    world.advance_tick().unwrap();
    drop(world);

    let reopened = DurableJournal::sqlite(&path).unwrap();
    let mut recovered = World::recover_from_journal(WorldConfig::default(), reopened).unwrap();
    let expected: BTreeMap<u64, EntitySnapshot> = [
        expect_entity(1, 2, (2.5, 0.0, 2.0), None),
        expect_entity(2, 1, (-3.0, 1.0, 0.0), Some(&[4, 2])),
    ]
    .into_iter()
    .collect();
    assert_eq!(recovered.entities().snapshots(), expected);
    assert_eq!(recovered.entities().next_entity_id(), 3);
    assert_eq!(recovered.last_completed_tick(), 2);

    // IDs are never reused after a restart.
    recovered
        .enqueue(cmd(3, b"a", 3, create_at(0.0, 0.0, 0.0)))
        .unwrap();
    let generation = recovered.advance_tick().unwrap().clone();
    assert_eq!(
        generation.entities.keys().copied().collect::<Vec<_>>(),
        vec![1, 2, 3]
    );
    assert_eq!(generation.next_entity_id, 4);
    let _ = std::fs::remove_file(&path);
}

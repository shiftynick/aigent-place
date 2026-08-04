//! Behavioral tests for the fixed-tick world core (task-005).

use world_server::{
    replay_log, CommandEffect, QueuedCommand, World, WorldConfig, DEFAULT_LEASE_TTL_MS, TICK_HZ,
    TICK_MS,
};

fn cmd(arrival_tick: u64, aigent: &[u8], sequence: u64, effect: CommandEffect) -> QueuedCommand {
    QueuedCommand {
        arrival_tick,
        aigent_id: aigent.to_vec(),
        sequence,
        effect,
    }
}

#[test]
fn tick_progression_publishes_immutable_generations() {
    assert_eq!(TICK_HZ * TICK_MS, 1_000);
    let mut world = World::new(WorldConfig::default());
    assert_eq!(world.last_completed_tick(), 0);
    assert!(world.published().is_none());

    let first = world.advance_tick().expect("tick 1").clone();
    assert_eq!(first.tick, 1);
    assert_eq!(first.generation, 1);
    let first_digest = first.digest();

    let second = world.advance_tick().expect("tick 2").clone();
    assert_eq!(second.tick, 2);
    assert_eq!(second.generation, 2);
    assert_ne!(first_digest, second.digest());
    // Prior generation value is a clone; live publication moved forward.
    assert_eq!(world.published().unwrap().generation, 2);
    assert_eq!(first.digest(), first_digest);
}

#[test]
fn evaluation_order_ignores_enqueue_order() {
    let mut left = World::new(WorldConfig::default());
    left.enqueue(cmd(1, b"b", 1, CommandEffect::BumpWorldValue { delta: 10 }))
        .unwrap();
    left.enqueue(cmd(1, b"a", 1, CommandEffect::BumpWorldValue { delta: 1 }))
        .unwrap();
    left.enqueue(cmd(
        1,
        b"a",
        2,
        CommandEffect::BumpWorldValue { delta: 100 },
    ))
    .unwrap();

    let mut right = World::new(WorldConfig::default());
    // Reverse enqueue order.
    right
        .enqueue(cmd(
            1,
            b"a",
            2,
            CommandEffect::BumpWorldValue { delta: 100 },
        ))
        .unwrap();
    right
        .enqueue(cmd(1, b"a", 1, CommandEffect::BumpWorldValue { delta: 1 }))
        .unwrap();
    right
        .enqueue(cmd(1, b"b", 1, CommandEffect::BumpWorldValue { delta: 10 }))
        .unwrap();

    let left_gen = left.advance_tick().unwrap().clone();
    let right_gen = right.advance_tick().unwrap().clone();
    assert_eq!(left_gen.digest(), right_gen.digest());
    assert_eq!(left.world_value(), 111);
    assert_eq!(right.world_value(), 111);
    assert_eq!(
        left_gen
            .applied_commands
            .iter()
            .map(|c| (c.aigent_id.as_slice(), c.sequence))
            .collect::<Vec<_>>(),
        vec![
            (b"a".as_slice(), 1),
            (b"a".as_slice(), 2),
            (b"b".as_slice(), 1)
        ]
    );
}

#[test]
fn movement_lease_expires_via_internal_harness() {
    // Explicit per-command TTL (100 ms => 2 ticks); live ruleset owns the default.
    let config = WorldConfig {
        world_seed: [7; 32],
        lease_ttl_ms: DEFAULT_LEASE_TTL_MS,
    };
    let mut world = World::new(config);
    world
        .enqueue(cmd(
            1,
            b"pilot",
            1,
            CommandEffect::UpsertLease {
                body_id: 42,
                ttl_ms: Some(100),
            },
        ))
        .unwrap();

    let gen1 = world.advance_tick().unwrap().clone();
    assert!(gen1.active_leases.contains_key(&42));
    assert_eq!(gen1.active_leases[&42].expire_tick, 3);

    assert!(world
        .advance_tick()
        .unwrap()
        .active_leases
        .contains_key(&42));
    let gen3 = world.advance_tick().unwrap().clone();
    assert!(!gen3.active_leases.contains_key(&42));
    assert_eq!(gen3.expired_leases, vec![42]);
    assert_eq!(DEFAULT_LEASE_TTL_MS, 10_000);
}

#[test]
fn same_build_replay_matches_seed_and_command_log() {
    let config = WorldConfig {
        world_seed: *b"0123456789abcdef0123456789abcdef",
        lease_ttl_ms: 10_000,
    };
    let log = vec![
        cmd(1, b"z", 1, CommandEffect::BumpWorldValue { delta: 5 }),
        cmd(
            1,
            b"a",
            1,
            CommandEffect::SeededDraw {
                subsystem: "world".into(),
                purpose: "test".into(),
                entity_id: 0,
                draw_index: 0,
                bound: 100,
            },
        ),
        cmd(
            2,
            b"a",
            2,
            CommandEffect::UpsertLease {
                body_id: 9,
                ttl_ms: Some(50),
            },
        ),
    ];

    let mut live = World::new(config.clone());
    for command in &log {
        live.enqueue(command.clone()).unwrap();
    }
    live.advance_ticks(2).unwrap();
    let live_digest = live.published().unwrap().digest();
    let live_value = live.world_value();

    let replayed = replay_log(config.clone(), &log, 2).unwrap();
    assert_eq!(replayed.digest(), live_digest);
    assert_eq!(replayed.world_value, live_value);
    assert!(replayed.active_leases.contains_key(&9));

    assert!(matches!(
        live.enqueue(cmd(
            1,
            b"late",
            1,
            CommandEffect::BumpWorldValue { delta: 1 }
        )),
        Err(world_server::WorldError::StaleArrivalTick { .. })
    ));
}

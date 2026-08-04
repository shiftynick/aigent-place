//! Async durable writer: non-blocking ticks and fail-closed discard (task-250444).

use std::path::PathBuf;
use std::time::Duration;

use world_server::{
    CommandEffect, DurableJournal, JournalError, QueuedCommand, TickAdvance, World, WorldConfig,
};

fn temp_db(name: &str) -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!(
        "aigent-place-async-writer-{}-{}-{}.sqlite",
        name,
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time")
            .as_nanos()
    ));
    path
}

fn bump(world: &mut World, arrival_tick: u64, sequence: u64, delta: i64) {
    world
        .enqueue(QueuedCommand {
            arrival_tick,
            aigent_id: b"a".to_vec(),
            sequence,
            effect: CommandEffect::BumpWorldValue { delta },
        })
        .unwrap();
}

#[test]
fn async_writer_slow_storage_does_not_block_tick_stage() {
    let path = temp_db("slow");
    let mut world = World::with_journal(
        WorldConfig::default(),
        DurableJournal::async_sqlite(&path).unwrap(),
    );
    world
        .journal_mut()
        .as_async_sqlite_mut()
        .unwrap()
        .inject_delay_next(Duration::from_millis(200));

    bump(&mut world, 1, 1, 5);
    let started = std::time::Instant::now();
    let outcome = world.advance_tick_nonblocking().unwrap();
    assert!(matches!(outcome, TickAdvance::Submitted { generation: 1 }));
    assert!(
        started.elapsed() < Duration::from_millis(100),
        "tick stage must return well before the 200ms injected storage delay"
    );
    assert!(
        world.has_tentative(),
        "return before durable install proves the tick stage did not await commit"
    );
    assert!(
        world
            .journal_mut()
            .as_async_sqlite_mut()
            .expect("async journal")
            .in_flight(),
        "writer still in flight after non-blocking submit"
    );
    assert_eq!(
        world.world_value(),
        0,
        "mutations stay tentative until commit"
    );
    assert!(world.last_generation().is_none());

    // Further ticks are backpressured while durability is in flight.
    assert!(matches!(
        world.advance_tick_nonblocking().unwrap(),
        TickAdvance::Busy
    ));

    let published = world.wait_durable().unwrap();
    assert_eq!(published.world_value, 5);
    assert_eq!(world.world_value(), 5);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn async_writer_failure_discards_tentative_without_publishing() {
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

    bump(&mut world, 1, 1, 9);
    assert!(matches!(
        world.advance_tick_nonblocking().unwrap(),
        TickAdvance::Submitted { .. }
    ));
    let err = world.wait_durable().unwrap_err();
    assert!(matches!(err, world_server::WorldError::Persistence(_)));
    assert_eq!(world.world_value(), 0);
    assert!(world.last_generation().is_none());
    assert!(!world.has_tentative());
    // Command remains retryable on the pending queue after discard.
    assert_eq!(world.next_tick(), 1);

    // Healthy retry after failure (same restored pending command).
    let gen = world.advance_tick().unwrap();
    assert_eq!(gen.world_value, 9);
    assert_eq!(world.world_value(), 9);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn async_writer_preserves_commands_enqueued_during_inflight_commit() {
    let path = temp_db("inflight-enqueue");
    let mut world = World::with_journal(
        WorldConfig::default(),
        DurableJournal::async_sqlite(&path).unwrap(),
    );
    world
        .journal_mut()
        .as_async_sqlite_mut()
        .unwrap()
        .inject_delay_next(Duration::from_millis(50));

    bump(&mut world, 1, 1, 3);
    assert!(matches!(
        world.advance_tick_nonblocking().unwrap(),
        TickAdvance::Submitted { generation: 1 }
    ));
    // Arrives while generation 1 is still committing.
    bump(&mut world, 2, 2, 4);

    let published = world.wait_durable().unwrap();
    assert_eq!(published.world_value, 3);
    let second = world.advance_tick().unwrap();
    assert_eq!(second.world_value, 7);
    assert_eq!(world.world_value(), 7);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn sync_path_still_publishes_only_after_commit() {
    let mut world = World::new(WorldConfig::default());
    bump(&mut world, 1, 1, 2);
    let gen = world.advance_tick().unwrap();
    assert_eq!(gen.world_value, 2);
    assert_eq!(world.journal().last_committed().unwrap().world_value, 2);
}

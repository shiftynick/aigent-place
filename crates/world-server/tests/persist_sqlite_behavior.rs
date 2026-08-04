//! SQLite WAL journal recovery and fail-closed integrity (task-032).

use std::path::PathBuf;
use world_server::{
    CommandEffect, DurableJournal, QueuedCommand, SqliteJournal, World, WorldConfig,
};

fn temp_db(name: &str) -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!(
        "aigent-place-task-032-{}-{}-{}.sqlite",
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
fn sqlite_commit_rejects_non_contiguous_generation() {
    let path = temp_db("commit-gap");
    let mut world = World::with_journal(
        WorldConfig::default(),
        DurableJournal::sqlite(&path).unwrap(),
    );
    bump(&mut world, 1, 1, 1);
    world.advance_tick().unwrap();
    let last = world.journal().last_committed().unwrap().clone();
    drop(world);

    let mut journal = DurableJournal::sqlite(&path).unwrap();
    let err = journal
        .begin(world_server::CommittedGeneration {
            generation: last.generation + 2,
            world_value: last.world_value,
            ruleset: last.ruleset.clone(),
            pending_ruleset: None,
            command_summaries: vec!["skip".into()],
            active_leases: last.active_leases.clone(),
            integrity_hex: String::new(),
        })
        .and_then(|_| journal.commit().map(|_| ()))
        .unwrap_err();
    assert!(matches!(
        err,
        world_server::JournalError::GenerationGap {
            expected: 2,
            found: 3
        }
    ));
    let reopened = DurableJournal::sqlite(&path).unwrap();
    assert_eq!(reopened.last_committed().unwrap().generation, 1);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn sqlite_restart_recovers_last_committed_generation() {
    let path = temp_db("recover");
    let journal = DurableJournal::sqlite(&path).unwrap();
    let mut world = World::with_journal(WorldConfig::default(), journal);
    bump(&mut world, 1, 1, 3);
    world.advance_tick().unwrap();
    bump(&mut world, 2, 2, 4);
    world.advance_tick().unwrap();
    assert_eq!(world.world_value(), 7);
    assert_eq!(world.journal().last_committed().unwrap().generation, 2);
    drop(world);

    let reopened = DurableJournal::sqlite(&path).unwrap();
    let recovered = World::recover_from_journal(WorldConfig::default(), reopened).unwrap();
    assert_eq!(recovered.world_value(), 7);
    assert_eq!(recovered.last_completed_tick(), 2);
    assert_eq!(recovered.journal().last_committed().unwrap().generation, 2);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn sqlite_pending_discarded_on_recover_without_commit() {
    let path = temp_db("pending");
    {
        let journal = DurableJournal::sqlite(&path).unwrap();
        let mut world = World::with_journal(WorldConfig::default(), journal);
        bump(&mut world, 1, 1, 1);
        world.advance_tick().unwrap();
    }
    {
        // Open the same DB and begin a pending generation without committing.
        let mut journal = DurableJournal::sqlite(&path).unwrap();
        let last = journal.last_committed().unwrap().clone();
        journal
            .begin(world_server::CommittedGeneration {
                generation: last.generation + 1,
                world_value: 99,
                ruleset: last.ruleset.clone(),
                pending_ruleset: None,
                command_summaries: vec!["uncommitted".into()],
                active_leases: last.active_leases.clone(),
                integrity_hex: String::new(),
            })
            .unwrap();
        assert!(journal.pending().is_some());
        // Drop without commit — pending lived only in RAM.
    }
    let reopened = DurableJournal::sqlite(&path).unwrap();
    let recovered = World::recover_from_journal(WorldConfig::default(), reopened).unwrap();
    assert_eq!(recovered.world_value(), 1);
    assert!(recovered.journal().pending().is_none());
    let _ = std::fs::remove_file(&path);
}

#[test]
fn sqlite_corrupt_integrity_fails_closed() {
    let path = temp_db("corrupt");
    let journal = DurableJournal::sqlite(&path).unwrap();
    let mut world = World::with_journal(WorldConfig::default(), journal);
    bump(&mut world, 1, 1, 1);
    world.advance_tick().unwrap();
    drop(world);

    let sqlite = SqliteJournal::open(&path).unwrap();
    assert!(sqlite.corrupt_last_integrity_for_test().unwrap());
    drop(sqlite);

    let err = DurableJournal::sqlite(&path).unwrap_err();
    assert!(matches!(
        err,
        world_server::JournalError::CorruptCommitted { generation: 1 }
    ));
    let _ = std::fs::remove_file(&path);
}

#[test]
fn sqlite_corrupt_payload_fails_closed() {
    let path = temp_db("payload");
    let journal = DurableJournal::sqlite(&path).unwrap();
    let mut world = World::with_journal(WorldConfig::default(), journal);
    bump(&mut world, 1, 1, 2);
    world.advance_tick().unwrap();
    drop(world);

    let sqlite = SqliteJournal::open(&path).unwrap();
    assert!(sqlite.corrupt_last_payload_for_test().unwrap());
    drop(sqlite);

    let err = DurableJournal::sqlite(&path).unwrap_err();
    assert!(matches!(
        err,
        world_server::JournalError::CorruptCommitted { generation: 1 }
    ));
    let _ = std::fs::remove_file(&path);
}

#[test]
fn sqlite_semantic_corruption_fails_closed() {
    let path = temp_db("semantics");
    let journal = DurableJournal::sqlite(&path).unwrap();
    let mut world = World::with_journal(WorldConfig::default(), journal);
    bump(&mut world, 1, 1, 5);
    world.advance_tick().unwrap();
    drop(world);

    let sqlite = SqliteJournal::open(&path).unwrap();
    assert!(sqlite.corrupt_last_semantics_for_test().unwrap());
    drop(sqlite);

    let err = DurableJournal::sqlite(&path).unwrap_err();
    assert!(matches!(
        err,
        world_server::JournalError::CorruptCommitted { generation: 1 }
    ));
    let _ = std::fs::remove_file(&path);
}

#[test]
fn sqlite_generation_gap_fails_closed() {
    let path = temp_db("gap");
    let journal = DurableJournal::sqlite(&path).unwrap();
    let mut world = World::with_journal(WorldConfig::default(), journal);
    bump(&mut world, 1, 1, 1);
    world.advance_tick().unwrap();
    let base = world.journal().last_committed().unwrap().clone();
    drop(world);

    let sqlite = SqliteJournal::open(&path).unwrap();
    sqlite
        .push_gapped_committed_for_test(world_server::CommittedGeneration {
            generation: base.generation + 2,
            world_value: base.world_value,
            ruleset: base.ruleset,
            pending_ruleset: None,
            command_summaries: vec!["gap".into()],
            active_leases: base.active_leases,
            integrity_hex: String::new(),
        })
        .unwrap();
    drop(sqlite);

    let err = DurableJournal::sqlite(&path).unwrap_err();
    assert!(matches!(
        err,
        world_server::JournalError::GenerationGap {
            expected: 2,
            found: 3
        }
    ));
    let _ = std::fs::remove_file(&path);
}

//! Crash recovery and slow-client isolation across world, journal, and fan-out (task-008).

use aigent_protocol::ProtocolCloseReason;
use std::sync::{Arc, Mutex};
use std::thread;
use world_server::{
    CommandEffect, CommittedGeneration, JournalError, ObserveOutcome, PublicationMailbox,
    QueuedCommand, RulesetParameters, SnapshotFanout, World, WorldConfig, WorldError,
    OVERFLOW_TICK_OBSERVATIONS, QUEUE_LIMIT_BYTES,
};

fn bump(arrival: u64, aigent: &[u8], sequence: u64, delta: i64) -> QueuedCommand {
    QueuedCommand {
        arrival_tick: arrival,
        aigent_id: aigent.to_vec(),
        sequence,
        effect: CommandEffect::BumpWorldValue { delta },
    }
}

/// Forced interruption before commit recovers only the last durable generation.
///
/// The journal skeleton is in-memory (task-007); crash-before-commit is modeled
/// as an uncommitted pending packet discarded on recover, matching ADR-0005's
/// uncommitted-tail outcome.
#[test]
fn forced_interrupt_recovers_last_committed_boundary() {
    let mut world = World::new(WorldConfig::default());
    world.enqueue(bump(1, b"a", 1, 5)).unwrap();
    world.advance_tick().unwrap();
    world.enqueue(bump(2, b"a", 1, 7)).unwrap();
    world.advance_tick().unwrap();
    assert_eq!(world.world_value(), 12);
    let last = world.journal().last_committed().unwrap().clone();

    let mut journal = world.journal().as_memory().expect("memory journal").clone();
    journal
        .begin(CommittedGeneration {
            generation: 99,
            world_value: 9_999,
            ruleset: last.ruleset.clone(),
            pending_ruleset: None,
            command_summaries: vec!["uncommitted".into()],
            active_leases: Default::default(),
            integrity_hex: String::new(),
        })
        .unwrap();
    assert!(journal.pending().is_some());

    let recovered = World::recover_from_memory_journal(WorldConfig::default(), journal).unwrap();
    assert!(recovered.journal().pending().is_none());
    assert_eq!(recovered.world_value(), 12);
    assert_eq!(recovered.last_completed_tick(), 2);
    assert_eq!(
        recovered.journal().last_committed().unwrap().generation,
        last.generation
    );
}

/// Corrupt committed integrity fails closed: no reconstructed live mutation.
#[test]
fn corrupt_committed_tail_fails_closed() {
    let mut world = World::new(WorldConfig::default());
    world.enqueue(bump(1, b"a", 1, 3)).unwrap();
    world.advance_tick().unwrap();
    let mut journal = world.journal().as_memory().expect("memory journal").clone();
    assert!(journal.corrupt_last_committed_integrity_for_test());

    let err = World::recover_from_memory_journal(WorldConfig::default(), journal).unwrap_err();
    assert!(matches!(
        err,
        WorldError::Persistence(JournalError::CorruptCommitted { generation: 1 })
    ));
}

/// Incomplete (unsealed) committed record fails closed — partial-write model.
#[test]
fn incomplete_unsealed_committed_fails_closed() {
    let mut world = World::new(WorldConfig::default());
    world.advance_tick().unwrap();
    let mut journal = world.journal().as_memory().expect("memory journal").clone();
    let base = journal.last_committed().unwrap().clone();
    journal.push_incomplete_committed_for_test(CommittedGeneration {
        generation: 2,
        world_value: base.world_value,
        ruleset: base.ruleset.clone(),
        pending_ruleset: None,
        command_summaries: vec![],
        active_leases: Default::default(),
        integrity_hex: String::new(),
    });

    let err = World::recover_from_memory_journal(WorldConfig::default(), journal).unwrap_err();
    assert!(matches!(
        err,
        WorldError::Persistence(JournalError::CorruptCommitted { generation: 2 })
    ));
}

/// Truncated integrity digest fails closed.
#[test]
fn truncated_integrity_digest_fails_closed() {
    let mut world = World::new(WorldConfig::default());
    world.advance_tick().unwrap();
    let mut journal = world.journal().as_memory().expect("memory journal").clone();
    assert!(journal.truncate_last_committed_integrity_for_test());

    let err = World::recover_from_memory_journal(WorldConfig::default(), journal).unwrap_err();
    assert!(matches!(
        err,
        WorldError::Persistence(JournalError::CorruptCommitted { generation: 1 })
    ));
}

/// Tampering lease identity fields invalidates the sealed digest.
#[test]
fn lease_identity_tamper_fails_integrity() {
    let mut world = World::new(WorldConfig::default());
    world
        .enqueue(QueuedCommand {
            arrival_tick: 1,
            aigent_id: b"owner".to_vec(),
            sequence: 1,
            effect: CommandEffect::UpsertLease {
                body_id: 7,
                ttl_ms: Some(10_000),
            },
        })
        .unwrap();
    world.advance_tick().unwrap();
    let mut packet = world.journal().last_committed().unwrap().clone();
    assert!(packet.integrity_ok());
    let lease = packet.active_leases.get_mut(&7).expect("lease");
    lease.aigent_id = b"intruder".to_vec();
    assert!(!packet.integrity_ok());
    let mut packet = world.journal().last_committed().unwrap().clone();
    let lease = packet.active_leases.get_mut(&7).expect("lease");
    lease.body_id = 99;
    assert!(!packet.integrity_ok());
}

/// Tampering pending ruleset parameters invalidates the sealed digest.
#[test]
fn pending_parameter_tamper_fails_integrity() {
    let mut world = World::new(WorldConfig::default());
    let mut longer = RulesetParameters::catalog_defaults();
    longer.set("governance.soak_delay_ticks", 5);
    longer.set("governance.meta_soak_delay_ticks", 5);
    world.schedule_ruleset(longer).unwrap();
    world.advance_tick().unwrap(); // activates longer soak
    let mut next = RulesetParameters::catalog_defaults();
    next.set("movement.lease_ttl_ms", 15_000);
    next.set("governance.soak_delay_ticks", 5);
    next.set("governance.meta_soak_delay_ticks", 5);
    world.schedule_ruleset(next).unwrap();
    world.advance_tick().unwrap(); // pending survives
    assert!(world.rulesets().pending().is_some());

    let mut packet = world.journal().last_committed().unwrap().clone();
    assert!(packet.integrity_ok());
    let pending = packet.pending_ruleset.as_mut().expect("pending");
    pending.parameters.set("movement.lease_ttl_ms", 99_000);
    assert!(!packet.integrity_ok());
}

/// Generation gap in committed history fails closed.
#[test]
fn generation_gap_fails_closed() {
    let mut world = World::new(WorldConfig::default());
    world.advance_tick().unwrap();
    let mut journal = world.journal().as_memory().expect("memory journal").clone();
    let base = journal.last_committed().unwrap().clone();
    journal.push_gapped_committed_for_test(CommittedGeneration {
        generation: 3, // gap: expected 2
        world_value: base.world_value,
        ruleset: base.ruleset,
        pending_ruleset: None,
        command_summaries: vec![],
        active_leases: Default::default(),
        integrity_hex: String::new(),
    });

    let err = World::recover_from_memory_journal(WorldConfig::default(), journal).unwrap_err();
    assert!(matches!(
        err,
        WorldError::Persistence(JournalError::GenerationGap {
            expected: 2,
            found: 3
        })
    ));
}

/// Empty journal recovers to a fresh world (no committed history).
#[test]
fn empty_journal_recovers_fresh_world() {
    let recovered = World::recover_from_journal(
        WorldConfig::default(),
        world_server::DurableJournal::memory(),
    )
    .unwrap();
    assert_eq!(recovered.world_value(), 0);
    assert_eq!(recovered.last_completed_tick(), 0);
    assert!(recovered.journal().last_committed().is_none());
}

/// Slow fan-out drain cannot stall simulation ticks; world still persists.
#[test]
fn slow_clients_cannot_stall_simulation_or_commit() {
    let mut world = World::new(WorldConfig::default());
    let mailbox = PublicationMailbox::new();
    let mut fanout = SnapshotFanout::new();
    fanout.attach(b"viewer-slow".to_vec());
    fanout.attach(b"aigent-slow".to_vec());

    for tick in 1..=60u64 {
        world.enqueue(bump(tick, b"a", tick, 1)).unwrap();
        let gen = world.advance_tick().unwrap().clone();
        mailbox.publish_from_tick(gen);
        // Serialization never drains — both clients are "slow".
    }

    assert_eq!(world.last_completed_tick(), 60);
    assert_eq!(world.world_value(), 60);
    assert!(mailbox.has_pending());
    assert_eq!(world.journal().last_committed().unwrap().generation, 60);
    assert!(!fanout.get(b"viewer-slow").unwrap().queue.is_closed());
    assert!(!fanout.get(b"aigent-slow").unwrap().queue.is_closed());
}

/// Concurrent undrained mailbox must not block a tick-advancing worker.
#[test]
fn concurrent_undrained_mailbox_does_not_block_ticks() {
    let world = Arc::new(Mutex::new(World::new(WorldConfig::default())));
    let mailbox = Arc::new(PublicationMailbox::new());
    let worker_world = Arc::clone(&world);
    let worker_mailbox = Arc::clone(&mailbox);

    let handle = thread::spawn(move || {
        for _ in 0..80 {
            let mut world = worker_world
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let gen = world.advance_tick().unwrap().clone();
            worker_mailbox.publish_from_tick(gen);
        }
    });
    // Main thread never drains — models a stalled serialization/socket stage.
    handle.join().expect("tick worker");
    let world = world
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    assert_eq!(world.last_completed_tick(), 80);
    assert_eq!(world.journal().last_committed().unwrap().generation, 80);
    assert!(mailbox.has_pending());
}

/// Sustained outbound overflow closes only the slow connection; world keeps ticking.
#[test]
fn sustained_overflow_isolates_only_slow_connection() {
    let mut world = World::new(WorldConfig::default());
    let mailbox = PublicationMailbox::new();
    let mut fanout = SnapshotFanout::new();
    fanout.attach(b"slow".to_vec());
    fanout.attach(b"fast".to_vec());

    let gen = world.advance_tick().unwrap().clone();
    mailbox.publish_from_tick(gen);
    let published = mailbox.take().unwrap();
    fanout
        .publish_to(b"slow", &published, Some(QUEUE_LIMIT_BYTES + 1))
        .unwrap();
    fanout.publish_to(b"fast", &published, Some(1024)).unwrap();

    for _ in 0..OVERFLOW_TICK_OBSERVATIONS {
        let gen = world.advance_tick().unwrap().clone();
        let tick = gen.tick;
        mailbox.publish_from_tick(gen);
        let _ = mailbox.take();
        fanout.get_mut(b"fast").unwrap().queue.drain_state();
        fanout.observe_all_at(tick);
    }

    assert!(fanout.get(b"slow").unwrap().queue.is_closed());
    assert!(!fanout.get(b"fast").unwrap().queue.is_closed());
    assert_eq!(
        world.last_completed_tick(),
        u64::from(OVERFLOW_TICK_OBSERVATIONS) + 1
    );
    assert!(world.journal().last_committed().is_some());

    let gen = world.advance_tick().unwrap().clone();
    let outcome = fanout.publish_to(b"slow", &gen, Some(QUEUE_LIMIT_BYTES + 1));
    assert!(matches!(
        outcome,
        Some(world_server::PublishOutcome::ConnectionClosed)
    ));
    let fast = fanout.publish_to(b"fast", &gen, Some(512)).unwrap();
    assert!(!matches!(
        fast,
        world_server::PublishOutcome::ConnectionClosed
    ));
}

/// Overflow close reason matches the protocol contract.
#[test]
fn overflow_close_reason_is_sustained_outbound_overflow() {
    let mut fanout = SnapshotFanout::new();
    fanout.attach(b"slow".to_vec());
    let mut world = World::new(WorldConfig::default());
    let gen = world.advance_tick().unwrap().clone();
    fanout
        .publish_to(b"slow", &gen, Some(QUEUE_LIMIT_BYTES + 1))
        .unwrap();

    let mut last = ObserveOutcome::Observed {
        over_limit_ticks: 0,
    };
    for tick in 1..=u64::from(OVERFLOW_TICK_OBSERVATIONS) {
        last = fanout.get_mut(b"slow").unwrap().queue.observe_at(tick);
    }
    assert_eq!(
        last,
        ObserveOutcome::Closed {
            reason: ProtocolCloseReason::SustainedOutboundOverflow,
            over_limit_ticks: OVERFLOW_TICK_OBSERVATIONS,
        }
    );
}

//! Snapshot baselines, outbound queues, and sim/serialization decoupling (task-006).

use aigent_protocol::{ProtocolCloseReason, SnapshotResyncReason};
use world_server::{
    ObserveOutcome, OutboundQueue, PublicationMailbox, PublishOutcome, SnapshotFanout,
    SnapshotStatus, StateKind, StubSnapshotPayload, World, WorldConfig, OVERFLOW_TICK_OBSERVATIONS,
    QUEUE_LIMIT_BYTES,
};

#[test]
fn mailbox_decouples_tick_from_fanout_drain() {
    let mut world = World::new(WorldConfig::default());
    let mailbox = PublicationMailbox::new();
    let mut fanout = SnapshotFanout::new();
    fanout.attach(b"slow".to_vec());

    for _ in 0..50 {
        let gen = world.advance_tick().unwrap().clone();
        mailbox.publish_from_tick(gen);
        // Serialization stage never drains — tick still advances.
    }
    assert_eq!(world.last_completed_tick(), 50);
    assert!(mailbox.has_pending());

    // One oversized publish after drain still does not block later ticks.
    let gen = mailbox.take().unwrap();
    fanout
        .publish_to(b"slow", &gen, Some(QUEUE_LIMIT_BYTES + 1))
        .unwrap();
    for _ in 0..50 {
        let gen = world.advance_tick().unwrap().clone();
        mailbox.publish_from_tick(gen);
    }
    assert_eq!(world.last_completed_tick(), 100);
}

#[test]
fn dropped_baseline_resync_preserves_event_stream_and_enqueues() {
    let mut world = World::new(WorldConfig::default());
    let mut fanout = SnapshotFanout::new();
    fanout.attach(b"c1".to_vec());

    world.advance_tick().unwrap();
    let gen = world.published().unwrap().clone();
    let first = fanout.publish_to(b"c1", &gen, None).unwrap();
    let baseline = match first {
        PublishOutcome::FullSnapshot { baseline_id, .. } => baseline_id,
        other => panic!("expected full snapshot, got {other:?}"),
    };

    fanout
        .get_mut(b"c1")
        .unwrap()
        .snapshot
        .expire_baseline(baseline);
    let payload = StubSnapshotPayload::from_generation(&gen);
    let failed = fanout
        .get_mut(b"c1")
        .unwrap()
        .snapshot
        .deliver_delta(Some(baseline), payload)
        .unwrap_err();
    assert_eq!(failed.reason, SnapshotResyncReason::BaselineExpired);
    assert_eq!(
        fanout.get(b"c1").unwrap().snapshot.status(),
        SnapshotStatus::ResyncRequired
    );

    let events_before = fanout.get(b"c1").unwrap().events.clone();
    world.advance_tick().unwrap();
    let gen2 = world.published().unwrap().clone();
    let (new_baseline, _payload, events_after, enqueue) =
        fanout.client_resync(b"c1", &gen2, None).unwrap();
    assert_ne!(new_baseline, baseline);
    assert_eq!(events_after, events_before);
    assert_eq!(enqueue.kind, StateKind::Full);
    assert!(fanout.get(b"c1").unwrap().queue.queued_bytes() > 0);
}

#[test]
fn mismatched_baseline_requires_resync() {
    let mut channel = world_server::SnapshotChannel::new();
    let payload = StubSnapshotPayload {
        generation: 1,
        tick: 1,
        digest: [0; 32],
    };
    channel.install_full(7, payload.clone());
    let err = channel
        .deliver_delta(
            Some(8),
            StubSnapshotPayload {
                generation: 2,
                ..payload
            },
        )
        .unwrap_err();
    assert_eq!(err.reason, SnapshotResyncReason::BaselineMismatched);
    assert_eq!(channel.status(), SnapshotStatus::ResyncRequired);
}

#[test]
fn sustained_overflow_disconnects_on_fortieth_tick() {
    let mut queue = OutboundQueue::new();
    queue
        .enqueue_state(
            QUEUE_LIMIT_BYTES + 1,
            StateKind::Full,
            QUEUE_LIMIT_BYTES + 1,
        )
        .unwrap();

    let mid = queue.observe_ticks(1, OVERFLOW_TICK_OBSERVATIONS - 1);
    assert!(matches!(
        mid,
        ObserveOutcome::Observed {
            over_limit_ticks: 39
        }
    ));
    assert!(!queue.is_closed());

    let closed = queue.observe_at(u64::from(OVERFLOW_TICK_OBSERVATIONS));
    assert_eq!(
        closed,
        ObserveOutcome::Closed {
            reason: ProtocolCloseReason::SustainedOutboundOverflow,
            over_limit_ticks: 40,
        }
    );
    assert!(queue.is_closed());
}

#[test]
fn overflow_counter_resets_at_or_below_limit() {
    let mut queue = OutboundQueue::new();
    queue
        .enqueue_state(
            QUEUE_LIMIT_BYTES + 1,
            StateKind::Full,
            QUEUE_LIMIT_BYTES + 1,
        )
        .unwrap();
    queue.observe_ticks(1, 10);
    assert_eq!(queue.over_limit_ticks(), 10);
    queue.drain_state();
    assert!(matches!(
        queue.observe_at(11),
        ObserveOutcome::Observed {
            over_limit_ticks: 0
        }
    ));
}

#[test]
fn fanout_observe_closes_slow_connection_without_affecting_world() {
    let mut world = World::new(WorldConfig::default());
    let mailbox = PublicationMailbox::new();
    let mut fanout = SnapshotFanout::new();
    fanout.attach(b"slow".to_vec());
    fanout.attach(b"ok".to_vec());

    let gen = world.advance_tick().unwrap().clone();
    mailbox.publish_from_tick(gen);
    let gen = mailbox.take().unwrap();
    fanout
        .publish_to(b"slow", &gen, Some(QUEUE_LIMIT_BYTES + 1))
        .unwrap();
    fanout.publish_to(b"ok", &gen, Some(1024)).unwrap();

    for _ in 0..OVERFLOW_TICK_OBSERVATIONS {
        let gen = world.advance_tick().unwrap().clone();
        let tick = gen.tick;
        mailbox.publish_from_tick(gen);
        let _ = mailbox.take(); // undrained slow queue retained; ok path would drain
        fanout.observe_all_at(tick);
    }
    assert!(fanout.get(b"slow").unwrap().queue.is_closed());
    assert!(!fanout.get(b"ok").unwrap().queue.is_closed());
    assert_eq!(
        world.last_completed_tick(),
        u64::from(OVERFLOW_TICK_OBSERVATIONS) + 1
    );
}

#[test]
fn delta_updates_payload_from_generation() {
    let mut world = World::new(WorldConfig::default());
    let mut fanout = SnapshotFanout::new();
    fanout.attach(b"c1".to_vec());
    let gen1 = world.advance_tick().unwrap().clone();
    fanout.publish_to(b"c1", &gen1, None).unwrap();
    let gen2 = world.advance_tick().unwrap().clone();
    let outcome = fanout.publish_to(b"c1", &gen2, None).unwrap();
    assert!(matches!(outcome, PublishOutcome::Delta { .. }));
    let payload = fanout.get(b"c1").unwrap().snapshot.last_payload().unwrap();
    assert_eq!(payload.generation, gen2.generation);
    assert_eq!(payload.digest, gen2.digest());
}

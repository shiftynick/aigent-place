use super::*;
use crate::demo_activity::{DemoPhase, DemoReason};
use aigent_protocol::{
    shape_node::Primitive, BoxPrimitive, LocalTransform, Quaternion, ShapeNode, Vector3Millimeters,
};

fn shape() -> ShapeSlot {
    ShapeSlot::from_encoded(
        ShapeTree {
            nodes: vec![ShapeNode {
                node_id: 1,
                parent_node_id: 0,
                transform: Some(LocalTransform {
                    translation: Some(Vector3Millimeters {
                        x_mm: 0,
                        y_mm: 0,
                        z_mm: 0,
                    }),
                    rotation: Some(Quaternion {
                        x: 0.0,
                        y: 0.0,
                        z: 0.0,
                        w: 1.0,
                    }),
                }),
                joint_name: None,
                color: None,
                material_tags: vec![],
                primitive: Some(Primitive::Box(BoxPrimitive {
                    size_x_mm: 1000,
                    size_y_mm: 1800,
                    size_z_mm: 1000,
                })),
            }],
        }
        .encode_to_vec(),
    )
}
fn command(world: &mut World, owner: &[u8], sequence: u64, effect: CommandEffect) {
    world
        .enqueue(QueuedCommand {
            arrival_tick: world.next_tick(),
            aigent_id: owner.to_vec(),
            sequence,
            effect,
        })
        .unwrap();
}
fn pair() -> World {
    let mut world = World::ephemeral_demo_activity(WorldConfig::default(), [4; 16]);
    for (owner, x, conn, epoch) in [
        (
            b"a".as_slice(),
            -1.0,
            b"ca".as_slice(),
            b"sess-1".as_slice(),
        ),
        (b"b".as_slice(), 1.0, b"cb".as_slice(), b"sess-2".as_slice()),
    ] {
        command(
            &mut world,
            owner,
            1,
            CommandEffect::CreateAndBindDemoBody {
                aigent_id: owner.to_vec(),
                position: PositionRequest::new(x, 0.9, 0.0),
                shape: shape(),
            },
        );
        assert!(world.attach_demo_participant(owner.to_vec(), conn.to_vec(), epoch.to_vec()));
    }
    world.advance_tick().unwrap();
    assert_eq!(
        world.demo_activity_state().unwrap().phase,
        DemoPhase::Separate
    );
    world
}
#[test]
fn activity_safety_uses_the_published_ruleset_and_recovers_after_restore() {
    let mut world = pair();
    let mut tight = RulesetParameters::catalog_defaults();
    tight.set("shape.max_extent_mm", 1500);
    let tight_id = world.schedule_ruleset(tight.clone()).unwrap();
    let activation = world.rulesets().pending().unwrap().activate_at_tick;
    let generation = world
        .advance_ticks(activation - world.next_tick() + 1)
        .unwrap();
    assert_eq!(generation.ruleset_generation_id, tight_id);
    assert!(generation.active_leases.is_empty());
    assert!(generation
        .entities
        .values()
        .all(|entity| crate::movement::collider_at(entity, &tight).is_err()));
    let state = generation.demo_activity.as_ref().unwrap();
    assert_eq!(state.phase, DemoPhase::Suspended);
    assert_eq!(state.reason, DemoReason::UnsafeGeometry);
    assert_eq!(state.completed_rounds, 0);
    assert!(state.participants.iter().all(|p| p.earned_tick.is_none()));

    let restored_id = world
        .schedule_ruleset(RulesetParameters::catalog_defaults())
        .unwrap();
    let activation = world.rulesets().pending().unwrap().activate_at_tick;
    let generation = world
        .advance_ticks(activation - world.next_tick() + 1)
        .unwrap();
    assert_eq!(generation.ruleset_generation_id, restored_id);
    assert_eq!(
        generation.demo_activity.as_ref().unwrap().phase,
        DemoPhase::Suspended
    );
    world.advance_ticks(18).unwrap();
    assert_eq!(
        world.demo_activity_state().unwrap().phase,
        DemoPhase::Suspended
    );
    world.advance_tick().unwrap();
    let state = world.demo_activity_state().unwrap();
    assert_eq!(state.phase, DemoPhase::Ready);
    assert_eq!(state.completed_rounds, 0);
    assert!(state.participants.iter().all(|p| p.travel_mm == 0));
    world.advance_tick().unwrap();
    assert_eq!(
        world.demo_activity_state().unwrap().phase,
        DemoPhase::Separate
    );
}
fn move_command(
    world: &mut World,
    owner: &[u8],
    sequence: u64,
    target: i64,
    speed: u32,
    ttl_ms: Option<u32>,
) {
    command(
        world,
        owner,
        sequence,
        CommandEffect::UpsertMoveLease {
            body_id: None,
            intent: MoveIntent::new(target, 0, speed).unwrap(),
            ttl_ms,
        },
    );
}
#[test]
fn actual_tick_draft_motion_completes_round_then_fixes_formation_across_rounds() {
    let mut world = pair();
    let anchors = (
        world.demo_activity_state().unwrap().formation_center_mm,
        world.demo_activity_state().unwrap().formation_axis_mm,
    );
    let mut seq = 2;
    let mut completed = 0;
    for _ in 0..350 {
        let phase = world.demo_activity_state().unwrap().phase;
        if matches!(phase, DemoPhase::Separate | DemoPhase::Regroup) {
            let radius = if phase == DemoPhase::Separate {
                3250
            } else {
                1000
            };
            move_command(&mut world, b"a", seq, -radius, 500, None);
            move_command(&mut world, b"b", seq, radius, 900, None);
            seq += 1;
        }
        let gen = world.advance_tick().unwrap();
        let activity = gen.demo_activity.as_ref().unwrap();
        assert_eq!(activity.observed_tick, gen.tick);
        assert_ne!(
            activity.phase,
            DemoPhase::Suspended,
            "{:?}",
            activity.reason
        );
        if activity.completed_rounds > completed {
            assert_eq!(activity.phase, DemoPhase::Complete);
            assert!(activity.participants.iter().all(|p| p.travel_mm == 1000
                && p.contribution_mm >= 1000
                && p.earned_tick.is_some()));
            assert_eq!(activity.dwell_ticks, 8);
            completed = activity.completed_rounds;
        }
        assert_eq!(
            (activity.formation_center_mm, activity.formation_axis_mm),
            anchors
        );
        if completed >= 2 {
            break;
        }
    }
    assert_eq!(
        completed, 2,
        "real movement kernel must produce both earned rounds"
    );
}
#[test]
fn stop_removes_actual_lease_and_earned_proof_waits_five_seconds_for_peer() {
    let mut world = pair();
    let mut sequence = 2;
    while world.demo_activity_state().unwrap().phase == DemoPhase::Separate {
        move_command(&mut world, b"a", sequence, -3250, 900, None);
        move_command(&mut world, b"b", sequence, 3250, 900, None);
        sequence += 1;
        world.advance_tick().unwrap();
    }
    assert_eq!(
        world.demo_activity_state().unwrap().phase,
        DemoPhase::Regroup
    );
    // STOP both at phase entry removes any remaining outward leases. It supplies
    // no inward credit. Then A earns its own fresh inward proof and stops.
    for owner in [b"a".as_slice(), b"b".as_slice()] {
        command(
            &mut world,
            owner,
            sequence,
            CommandEffect::CancelLease { body_id: None },
        );
    }
    sequence += 1;
    world.advance_tick().unwrap();
    while world
        .entities
        .get(world.aigent_bodies[b"a".as_slice()])
        .unwrap()
        .position
        .x()
        < -1.0
    {
        move_command(&mut world, b"a", sequence, -1000, 900, None);
        sequence += 1;
        world.advance_tick().unwrap();
    }
    command(
        &mut world,
        b"a",
        sequence,
        CommandEffect::CancelLease { body_id: None },
    );
    sequence += 1;
    world.advance_tick().unwrap();
    let a = world.body_for_aigent(b"a").unwrap();
    assert!(world.leases.get(a).is_none());
    let earned = world.demo_activity_state().unwrap().participants[0]
        .earned_tick
        .unwrap();
    for _ in 0..100 {
        let g = world.advance_tick().unwrap();
        assert_eq!(
            g.demo_activity.as_ref().unwrap().participants[0].earned_tick,
            Some(earned)
        );
        assert!(g
            .lease_terminations
            .iter()
            .all(|t| t.body_id != a || t.reason != LeaseTerminationReason::Expired));
    }
    while world.demo_activity_state().unwrap().phase == DemoPhase::Regroup {
        move_command(&mut world, b"b", sequence, 1000, 900, None);
        sequence += 1;
        world.advance_tick().unwrap();
    }
    assert_eq!(
        world.demo_activity_state().unwrap().phase,
        DemoPhase::Complete
    );
    assert_eq!(world.demo_activity_state().unwrap().completed_rounds, 1);
}
#[test]
fn pending_activity_is_not_installed_on_journal_admission_failure() {
    let mut world = pair();
    let before = world.demo_activity_state().unwrap().clone();
    let published = world.last_generation().unwrap().clone();
    move_command(&mut world, b"a", 2, -3250, 500, None);
    let pending = world.journal.last_committed().unwrap().clone();
    world.journal_mut().begin(pending).unwrap();
    assert!(world.advance_tick().is_err());
    assert_eq!(world.demo_activity_state(), Some(&before));
    assert_eq!(world.last_generation(), Some(&published));
    world.journal_mut().discard_pending();
    let generation = world.advance_tick().unwrap();
    assert!(generation.demo_activity.as_ref().unwrap().participants[0].travel_mm > 0);
}
#[test]
fn activity_epoch_and_cleanup_guards_suspend_current_attempt_once() {
    let mut world = pair();
    move_command(&mut world, b"a", 2, -3250, 500, None);
    world.advance_tick().unwrap();
    assert!(world.attach_demo_participant(b"a".to_vec(), b"new".to_vec(), b"sess-10".to_vec()));
    assert!(!world.attach_demo_participant(b"a".to_vec(), b"old".to_vec(), b"sess-9".to_vec()));
    assert!(!world.detach_demo_participant(b"a", b"ca", b"sess-1"));
    let g = world.advance_tick().unwrap();
    let activity = g.demo_activity.as_ref().unwrap();
    assert_eq!(activity.reason, DemoReason::SessionChanged);
    assert_eq!(activity.reset_id, 1);
    assert_eq!(activity.completed_rounds, 0);
}
#[test]
fn unused_unbound_hello_cannot_consume_one_of_the_two_presence_slots() {
    let mut world = World::ephemeral_demo_activity(WorldConfig::default(), [2; 16]);
    assert!(!world.attach_demo_participant(
        b"unused".to_vec(),
        b"cunused".to_vec(),
        b"sess-1".to_vec()
    ));
    for (owner, x, conn, epoch) in [
        (
            b"b".as_slice(),
            -1.0,
            b"cb".as_slice(),
            b"sess-2".as_slice(),
        ),
        (b"c".as_slice(), 1.0, b"cc".as_slice(), b"sess-3".as_slice()),
    ] {
        command(
            &mut world,
            owner,
            1,
            CommandEffect::CreateAndBindDemoBody {
                aigent_id: owner.to_vec(),
                position: PositionRequest::new(x, 0.9, 0.0),
                shape: shape(),
            },
        );
        assert!(world.attach_demo_participant(owner.to_vec(), conn.to_vec(), epoch.to_vec()));
    }
    assert_eq!(
        world
            .advance_tick()
            .unwrap()
            .demo_activity
            .as_ref()
            .unwrap()
            .phase,
        DemoPhase::Separate
    );
}
#[test]
fn ordinary_and_plain_plaza_worlds_publish_absence_and_identical_digests() {
    let mut normal = World::new(WorldConfig::default());
    let mut plaza = World::ephemeral_demo_plaza(WorldConfig::default());
    let a = normal.advance_tick().unwrap();
    let b = plaza.advance_tick().unwrap();
    assert!(a.demo_activity.is_none());
    assert!(b.demo_activity.is_none());
    assert_eq!(a.digest(), b.digest());
    assert_eq!(
        hex::encode(a.digest()),
        "ba4bc1360a1798750ab063f3f078bd29b3a12df068e8f1111ffa14460677fc41"
    );
    let mut enabled = World::ephemeral_demo_activity(WorldConfig::default(), [1; 16]);
    let enabled = enabled.advance_tick().unwrap();
    assert!(enabled.demo_activity.is_some());
    assert_ne!(enabled.digest(), a.digest());
}

#[test]
fn actual_outstanding_lease_expiry_suspends_after_movement_before_phase_success() {
    let mut world = pair();
    move_command(&mut world, b"a", 2, -3250, 500, Some(50));
    let first = world.advance_tick().unwrap();
    assert_eq!(
        first.demo_activity.as_ref().unwrap().phase,
        DemoPhase::Separate
    );
    let second = world.advance_tick().unwrap();
    let activity = second.demo_activity.as_ref().unwrap();
    assert_eq!(activity.phase, DemoPhase::Suspended);
    assert_eq!(activity.reason, DemoReason::LeaseInactive);
    assert_eq!(activity.completed_rounds, 0);
    assert!(second
        .lease_terminations
        .iter()
        .any(|t| t.reason == LeaseTerminationReason::Expired));
    assert!(activity
        .participants
        .iter()
        .all(|p| p.earned_tick.is_none() && p.travel_mm == 0));
}

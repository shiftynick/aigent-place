use super::*;

fn bind(id: &[u8], sequence: u64) -> QueuedCommand {
    QueuedCommand {
        arrival_tick: 1,
        aigent_id: id.to_vec(),
        sequence,
        effect: CommandEffect::BindAigentBody {
            aigent_id: id.to_vec(),
            body_id: 99,
        },
    }
}

#[test]
fn plaza_same_batch_capacity_rejects_atomically_before_id_or_clock_mutation() {
    let mut world = World::ephemeral_demo_plaza(WorldConfig::default());
    assert_eq!(
        world.enqueue_batch(vec![bind(b"a", 1), bind(b"b", 1), bind(b"c", 1)]),
        Err(WorldError::DemoBindingCapacityExceeded)
    );
    assert!(world.pending.is_empty());
    assert!(world.aigent_bodies.is_empty());
    assert_eq!(world.entities.next_entity_id(), 1);
    assert_eq!(world.next_tick(), 1);
    assert!(world.journal.last_committed().is_none());
    world
        .enqueue_batch(vec![bind(b"a", 1), bind(b"a", 2), bind(b"b", 1)])
        .unwrap();
    assert_eq!(world.reserved_demo_identities().len(), 2);
    assert_eq!(
        world.enqueue(bind(b"c", 1)),
        Err(WorldError::DemoBindingCapacityExceeded)
    );
    assert_eq!(world.pending.len(), 3);
}

#[test]
fn plaza_defensive_tentative_capacity_counts_union_once() {
    // Defensive fixture only: legitimate marked-memory plaza commits are
    // synchronous and cannot create an in-flight async tentative generation.
    let mut world = World::ephemeral_demo_plaza(WorldConfig::default());
    let mut generation = world.advance_tick().unwrap().clone();
    world.aigent_bodies.insert(b"installed".to_vec(), 1);
    let bindings = BTreeMap::from([(b"installed".to_vec(), 1), (b"tentative".to_vec(), 2)]);
    generation.aigent_bodies = bindings.clone();
    world.tentative = Some(TentativeTick {
        leases: world.leases.clone(),
        entities: world.entities.clone(),
        aigent_bodies: bindings,
        world_value: 0,
        rulesets: world.rulesets.clone(),
        generation,
        demo_activity: world.demo_activity.clone(),
        restored_pending: vec![],
        remaining_pending: vec![],
    });
    assert_eq!(world.reserved_demo_identities().len(), 2);
    assert!(world.demo_binding_capacity_available(b"installed"));
    assert!(world.demo_binding_capacity_available(b"tentative"));
    assert!(!world.demo_binding_capacity_available(b"third"));
    let mut third = bind(b"third", 1);
    third.arrival_tick = 2;
    assert_eq!(
        world.enqueue(third),
        Err(WorldError::DemoBindingCapacityExceeded)
    );
    assert!(world.pending.is_empty());
    assert_eq!(world.next_tick(), 2);
}

#[test]
fn plaza_fixture_binding_misuse_panics_before_mutation() {
    use std::panic::{catch_unwind, AssertUnwindSafe};
    let mut world = World::ephemeral_demo_plaza(WorldConfig::default());
    world.bind_aigent_body_for_test(b"a".to_vec(), 1);
    world.bind_aigent_body_for_test(b"b".to_vec(), 2);
    world.bind_aigent_body_for_test(b"a".to_vec(), 1);
    let before = world.aigent_bodies.clone();
    assert!(catch_unwind(AssertUnwindSafe(
        || world.bind_aigent_body_for_test(b"c".to_vec(), 3)
    ))
    .is_err());
    assert_eq!(world.aigent_bodies, before);
    *world.journal_mut() = DurableJournal::memory();
    assert!(catch_unwind(AssertUnwindSafe(
        || world.bind_aigent_body_for_test(b"a".to_vec(), 4)
    ))
    .is_err());
    assert_eq!(world.aigent_bodies, before);
    assert_eq!(world.entities.next_entity_id(), 1);
    assert_eq!(world.next_tick(), 1);
}

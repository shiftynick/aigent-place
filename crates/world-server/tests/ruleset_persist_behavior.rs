//! Ruleset activation and ordered persistence (task-007).

use world_server::{
    CommandEffect, QueuedCommand, RulesetParameters, RulesetValidationError, World, WorldConfig,
    WorldError,
};

fn bump(arrival: u64, aigent: &[u8], sequence: u64, delta: i64) -> QueuedCommand {
    QueuedCommand {
        arrival_tick: arrival,
        aigent_id: aigent.to_vec(),
        sequence,
        effect: CommandEffect::BumpWorldValue { delta },
    }
}

#[test]
fn invalid_ruleset_rejected_live_unchanged() {
    let mut world = World::new(WorldConfig::default());
    let before = world.rulesets().live().clone();
    let mut bad = RulesetParameters::catalog_defaults();
    bad.set("movement.lease_ttl_ms", 50); // below catalog min
    let err = world.schedule_ruleset(bad).unwrap_err();
    assert!(matches!(
        err,
        WorldError::Ruleset(RulesetValidationError::OutOfRange { .. })
    ));
    assert_eq!(world.rulesets().live(), &before);
    assert!(world.rulesets().pending().is_none());
}

#[test]
fn activation_only_at_tick_boundary_after_soak() {
    let mut world = World::new(WorldConfig::default());
    let live_before = world.rulesets().live().generation_id;
    let mut candidate = RulesetParameters::catalog_defaults();
    candidate.set("movement.lease_ttl_ms", 12_000);
    // soak_delay default is 1 tick from live parameters.
    let pending_id = world.schedule_ruleset(candidate).unwrap();
    assert_eq!(world.rulesets().live().generation_id, live_before);

    // First tick: commands still see old live; pending not yet activated if soak needs 1.
    world.enqueue(bump(1, b"a", 1, 1)).unwrap();
    let gen1 = world.advance_tick().unwrap().clone();
    // activate_at_tick = 0 + 1 = 1, so activation happens at end of tick 1.
    assert_eq!(gen1.ruleset_generation_id, pending_id);
    assert_eq!(world.rulesets().live().generation_id, pending_id);
    assert_eq!(world.rulesets().live().parameters.lease_ttl_ms(), 12_000);
}

#[test]
fn pending_survives_in_committed_journal_until_activation() {
    let mut world = World::new(WorldConfig::default());
    let mut longer = RulesetParameters::catalog_defaults();
    longer.set("governance.soak_delay_ticks", 3);
    longer.set("governance.meta_soak_delay_ticks", 3);
    world.schedule_ruleset(longer).unwrap();
    world.advance_tick().unwrap(); // activates longer soak ruleset at tick 1
    let mut next = RulesetParameters::catalog_defaults();
    next.set("movement.lease_ttl_ms", 15_000);
    next.set("governance.soak_delay_ticks", 3);
    next.set("governance.meta_soak_delay_ticks", 3);
    world.schedule_ruleset(next).unwrap();
    world.advance_tick().unwrap(); // tick 2 < activate_at (1+3=4)
    assert!(world.rulesets().pending().is_some());
    let journal = world.journal().clone();
    let recovered = World::recover_from_journal(WorldConfig::default(), journal).unwrap();
    assert!(recovered.rulesets().pending().is_some());
    assert_eq!(
        recovered.rulesets().live().generation_id,
        world.rulesets().live().generation_id
    );
}

#[test]
fn persist_order_matches_canonical_sim() {
    let mut world = World::new(WorldConfig::default());
    world.enqueue(bump(1, b"b", 1, 10)).unwrap();
    world.enqueue(bump(1, b"a", 2, 100)).unwrap();
    world.enqueue(bump(1, b"a", 1, 1)).unwrap();
    world.advance_tick().unwrap();
    let committed = world.journal().last_committed().unwrap();
    assert_eq!(
        committed.command_summaries,
        vec![
            "bump:delta=1:value=1".to_string(),
            "bump:delta=100:value=101".to_string(),
            "bump:delta=10:value=111".to_string(),
        ]
    );
}

#[test]
fn restart_reconstructs_last_committed_generation() {
    let mut world = World::new(WorldConfig::default());
    world.enqueue(bump(1, b"a", 1, 7)).unwrap();
    world.advance_tick().unwrap();
    world.enqueue(bump(2, b"a", 1, 3)).unwrap();
    world.advance_tick().unwrap();
    assert_eq!(world.world_value(), 10);
    let last = world.journal().last_committed().unwrap().clone();

    // Uncommitted tail must be discarded by recover_from_journal.
    let mut journal = world.journal().clone();
    journal
        .begin(world_server::CommittedGeneration {
            generation: 99,
            world_value: 999,
            ruleset: last.ruleset.clone(),
            pending_ruleset: None,
            command_summaries: vec!["should-discard".into()],
            active_leases: Default::default(),
            integrity_hex: String::new(),
        })
        .unwrap();
    assert!(journal.pending().is_some());

    let recovered = World::recover_from_journal(WorldConfig::default(), journal).unwrap();
    assert!(recovered.journal().pending().is_none());
    assert_eq!(recovered.world_value(), 10);
    assert_eq!(
        recovered.rulesets().live().generation_id,
        last.ruleset.generation_id
    );
    assert_eq!(recovered.last_completed_tick(), 2);
}

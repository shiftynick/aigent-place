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

/// Shape budgets are part of the catalog, so a candidate carrying an
/// out-of-range or cross-field-violating `shape.*` value never becomes live
/// (task-047; `ruleset/v1/CONTRACT.md` section 3).
#[test]
fn shape_budget_candidates_are_range_and_cross_field_checked() {
    let mut world = World::new(WorldConfig::default());
    let before = world.rulesets().live().clone();

    for (path, value) in [
        ("shape.body_max_parts", 257),
        ("shape.body_max_parts", 0),
        ("shape.object_max_parts", 257),
        ("shape.body_max_joints", 257),
        ("shape.object_max_joints", -1),
        ("shape.max_extent_mm", 0),
        ("shape.max_extent_mm", 100_001),
    ] {
        let mut bad = RulesetParameters::catalog_defaults();
        bad.set(path, value);
        assert!(
            matches!(
                world.schedule_ruleset(bad).unwrap_err(),
                WorldError::Ruleset(RulesetValidationError::OutOfRange { .. })
            ),
            "{path}={value} must be out of range"
        );
    }

    for (joints, parts) in [
        ("shape.body_max_joints", "shape.body_max_parts"),
        ("shape.object_max_joints", "shape.object_max_parts"),
    ] {
        let mut bad = RulesetParameters::catalog_defaults();
        bad.set(parts, 8);
        bad.set(joints, 9);
        assert!(
            matches!(
                world.schedule_ruleset(bad).unwrap_err(),
                WorldError::Ruleset(RulesetValidationError::CrossField)
            ),
            "{joints} above {parts} must be a cross-field failure"
        );
    }

    assert_eq!(world.rulesets().live(), &before);
    assert!(world.rulesets().pending().is_none());
}

/// `shape.body_max_parts` and `shape.object_max_parts` are cost-driving terms
/// in the `ruleset/v1/CONTRACT.md` section 4 envelope, whose ceiling equals the
/// formula's value on the default catalog. This server does not yet carry the
/// other terms of that formula, so it must refuse an increase it cannot score
/// rather than let governance raise a server-enforced budget past the
/// constitutional envelope. Decreases stay available (task-047).
#[test]
fn raising_an_envelope_cost_driving_shape_budget_is_refused() {
    let mut world = World::new(WorldConfig::default());
    let before = world.rulesets().live().clone();
    let defaults = RulesetParameters::catalog_defaults();

    for path in ["shape.body_max_parts", "shape.object_max_parts"] {
        let default = defaults.get(path).expect("cost-driving default");

        let mut raised = RulesetParameters::catalog_defaults();
        raised.set(path, default + 1);
        assert!(
            matches!(
                world.schedule_ruleset(raised).unwrap_err(),
                WorldError::Ruleset(RulesetValidationError::CostExceeded)
            ),
            "raising {path} above {default} must fail the envelope check"
        );

        // The same path may still move downward.
        let mut lowered = RulesetParameters::catalog_defaults();
        lowered.set(path, default - 1);
        lowered.set(
            if path == "shape.body_max_parts" {
                "shape.body_max_joints"
            } else {
                "shape.object_max_joints"
            },
            default - 1,
        );
        assert!(
            world.schedule_ruleset(lowered).is_ok(),
            "lowering {path} must remain available"
        );
    }

    assert_eq!(
        world.rulesets().live(),
        &before,
        "no rejected candidate may alter the live generation"
    );
}

/// The section 4 shape term depends on the SUM of the two part budgets, so a
/// trade that leaves the sum unchanged scores identically and must be admitted.
/// `ruleset/v1/CONTRACT.md` section 4 keeps compensating trades legal
/// explicitly; refusing them would be stricter than the constitution
/// (task-047).
#[test]
fn a_compensating_trade_between_part_budgets_is_admitted() {
    let mut world = World::new(WorldConfig::default());
    let defaults = RulesetParameters::catalog_defaults();
    let body = defaults.get("shape.body_max_parts").unwrap();
    let object = defaults.get("shape.object_max_parts").unwrap();

    // Sum preserved: body up one, object down one. Object joints follow object
    // parts down so the documented `joints <= parts` cross-field constraint
    // stays satisfied and cannot mask the envelope outcome.
    let mut traded = RulesetParameters::catalog_defaults();
    traded.set("shape.body_max_parts", body + 1);
    traded.set("shape.object_max_parts", object - 1);
    traded.set("shape.object_max_joints", object - 1);
    assert!(
        world.schedule_ruleset(traded).is_ok(),
        "a sum-preserving trade must be admitted"
    );

    // Sum increased by one: refused.
    let mut over = RulesetParameters::catalog_defaults();
    over.set("shape.body_max_parts", body + 1);
    over.set("shape.object_max_parts", object);
    assert!(
        matches!(
            world.schedule_ruleset(over).unwrap_err(),
            WorldError::Ruleset(RulesetValidationError::CostExceeded)
        ),
        "raising the sum above the default sum must fail the envelope check"
    );
}

/// The live generation carries every shape budget the shape validator reads,
/// so validation never has to fall back to a constant.
#[test]
fn live_generation_carries_every_shape_budget() {
    let world = World::new(WorldConfig::default());
    let live = &world.rulesets().live().parameters;
    for path in [
        "shape.body_max_parts",
        "shape.body_max_joints",
        "shape.object_max_parts",
        "shape.object_max_joints",
        "shape.max_extent_mm",
    ] {
        assert!(live.get(path).is_some(), "{path} missing from live ruleset");
    }
    // Bodies and placed objects are budgeted separately.
    assert_ne!(
        live.get("shape.body_max_parts"),
        live.get("shape.object_max_parts")
    );
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
    let journal = world.journal().as_memory().expect("memory journal").clone();
    let recovered = World::recover_from_memory_journal(WorldConfig::default(), journal).unwrap();
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
    let mut journal = world.journal().as_memory().expect("memory journal").clone();
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

    let recovered = World::recover_from_memory_journal(WorldConfig::default(), journal).unwrap();
    assert!(recovered.journal().pending().is_none());
    assert_eq!(recovered.world_value(), 10);
    assert_eq!(
        recovered.rulesets().live().generation_id,
        last.ruleset.generation_id
    );
    assert_eq!(recovered.last_completed_tick(), 2);
}

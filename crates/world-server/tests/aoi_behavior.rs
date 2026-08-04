//! Interest management and AOI truncation (task-016).

use world_server::{
    aoi_cap_for_role, interest_diff, truncate_nearest, AoiEntity, AoiError, ConnectionRole,
    FocusPoint, SnapshotFanout, SpatialHash, AOI_HARD_CAP,
};

fn entity(id: u64, x: f64, y: f64, z: f64) -> AoiEntity {
    AoiEntity::new(id, x, y, z)
}

#[test]
fn deterministic_membership_and_order_ignore_input_shuffle() {
    let focus = FocusPoint::origin();
    let entities = vec![
        entity(30, 5.0, 0.0, 0.0),
        entity(10, 1.0, 0.0, 0.0),
        entity(20, 3.0, 0.0, 0.0),
        entity(40, 1.0, 0.0, 0.0), // same distance as 10 → tie by id
    ];
    let mut shuffled = entities.clone();
    shuffled.reverse();
    let a = truncate_nearest(&entities, focus, 10).unwrap();
    let b = truncate_nearest(&shuffled, focus, 10).unwrap();
    assert_eq!(a, b);
    assert_eq!(a, vec![10, 40, 20, 30]);
}

#[test]
fn hard_cap_truncates_to_100() {
    let focus = FocusPoint::origin();
    let entities: Vec<_> = (1..=150u64)
        .map(|id| entity(id, f64::from(u32::try_from(id).unwrap()), 0.0, 0.0))
        .collect();
    let kept = truncate_nearest(&entities, focus, AOI_HARD_CAP).unwrap();
    assert_eq!(kept.len(), 100);
    assert_eq!(kept.first(), Some(&1));
    assert_eq!(kept.last(), Some(&100));
}

#[test]
fn viewer_cap_shrinks_while_aigent_stays_hard_cap() {
    assert_eq!(aoi_cap_for_role(ConnectionRole::Aigent, 25), AOI_HARD_CAP);
    assert_eq!(aoi_cap_for_role(ConnectionRole::Viewer, 25), 25);
    let focus = FocusPoint::origin();
    let entities: Vec<_> = (1..=80u64)
        .map(|id| entity(id, f64::from(u32::try_from(id).unwrap()), 0.0, 0.0))
        .collect();
    let viewer = truncate_nearest(
        &entities,
        focus,
        aoi_cap_for_role(ConnectionRole::Viewer, 25),
    )
    .unwrap();
    let aigent = truncate_nearest(
        &entities,
        focus,
        aoi_cap_for_role(ConnectionRole::Aigent, 25),
    )
    .unwrap();
    assert_eq!(viewer.len(), 25);
    assert_eq!(aigent.len(), 80);
}

#[test]
fn empty_interest_set() {
    let kept = truncate_nearest(&[], FocusPoint::origin(), AOI_HARD_CAP).unwrap();
    assert!(kept.is_empty());
    let mut hash = SpatialHash::new(10.0);
    let kept = hash.nearest(FocusPoint::origin(), AOI_HARD_CAP).unwrap();
    assert!(kept.is_empty());
    assert_eq!(hash.last_entities_examined(), 0);
}

#[test]
fn duplicate_ids_rejected() {
    let entities = vec![entity(1, 0.0, 0.0, 0.0), entity(1, 1.0, 0.0, 0.0)];
    let err = truncate_nearest(&entities, FocusPoint::origin(), 10).unwrap_err();
    assert_eq!(err, AoiError::DuplicateEntityId { id: 1 });
}

#[test]
fn boundary_movement_updates_enter_leave() {
    let entities = vec![
        entity(1, 0.0, 0.0, 0.0),
        entity(2, 2.0, 0.0, 0.0),
        entity(3, 4.0, 0.0, 0.0),
        entity(4, 6.0, 0.0, 0.0),
    ];
    let before = truncate_nearest(&entities, FocusPoint::new(0.0, 0.0, 0.0), 2).unwrap();
    assert_eq!(before, vec![1, 2]);
    let after = truncate_nearest(&entities, FocusPoint::new(6.0, 0.0, 0.0), 2).unwrap();
    assert_eq!(after, vec![4, 3]);
    let diff = interest_diff(&before, &after);
    assert_eq!(diff.enter, vec![3, 4]);
    assert_eq!(diff.leave, vec![1, 2]);
    assert!(diff.retained.is_empty());
}

#[test]
fn dense_population_spatial_gather_is_bounded() {
    let mut hash = SpatialHash::new(5.0);
    // 20k entities on a line; focus near origin should not examine the far tail.
    for id in 1..=20_000u64 {
        hash.insert(entity(id, id as f64, 0.0, 0.0));
    }
    let kept = hash.nearest(FocusPoint::origin(), AOI_HARD_CAP).unwrap();
    assert_eq!(kept.len(), 100);
    assert_eq!(kept.first(), Some(&1));
    assert_eq!(kept.last(), Some(&100));
    assert!(
        hash.last_entities_examined() < 5_000,
        "examined {} entities (expected bounded gather)",
        hash.last_entities_examined()
    );
    assert_eq!(
        hash.last_cells_probed(),
        hash.last_cells_visited(),
        "occupied-only gather should not probe empty cells"
    );
    assert!(
        hash.last_cells_probed() < 500,
        "probed {} occupied cells",
        hash.last_cells_probed()
    );
}

#[test]
fn hard_cap_clamps_oversized_request() {
    let focus = FocusPoint::origin();
    let entities: Vec<_> = (1..=150u64)
        .map(|id| entity(id, f64::from(u32::try_from(id).unwrap()), 0.0, 0.0))
        .collect();
    let kept = truncate_nearest(&entities, focus, 250).unwrap();
    assert_eq!(kept.len(), 100);
}

#[test]
fn spatial_finds_distant_entity_from_far_focus_cell() {
    let mut hash = SpatialHash::new(10.0);
    hash.insert(entity(7, 1005.0, 0.0, 0.0));
    let kept = hash.nearest(FocusPoint::origin(), 1).unwrap();
    assert_eq!(kept, vec![7]);
}

#[test]
fn spatial_equal_distance_tie_does_not_early_stop_incorrectly() {
    let mut hash = SpatialHash::new(10.0);
    hash.insert(entity(10, 0.0, 0.0, 0.0));
    hash.insert(entity(1, 10.0, 0.0, 0.0));
    let kept = hash.nearest(FocusPoint::new(5.0, 0.0, 0.0), 1).unwrap();
    assert_eq!(kept, vec![1], "equal-distance tie must prefer lower id");
}

#[test]
fn spatial_off_center_focus_does_not_skip_nearer_neighbor() {
    let mut hash = SpatialHash::new(10.0);
    // Focus near the +x face of cell 0; nearer neighbor is just across the boundary.
    for id in 1..=100u64 {
        hash.insert(entity(id, 5.0, 0.0, 0.0));
    }
    hash.insert(entity(999, 10.05, 0.0, 0.0));
    let kept = hash
        .nearest(FocusPoint::new(9.9, 0.0, 0.0), AOI_HARD_CAP)
        .unwrap();
    assert_eq!(kept.len(), 100);
    assert!(kept.contains(&999), "nearer boundary neighbor must survive");
}

#[test]
fn fanout_refresh_interest_tracks_enter_leave() {
    let mut fanout = SnapshotFanout::new();
    fanout.attach(b"c1".to_vec());
    {
        let conn = fanout.get_mut(b"c1").unwrap();
        conn.role = ConnectionRole::Aigent;
        conn.focus = FocusPoint::origin();
    }
    let entities = vec![
        entity(1, 0.0, 0.0, 0.0),
        entity(2, 2.0, 0.0, 0.0),
        entity(3, 50.0, 0.0, 0.0),
    ];
    let (first, diff1) = fanout.refresh_interest(b"c1", &entities).unwrap().unwrap();
    assert_eq!(first, vec![1, 2, 3]);
    assert_eq!(diff1.enter, vec![1, 2, 3]);

    let moved = vec![
        entity(1, 0.0, 0.0, 0.0),
        entity(2, 2.0, 0.0, 0.0),
        entity(4, 1.0, 0.0, 0.0),
    ];
    {
        let conn = fanout.get_mut(b"c1").unwrap();
        conn.viewer_aoi_cap = 2;
        conn.role = ConnectionRole::Viewer;
    }
    let (second, diff2) = fanout.refresh_interest(b"c1", &moved).unwrap().unwrap();
    assert_eq!(second, vec![1, 4]);
    assert_eq!(diff2.enter, vec![4]);
    assert_eq!(diff2.leave, vec![2, 3]);
}

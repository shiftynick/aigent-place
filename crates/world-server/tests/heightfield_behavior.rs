//! Heightfield sampling, cell selection, and grounding (task-049).
//!
//! Expectations come from ADR-0003 and `world/v1/CONTRACT.md` sections 3.3,
//! 3.4, and 5. Procedural samples are generated; persistence/edits are out of
//! scope.

use aigent_protocol::{
    shape_node::Primitive, BoxPrimitive, LocalTransform, Quaternion, ShapeNode, ShapeTree,
    Vector3Millimeters,
};
use std::collections::BTreeSet;
use world_server::{
    derive_collider, sample_height_mm, CellCoord, Heightfield, HeightfieldError, WorldPointMm,
    CHUNK_SIZE_MM, GENERATED_HEIGHT_MAX_MM, GENERATED_HEIGHT_MIN_MM, HEIGHTFIELD_GENERATOR_VERSION,
    HEIGHTFIELD_MAX_SELECTED_CELLS, WORLD_BOUND_MM,
};

fn identity() -> Quaternion {
    Quaternion {
        x: 0.0,
        y: 0.0,
        z: 0.0,
        w: 1.0,
    }
}

fn box_shape(size_x_mm: i64, size_y_mm: i64, size_z_mm: i64) -> ShapeTree {
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
                rotation: Some(identity()),
            }),
            joint_name: None,
            color: None,
            material_tags: Vec::new(),
            primitive: Some(Primitive::Box(BoxPrimitive {
                size_x_mm,
                size_y_mm,
                size_z_mm,
            })),
        }],
    }
}

fn seed(byte: u8) -> [u8; 32] {
    [byte; 32]
}

#[test]
fn known_sample_vector_is_deterministic_and_repeated() {
    let s = seed(0xA5);
    assert_eq!(HEIGHTFIELD_GENERATOR_VERSION, 1);
    assert_eq!(
        std::str::from_utf8(world_server::HEIGHTFIELD_GENERATOR_DOMAIN).expect("utf8"),
        "aigent.place/heightfield/sample/v1"
    );
    let cases = [
        (0_i64, 0_i64, 3739_i64),
        (1, -1, -1890),
        (-64, 0, 7608),
        (64, 0, 2146),
        (12_345, -67_890, 4683),
        (-1, 1, 1782),
        (100, -100, 8155),
        (-1000, 1000, -341),
        (7, -3, 3732),
        (-42, 42, 3937),
    ];
    for &(x, z, expected) in &cases {
        let h = sample_height_mm(&s, x, z);
        assert!((GENERATED_HEIGHT_MIN_MM..=GENERATED_HEIGHT_MAX_MM).contains(&h));
        assert_eq!(h, expected, "frozen sample ({x},{z})");
        assert_eq!(h, sample_height_mm(&s, x, z));
    }
}

#[test]
fn adjacent_chunk_seams_share_exact_samples_positive_and_negative() {
    let hf = Heightfield::new(seed(0x11), 1000).expect("config");
    for &(cx_a, cx_b, seam_sample_x) in &[(-1_i32, 0_i32, 0_i64), (0, 1, 64), (-2, -1, -64)] {
        let a = hf.chunk_view(cx_a, 0).expect("chunk a");
        let b = hf.chunk_view(cx_b, 0).expect("chunk b");
        assert_eq!(
            a.first_global_sample_x() + (CHUNK_SIZE_MM / 1000),
            seam_sample_x
        );
        assert_eq!(b.first_global_sample_x(), seam_sample_x);
        for local_z in [0_i64, 1, 17, 64] {
            let ha = a
                .sample_at_local(a.samples_per_axis() - 1, local_z)
                .expect("a");
            let hb = b.sample_at_local(0, local_z).expect("b");
            assert_eq!(ha, hb, "seam x={seam_sample_x} local_z={local_z}");
            assert_eq!(ha, hf.sample_height_mm(seam_sample_x, local_z));
        }
    }
}

#[test]
fn invalid_cell_sizes_fail_closed() {
    assert!(matches!(
        Heightfield::new(seed(1), 0),
        Err(HeightfieldError::InvalidCellSize { .. })
    ));
    assert!(matches!(
        Heightfield::new(seed(1), -64),
        Err(HeightfieldError::InvalidCellSize { .. })
    ));
    assert!(matches!(
        Heightfield::new(seed(1), 3000),
        Err(HeightfieldError::CellSizeNotChunkDivisor { .. })
    ));
}

#[test]
fn terrain_column_lower_bound_and_top_is_max_of_corners() {
    let hf = Heightfield::new(seed(0x42), 1000).expect("config");
    let mut found = false;
    for x in -16..16 {
        for z in -16..16 {
            let corners = [
                hf.sample_height_mm(x, z),
                hf.sample_height_mm(x + 1, z),
                hf.sample_height_mm(x, z + 1),
                hf.sample_height_mm(x + 1, z + 1),
            ];
            let max = *corners.iter().max().expect("corners");
            let sum: i64 = corners.iter().sum();
            let avg = sum / 4;
            let chosen_corner = corners[1];
            if max != avg && max != chosen_corner {
                let col = hf.terrain_column(x, z).expect("column");
                assert_eq!(col.lower_y_mm(), -WORLD_BOUND_MM);
                assert_eq!(col.top_y_mm(), max);
                assert_ne!(col.top_y_mm(), avg);
                assert_ne!(col.top_y_mm(), chosen_corner);
                assert_eq!(col.min_x_mm(), x * 1000);
                assert_eq!(col.max_x_mm(), (x + 1) * 1000);
                found = true;
                break;
            }
        }
        if found {
            break;
        }
    }
    assert!(found, "probe window lacked a max≠average/corner cell");
}

#[test]
fn footprint_selection_respects_half_open_edges_and_negative_coords() {
    let hf = Heightfield::new(seed(2), 1000).expect("config");
    // Box 500×500×500 centred so footprint is exactly one cell when interior,
    // and straddles a negative seam when translated.
    let shape = box_shape(500, 500, 500);

    // Interior of cell (0,0): centre at (250, y, 250) → footprint [0,500]².
    let t = WorldPointMm::new(250.0, 0.0, 250.0).expect("t");
    let collider = derive_collider(&shape, t).expect("collider");
    let cells = hf.select_cells_for_collider(&collider).expect("cells");
    assert_eq!(cells, vec![CellCoord { x: 0, z: 0 }]);

    // Touching the positive edge of cell (0,0) from the right with positive
    // area only in cell (1,0): centre x=1250 → footprint [1000,1500].
    let t = WorldPointMm::new(1250.0, 0.0, 250.0).expect("t");
    let collider = derive_collider(&shape, t).expect("collider");
    let cells = hf.select_cells_for_collider(&collider).expect("cells");
    assert_eq!(cells, vec![CellCoord { x: 1, z: 0 }]);

    // Negative coordinates across x=0 and z=0 seams.
    let t = WorldPointMm::new(-100.0, 0.0, -100.0).expect("t");
    let collider = derive_collider(&shape, t).expect("collider");
    let cells = hf.select_cells_for_collider(&collider).expect("cells");
    let set: BTreeSet<_> = cells.iter().copied().collect();
    assert_eq!(
        set,
        BTreeSet::from([
            CellCoord { x: -1, z: -1 },
            CellCoord { x: -1, z: 0 },
            CellCoord { x: 0, z: -1 },
            CellCoord { x: 0, z: 0 },
        ])
    );
    assert!(cells.windows(2).all(|w| w[0] <= w[1]), "canonical order");
}

#[test]
fn chunk_seam_and_world_boundary_ownership() {
    let hf = Heightfield::new(seed(3), 1000).expect("config");
    let shape = box_shape(200, 200, 200);

    // Straddle the 64 m chunk seam at x=0 (sample/cell edge).
    let t = WorldPointMm::new(0.0, 0.0, 100.0).expect("t");
    let collider = derive_collider(&shape, t).expect("collider");
    let cells = hf.select_cells_for_collider(&collider).expect("cells");
    let set: BTreeSet<_> = cells.iter().copied().collect();
    assert!(set.contains(&CellCoord { x: -1, z: 0 }));
    assert!(set.contains(&CellCoord { x: 0, z: 0 }));

    // +WORLD_BOUND ownership: footprint ending at +W selects the last cell.
    let half = 100.0;
    let t = WorldPointMm::new(WORLD_BOUND_MM as f64 - half, 0.0, 0.0).expect("t");
    let collider = derive_collider(&shape, t).expect("collider");
    let cells = hf.select_cells_for_collider(&collider).expect("cells");
    let last = WORLD_BOUND_MM / 1000 - 1;
    assert!(
        cells.iter().any(|c| c.x == last),
        "expected last cell {last}, got {cells:?}"
    );
    let col = hf.terrain_column(last, 0).expect("column");
    assert_eq!(col.max_x_mm(), WORLD_BOUND_MM);
}

#[test]
fn cell_size_chunk_divisor_not_world_bound_clips_boundary_columns() {
    // 64_000 divides CHUNK_SIZE_MM but not WORLD_BOUND_MM, so the last/first
    // columns must clip to ±W rather than an exact cell edge.
    let cell = 64_000_i64;
    assert_eq!(CHUNK_SIZE_MM % cell, 0);
    assert_ne!(WORLD_BOUND_MM % cell, 0);
    let hf = Heightfield::new(seed(4), cell).expect("config");
    let shape = box_shape(200, 200, 200);
    let w = WORLD_BOUND_MM as f64;

    let t = WorldPointMm::new(w - 100.0, 0.0, 32_000.0).expect("t+");
    let collider = derive_collider(&shape, t).expect("collider+");
    let fp = collider.horizontal_footprint();
    assert_eq!(fp.min_x(), w - 200.0);
    assert_eq!(fp.max_x(), w);
    let cells = hf.select_cells_for_collider(&collider).expect("cells+");
    assert!(!cells.is_empty());
    assert!(
        cells.iter().all(|c| c.x == 1562),
        "expected only x=1562, got {cells:?}"
    );
    let col = hf.terrain_column(1562, 0).expect("col+");
    assert_eq!(col.max_x_mm(), WORLD_BOUND_MM);
    assert_eq!(col.min_x_mm(), 99_968_000);

    let t = WorldPointMm::new(-w + 100.0, 0.0, 32_000.0).expect("t-");
    let collider = derive_collider(&shape, t).expect("collider-");
    let fp = collider.horizontal_footprint();
    assert_eq!(fp.min_x(), -w);
    assert_eq!(fp.max_x(), -w + 200.0);
    let cells = hf.select_cells_for_collider(&collider).expect("cells-");
    assert!(!cells.is_empty());
    assert!(
        cells.iter().all(|c| c.x == -1563),
        "expected only x=-1563, got {cells:?}"
    );
    let col = hf.terrain_column(-1563, 0).expect("col-");
    assert_eq!(col.min_x_mm(), -WORLD_BOUND_MM);
    assert_eq!(col.max_x_mm(), -99_968_000);
}

#[test]
fn shuffled_source_order_cannot_change_candidate_set_or_support() {
    let hf = Heightfield::new(seed(0x55), 1000).expect("config");
    // Find two adjacent cells with different column tops.
    let mut pair = None;
    for x in 0..40 {
        for z in 0..40 {
            let a = hf.terrain_column(x, z).expect("a").top_y_mm();
            let b = hf.terrain_column(x + 1, z).expect("b").top_y_mm();
            if a != b {
                pair = Some((x, z, a.max(b)));
                break;
            }
        }
        if pair.is_some() {
            break;
        }
    }
    let (x, z, expected_support) = pair.expect("adjacent unequal tops");

    // Footprint spanning both cells: 1500 mm wide box centred on the shared edge.
    let shape = box_shape(1500, 1000, 500);
    let cx = (x + 1) as f64 * 1000.0;
    let cz = z as f64 * 1000.0 + 250.0;
    let translation = WorldPointMm::new(cx, 5000.0, cz).expect("t");
    let collider = derive_collider(&shape, translation).expect("collider");

    let cells_a = hf.select_cells_for_collider(&collider).expect("cells");
    let mut cells_b = cells_a.clone();
    cells_b.reverse();
    assert_ne!(cells_a, cells_b);
    let set_a: BTreeSet<_> = cells_a.iter().copied().collect();
    let set_b: BTreeSet<_> = cells_b.iter().copied().collect();
    assert_eq!(set_a, set_b);

    let grounded = hf.ground(&collider, translation).expect("ground");
    assert_eq!(grounded.support_top_mm(), expected_support);
    assert_eq!(
        grounded.selected_cells(),
        cells_a.as_slice(),
        "grounding must use canonical enumeration order"
    );
    // Re-ground; support must be invariant.
    let grounded2 = hf.ground(&collider, translation).expect("ground2");
    assert_eq!(grounded.support_top_mm(), grounded2.support_top_mm());
    assert_eq!(grounded.translation(), grounded2.translation());
}

#[test]
fn grounding_uses_max_support_preserves_xz_and_sets_lower_face() {
    let hf = Heightfield::new(seed(0x77), 1000).expect("config");
    let mut found = None;
    for x in 0..50 {
        for z in 0..50 {
            let t0 = hf.terrain_column(x, z).expect("t0").top_y_mm();
            let t1 = hf.terrain_column(x + 1, z).expect("t1").top_y_mm();
            if t0 != t1 {
                found = Some((x, z, t0.max(t1), (t0 + t1) / 2));
                break;
            }
        }
        if found.is_some() {
            break;
        }
    }
    let (x, z, max_top, avg_top) = found.expect("non-flat pair");
    assert_ne!(max_top, avg_top);

    let shape = box_shape(1500, 1000, 400);
    let translation =
        WorldPointMm::new((x + 1) as f64 * 1000.0, 12_345.5, z as f64 * 1000.0 + 200.0).expect("t");
    let x_bits = translation.x().to_bits();
    let z_bits = translation.z().to_bits();
    let collider = derive_collider(&shape, translation).expect("collider");
    let result = hf.ground(&collider, translation).expect("ground");

    assert_eq!(result.support_top_mm(), max_top);
    assert_ne!(result.support_top_mm(), avg_top);
    assert_eq!(result.translation().x().to_bits(), x_bits);
    assert_eq!(result.translation().z().to_bits(), z_bits);

    // Lower face of the grounded aggregate equals support exactly.
    let grounded_collider =
        derive_collider(&shape, result.translation()).expect("grounded collider");
    assert_eq!(
        grounded_collider.aggregate().min().y().to_bits(),
        (max_top as f64).to_bits()
    );
}

#[test]
fn flat_one_cell_grounding_and_out_of_world_failure() {
    let hf = Heightfield::new(seed(0x10), 1000).expect("config");
    let shape = box_shape(200, 200, 200);
    let translation = WorldPointMm::new(100.0, 0.0, 100.0).expect("t");
    let collider = derive_collider(&shape, translation).expect("collider");
    let cells = hf.select_cells_for_collider(&collider).expect("cells");
    assert_eq!(cells.len(), 1);
    let top = hf
        .terrain_column(cells[0].x, cells[0].z)
        .expect("col")
        .top_y_mm();
    let result = hf.ground(&collider, translation).expect("ground");
    assert_eq!(result.support_top_mm(), top);
    assert_eq!(result.selected_cells().len(), 1);

    // Degenerate zero-area footprint via a zero-width... boxes cannot be zero
    // size; instead request an out-of-world translation path through selection
    // by constructing a collider near the bound and manually checking OutOfWorld
    // via a span that exceeds +W (derive_collider stays in-world). Use a box
    // centred past the bound — derive may succeed if extents stay inside? The
    // entity translation itself must stay in world for WorldPointMm, but the
    // aggregate can be checked: place centre so max_x > WORLD_BOUND.
    // Shape validation is not applied here; derive_collider only checks finite.
    let huge = box_shape(4_000, 200, 200);
    let t = WorldPointMm::new(WORLD_BOUND_MM as f64 - 100.0, 0.0, 0.0).expect("t");
    let collider = derive_collider(&huge, t).expect("collider");
    let fp = collider.horizontal_footprint();
    assert!(fp.max_x() > WORLD_BOUND_MM as f64);
    assert!(matches!(
        hf.select_cells(fp),
        Err(HeightfieldError::OutOfWorld { .. })
    ));
}

#[test]
fn candidate_limit_fails_closed_without_silent_truncation() {
    // cell_size=1 mm with a footprint large enough to exceed the safety cap.
    let hf = Heightfield::new(seed(0x01), 1).expect("config");
    // Cap is 1_048_576. A square of side > sqrt(cap) cells exceeds it.
    // sqrt(1_048_576)=1024. Use 1025×1025 mm box → 1025² cells.
    let side = 1025_i64;
    assert!(side * side > HEIGHTFIELD_MAX_SELECTED_CELLS as i64);
    let shape = box_shape(side, 10, side);
    let translation = WorldPointMm::new(10_000.0, 0.0, 10_000.0).expect("t");
    let collider = derive_collider(&shape, translation).expect("collider");
    let err = hf
        .select_cells_for_collider(&collider)
        .expect_err("must exceed cap");
    assert!(
        matches!(
            err,
            HeightfieldError::CandidateLimitExceeded { limit, .. } if limit == HEIGHTFIELD_MAX_SELECTED_CELLS
        ),
        "unexpected error: {err:?}"
    );
}

#[test]
fn mutation_guard_max_support_and_half_open_are_observable() {
    let hf = Heightfield::new(seed(0x99), 1000).expect("config");

    // Half-open: a footprint with min_x exactly on a cell edge must not include
    // the previous cell.
    let shape = box_shape(500, 100, 500);
    let t = WorldPointMm::new(1250.0, 0.0, 250.0).expect("t");
    let collider = derive_collider(&shape, t).expect("collider");
    let cells = hf.select_cells_for_collider(&collider).expect("cells");
    assert!(
        !cells.iter().any(|c| c.x == 0),
        "closed-edge regression would include cell 0: {cells:?}"
    );
    assert!(cells.iter().any(|c| c.x == 1));

    // Max-support: spanning unequal tops must not rest on the lower column.
    let mut pair = None;
    for x in 0..60 {
        for z in 0..60 {
            let lo = hf.terrain_column(x, z).unwrap().top_y_mm();
            let hi = hf.terrain_column(x + 1, z).unwrap().top_y_mm();
            if hi > lo {
                pair = Some((x, z, lo, hi));
                break;
            }
        }
        if pair.is_some() {
            break;
        }
    }
    let (x, z, lower, higher) = pair.expect("hi>lo pair");
    let shape = box_shape(1500, 800, 300);
    let translation =
        WorldPointMm::new((x + 1) as f64 * 1000.0, 0.0, z as f64 * 1000.0 + 150.0).expect("t");
    let collider = derive_collider(&shape, translation).expect("collider");
    let result = hf.ground(&collider, translation).expect("ground");
    assert_eq!(result.support_top_mm(), higher);
    assert_ne!(result.support_top_mm(), lower);
}

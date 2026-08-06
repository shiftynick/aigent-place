//! The Rust `shape.*` catalog agrees with the normative ruleset contract
//! (task-047).
//!
//! `crates/world-server/src/ruleset.rs` transcribes the `shape.*` catalog rows
//! from `ruleset/v1/CONTRACT.md`, and `docs/ENGINEERING-STANDARDS.md` requires
//! one source of truth per fact. This test removes the transcription from the
//! trust base: it parses the contract's own parameter table at compile time and
//! derives every expected range boundary and default from it, so editing the
//! contract without editing the Rust catalog fails here rather than drifting
//! silently.
//!
//! Only the five `shape.*` paths are covered, because those are the rows this
//! task introduced; extending the same protection to the rest of the catalog is
//! filed separately.

use world_server::{
    validate_candidate, RulesetParameters, RulesetValidationError, ShapeBudgets, ShapeClass,
    ShapeRejection,
};

/// The normative contract, embedded so the assertions below cannot drift from
/// the document they claim to encode.
const CONTRACT: &str = include_str!("../../../ruleset/v1/CONTRACT.md");

const SHAPE_PATHS: [&str; 5] = [
    "shape.body_max_parts",
    "shape.body_max_joints",
    "shape.object_max_parts",
    "shape.object_max_joints",
    "shape.max_extent_mm",
];

/// One catalog row as the contract states it.
#[derive(Debug, PartialEq, Eq)]
struct CatalogRow {
    low: i64,
    high: i64,
    default: i64,
}

/// Parse `| `path` | int | LOW..HIGH | DEFAULT | ... |` out of the section 3
/// table. Panics rather than skipping, so a table reformat surfaces as a test
/// failure instead of a vacuous pass.
fn contract_row(path: &str) -> CatalogRow {
    let needle = format!("| `{path}` |");
    let line = CONTRACT
        .lines()
        .find(|line| line.starts_with(&needle))
        .unwrap_or_else(|| panic!("no catalog row for {path} in ruleset/v1/CONTRACT.md"));
    let cells: Vec<&str> = line.split('|').map(str::trim).collect();
    // cells[0] is empty (leading pipe): path, type, range, default, meta, migration.
    assert_eq!(cells[2], "int", "{path} is expected to be an integer row");
    let (low, high) = cells[3]
        .split_once("..")
        .unwrap_or_else(|| panic!("unparsable range for {path}: {:?}", cells[3]));
    CatalogRow {
        low: low.parse().expect("range low"),
        high: high.parse().expect("range high"),
        default: cells[4].parse().expect("default"),
    }
}

/// Catalog defaults must equal the contract's stated defaults.
#[test]
fn catalog_defaults_match_the_contract() {
    let defaults = RulesetParameters::catalog_defaults();
    for path in SHAPE_PATHS {
        let row = contract_row(path);
        assert_eq!(
            defaults.get(path),
            Some(row.default),
            "{path} default must match ruleset/v1/CONTRACT.md"
        );
    }
    assert_eq!(
        validate_candidate(&defaults),
        Ok(()),
        "the default catalog must itself be a legal candidate"
    );
}

/// Each range boundary the contract states must be accepted, and each value one
/// step outside it must be rejected as out of range.
#[test]
fn catalog_range_boundaries_match_the_contract() {
    for path in SHAPE_PATHS {
        let row = contract_row(path);

        for outside in [row.low - 1, row.high + 1] {
            let mut candidate = RulesetParameters::catalog_defaults();
            candidate.set(path, outside);
            relax_cross_fields(&mut candidate, path, outside);
            assert!(
                matches!(
                    validate_candidate(&candidate),
                    Err(RulesetValidationError::OutOfRange { path: ref failed }) if failed == path
                ),
                "{path}={outside} is outside {}..{} and must reject as OutOfRange",
                row.low,
                row.high
            );
        }

        // Both documented boundaries are inside the range and so must never be
        // reported as out of range. A high boundary may still be refused by the
        // section 4 envelope check, which is a different, correct outcome — so
        // this asserts the absence of `OutOfRange` specifically rather than
        // overall acceptance. Lowering a Rust catalog maximum by one would make
        // the contract's own high boundary report `OutOfRange` and fail here.
        for boundary in [row.low, row.high] {
            let mut candidate = RulesetParameters::catalog_defaults();
            candidate.set(path, boundary);
            relax_cross_fields(&mut candidate, path, boundary);
            assert!(
                !matches!(
                    validate_candidate(&candidate),
                    Err(RulesetValidationError::OutOfRange { .. })
                ),
                "{path}={boundary} is a contract boundary and must be in range"
            );
        }
    }
}

/// `ShapeBudgets::from_ruleset` re-checks the catalog ranges independently of
/// `validate_candidate`, so its copy of the limits must accept the contract's
/// own boundaries too. Without this, the read-side limits could drift below the
/// contract while the write-side stayed correct.
#[test]
fn shape_budgets_accept_the_contract_boundaries() {
    for class in [ShapeClass::Body, ShapeClass::Object] {
        for extreme in [
            contract_row("shape.max_extent_mm").low,
            contract_row("shape.max_extent_mm").high,
        ] {
            let mut parameters = RulesetParameters::catalog_defaults();
            parameters.set("shape.max_extent_mm", extreme);
            let budgets = ShapeBudgets::from_ruleset(&parameters, class)
                .unwrap_or_else(|error| panic!("extent {extreme} for {class:?}: {error:?}"));
            assert_eq!(budgets.max_extent_mm(), extreme);
        }

        let (parts_path, joints_path) = match class {
            ShapeClass::Body => ("shape.body_max_parts", "shape.body_max_joints"),
            ShapeClass::Object => ("shape.object_max_parts", "shape.object_max_joints"),
        };
        let parts_high = contract_row(parts_path).high;
        let joints_high = contract_row(joints_path).high;

        let mut parameters = RulesetParameters::catalog_defaults();
        parameters.set(parts_path, parts_high);
        parameters.set(joints_path, joints_high);
        let budgets = ShapeBudgets::from_ruleset(&parameters, class)
            .unwrap_or_else(|error| panic!("{parts_path} high boundary: {error:?}"));
        assert_eq!(budgets.max_parts(), parts_high as u32);
        assert_eq!(budgets.max_joints(), joints_high as u32);

        // One step outside the contract range must be refused on the read side
        // as well, so a grandfathered generation cannot smuggle in an unbounded
        // budget. The *reason* is asserted, not merely the refusal: an
        // out-of-catalog value is `InvalidBudgetParameter` naming the offending
        // path and value, which is a materially different report from
        // `MissingBudgetParameter` for a generation that omits the path
        // entirely. An `is_err()` assertion here would let the two reject
        // classes collapse into one without any test noticing.
        let mut beyond = RulesetParameters::catalog_defaults();
        beyond.set(parts_path, parts_high + 1);
        assert_eq!(
            ShapeBudgets::from_ruleset(&beyond, class),
            Err(ShapeRejection::InvalidBudgetParameter {
                path: parts_path,
                value: parts_high + 1,
            }),
            "{parts_path}={} must be refused on the read side by path and value",
            parts_high + 1
        );

        // The same class of defect on a different path must name that path, so
        // the reported `path` tracks the parameter that actually failed rather
        // than being fixed to whichever one `from_ruleset` reads first.
        let extent_low = contract_row("shape.max_extent_mm").low;
        let mut under = RulesetParameters::catalog_defaults();
        under.set("shape.max_extent_mm", extent_low - 1);
        assert_eq!(
            ShapeBudgets::from_ruleset(&under, class),
            Err(ShapeRejection::InvalidBudgetParameter {
                path: "shape.max_extent_mm",
                value: extent_low - 1,
            })
        );
    }
}

/// Keep the two documented `shape.*` cross-field constraints satisfied so a
/// range assertion cannot be masked by an unrelated cross-field failure. Zero
/// joints satisfies `joints <= parts` for every legal part count.
fn relax_cross_fields(candidate: &mut RulesetParameters, path: &str, _value: i64) {
    match path {
        "shape.body_max_parts" => candidate.set("shape.body_max_joints", 0),
        "shape.object_max_parts" => candidate.set("shape.object_max_joints", 0),
        _ => {}
    }
}

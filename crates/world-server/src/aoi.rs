//! Area-of-interest truncation (workload §5 / ADR-0006).
//!
//! Nearest-first Euclidean truncation with a hard cap of 100. Aigent caps stay
//! at the hard cap; viewer caps may shrink under degradation policy.

use crate::session::ConnectionRole;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

/// Hard maximum entities in any connection interest set.
pub const AOI_HARD_CAP: u32 = 100;

/// Undegraded → mild → severe viewer AOI caps (workload degradation ladder).
pub const VIEWER_AOI_CAPS: [u32; 3] = [100, 50, 25];

/// Connection focus point in canonical world metres (`f64`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FocusPoint {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl FocusPoint {
    #[must_use]
    pub const fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }

    #[must_use]
    pub const fn origin() -> Self {
        Self::new(0.0, 0.0, 0.0)
    }
}

/// Candidate entity origin for interest ranking.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AoiEntity {
    pub id: u64,
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl AoiEntity {
    #[must_use]
    pub const fn new(id: u64, x: f64, y: f64, z: f64) -> Self {
        Self { id, x, y, z }
    }

    #[must_use]
    pub fn distance_squared_to(&self, focus: FocusPoint) -> f64 {
        let dx = self.x - focus.x;
        let dy = self.y - focus.y;
        let dz = self.z - focus.z;
        dx * dx + dy * dy + dz * dz
    }
}

/// Errors from interest-set construction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AoiError {
    DuplicateEntityId { id: u64 },
    ZeroCap,
}

impl std::fmt::Display for AoiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DuplicateEntityId { id } => write!(f, "duplicate entity.id {id}"),
            Self::ZeroCap => write!(f, "aoi cap must be positive"),
        }
    }
}

impl std::error::Error for AoiError {}

/// Active AOI cap for a connection role under a viewer policy cap.
#[must_use]
pub fn aoi_cap_for_role(role: ConnectionRole, viewer_aoi_cap: u32) -> u32 {
    match role {
        ConnectionRole::Aigent => AOI_HARD_CAP,
        ConnectionRole::Viewer => viewer_aoi_cap.min(AOI_HARD_CAP),
    }
}

fn chebyshev(a: (i64, i64, i64), b: (i64, i64, i64)) -> i64 {
    (a.0 - b.0)
        .abs()
        .max((a.1 - b.1).abs())
        .max((a.2 - b.2).abs())
}

fn clamp_aoi_cap(cap: u32) -> Result<u32, AoiError> {
    if cap == 0 {
        return Err(AoiError::ZeroCap);
    }
    Ok(cap.min(AOI_HARD_CAP))
}

/// Nearest-first truncation matching `scripts/workload-contract.mjs` `truncateAoi`.
///
/// Returns ordered survivor entity IDs (nearest first; ties by ascending id).
pub fn truncate_nearest(
    entities: &[AoiEntity],
    focus: FocusPoint,
    cap: u32,
) -> Result<Vec<u64>, AoiError> {
    let cap = clamp_aoi_cap(cap)?;
    let mut seen = HashSet::with_capacity(entities.len());
    let mut ranked: Vec<(u64, f64)> = Vec::with_capacity(entities.len());
    for entity in entities {
        if !seen.insert(entity.id) {
            return Err(AoiError::DuplicateEntityId { id: entity.id });
        }
        ranked.push((entity.id, entity.distance_squared_to(focus)));
    }
    ranked.sort_by(|left, right| {
        if left.1 < right.1 {
            std::cmp::Ordering::Less
        } else if left.1 > right.1 {
            std::cmp::Ordering::Greater
        } else {
            left.0.cmp(&right.0)
        }
    });
    Ok(ranked
        .into_iter()
        .take(cap as usize)
        .map(|(id, _)| id)
        .collect())
}

/// Diff two ordered interest sets into enter/leave membership changes.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct InterestDiff {
    pub enter: Vec<u64>,
    pub leave: Vec<u64>,
    pub retained: Vec<u64>,
}

#[must_use]
pub fn interest_diff(previous: &[u64], next: &[u64]) -> InterestDiff {
    let prev: BTreeSet<u64> = previous.iter().copied().collect();
    let nxt: BTreeSet<u64> = next.iter().copied().collect();
    InterestDiff {
        enter: nxt.difference(&prev).copied().collect(),
        leave: prev.difference(&nxt).copied().collect(),
        retained: nxt.intersection(&prev).copied().collect(),
    }
}

/// Uniform spatial hash for dense candidate gather (AOI only; not collision).
#[derive(Debug, Clone)]
pub struct SpatialHash {
    cell_size: f64,
    cells: HashMap<(i64, i64, i64), Vec<AoiEntity>>,
    /// Instrumentation: cells visited by the last `nearest` query.
    last_cells_visited: usize,
    /// Instrumentation: entities examined by the last `nearest` query.
    last_entities_examined: usize,
    /// Instrumentation: Chebyshev cells probed (including empty) last query.
    last_cells_probed: usize,
}

impl SpatialHash {
    #[must_use]
    pub fn new(cell_size: f64) -> Self {
        assert!(cell_size > 0.0, "cell_size must be positive");
        Self {
            cell_size,
            cells: HashMap::new(),
            last_cells_visited: 0,
            last_entities_examined: 0,
            last_cells_probed: 0,
        }
    }

    #[must_use]
    pub fn last_cells_visited(&self) -> usize {
        self.last_cells_visited
    }

    #[must_use]
    pub fn last_entities_examined(&self) -> usize {
        self.last_entities_examined
    }

    #[must_use]
    pub fn last_cells_probed(&self) -> usize {
        self.last_cells_probed
    }

    pub fn clear(&mut self) {
        self.cells.clear();
        self.last_cells_visited = 0;
        self.last_entities_examined = 0;
        self.last_cells_probed = 0;
    }

    pub fn insert(&mut self, entity: AoiEntity) {
        let key = self.cell_key(entity.x, entity.y, entity.z);
        self.cells.entry(key).or_default().push(entity);
    }

    pub fn insert_all(&mut self, entities: impl IntoIterator<Item = AoiEntity>) {
        for entity in entities {
            self.insert(entity);
        }
    }

    /// Gather nearest survivors under `cap` with expanding ring search.
    ///
    /// Occupied cells are grouped by Chebyshev distance from the focus cell so
    /// empty space is never probed. Early-stop uses the minimum distance from
    /// the focus to the exterior of the visited cell AABB.
    pub fn nearest(&mut self, focus: FocusPoint, cap: u32) -> Result<Vec<u64>, AoiError> {
        let cap = clamp_aoi_cap(cap)?;
        if self.cells.is_empty() {
            self.last_cells_visited = 0;
            self.last_entities_examined = 0;
            self.last_cells_probed = 0;
            return Ok(Vec::new());
        }

        let focus_cell = self.cell_key(focus.x, focus.y, focus.z);
        let mut by_ring: BTreeMap<i64, Vec<(i64, i64, i64)>> = BTreeMap::new();
        for &cell in self.cells.keys() {
            let ring = chebyshev(focus_cell, cell);
            by_ring.entry(ring).or_default().push(cell);
        }

        let mut candidates: BTreeMap<u64, AoiEntity> = BTreeMap::new();
        let mut cells_visited = 0usize;
        let mut cells_probed = 0usize;
        let mut entities_examined = 0usize;

        for (ring, cells) in by_ring {
            for cell in cells {
                cells_probed = cells_probed.saturating_add(1);
                let Some(bucket) = self.cells.get(&cell) else {
                    continue;
                };
                cells_visited = cells_visited.saturating_add(1);
                for entity in bucket {
                    entities_examined = entities_examined.saturating_add(1);
                    if candidates.insert(entity.id, *entity).is_some() {
                        return Err(AoiError::DuplicateEntityId { id: entity.id });
                    }
                }
            }
            if candidates.len() >= cap as usize {
                let list: Vec<AoiEntity> = candidates.values().copied().collect();
                let truncated = truncate_nearest(&list, focus, cap)?;
                if let Some(farthest_id) = truncated.last().copied() {
                    let farthest = candidates.get(&farthest_id).expect("survivor");
                    let farthest_dist = farthest.distance_squared_to(focus).sqrt();
                    let covered = self.min_dist_outside_visited_aabb(focus, focus_cell, ring);
                    if covered > farthest_dist {
                        self.last_cells_visited = cells_visited;
                        self.last_entities_examined = entities_examined;
                        self.last_cells_probed = cells_probed;
                        return Ok(truncated);
                    }
                }
            }
        }

        let list: Vec<AoiEntity> = candidates.values().copied().collect();
        self.last_cells_visited = cells_visited;
        self.last_entities_examined = entities_examined;
        self.last_cells_probed = cells_probed;
        truncate_nearest(&list, focus, cap)
    }

    fn cell_key(&self, x: f64, y: f64, z: f64) -> (i64, i64, i64) {
        (
            (x / self.cell_size).floor() as i64,
            (y / self.cell_size).floor() as i64,
            (z / self.cell_size).floor() as i64,
        )
    }

    /// Minimum distance from focus to outside the visited Chebyshev AABB.
    fn min_dist_outside_visited_aabb(
        &self,
        focus: FocusPoint,
        focus_cell: (i64, i64, i64),
        ring: i64,
    ) -> f64 {
        let (cx, cy, cz) = focus_cell;
        let min_x = (cx - ring) as f64 * self.cell_size;
        let max_x = (cx + ring + 1) as f64 * self.cell_size;
        let min_y = (cy - ring) as f64 * self.cell_size;
        let max_y = (cy + ring + 1) as f64 * self.cell_size;
        let min_z = (cz - ring) as f64 * self.cell_size;
        let max_z = (cz + ring + 1) as f64 * self.cell_size;
        let dx = (focus.x - min_x).min(max_x - focus.x);
        let dy = (focus.y - min_y).min(max_y - focus.y);
        let dz = (focus.z - min_z).min(max_z - focus.z);
        dx.min(dy).min(dz).max(0.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hard_cap_constant_matches_workload() {
        assert_eq!(AOI_HARD_CAP, 100);
        assert_eq!(VIEWER_AOI_CAPS, [100, 50, 25]);
    }

    #[test]
    fn role_caps() {
        assert_eq!(aoi_cap_for_role(ConnectionRole::Aigent, 25), AOI_HARD_CAP);
        assert_eq!(aoi_cap_for_role(ConnectionRole::Viewer, 25), 25);
        assert_eq!(aoi_cap_for_role(ConnectionRole::Viewer, 200), AOI_HARD_CAP);
    }
}

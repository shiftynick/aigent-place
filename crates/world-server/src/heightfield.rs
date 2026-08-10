//! Deterministic heightfield sampling, terrain columns, cell selection, and
//! grounding.
//!
//! Implements ADR-0003 and `world/v1/CONTRACT.md` sections 3.3, 3.4, and 5
//! (generation / pure geometry only). Chunk persistence, height edits,
//! movement sweep, broadphase integration, and entity mutation are out of
//! scope for this module.
//!
//! # Units and coordinates
//!
//! - Horizontal lattice spacing and sample heights are signed integer
//!   millimetres (`i64`).
//! - Chunk size is [`CHUNK_SIZE_MM`] (64 m). Global sample and cell indices are
//!   signed; world hard bounds use [`crate::shape::WORLD_BOUND_MM`].
//! - Entity footprints and translations remain millimetre `f64` values from the
//!   collider module. Within `±WORLD_BOUND_MM` every integer millimetre cell
//!   edge is exactly representable in IEEE-754 binary64.
//!
//! # Cell ownership and selection
//!
//! Cells are half-open on positive `x` and `z` edges: cell `(cx, cz)` owns
//! `[cx·s, (cx+1)·s) × [cz·s, (cz+1)·s)` except a cell that touches
//! `+WORLD_BOUND_MM` also owns that boundary for point classification.
//! Column AABBs use closed horizontal faces at those edges so adjacent columns
//! share a legal face contact without positive-volume overlap.
//!
//! A footprint selects every cell with strictly positive horizontal
//! intersection. Enumeration order is ascending `cell_x`, then ascending
//! `cell_z`. Span bounds are compared against exact `f64` products of integer
//! cell edges (no epsilon; no lossy rounding of the footprint into integers).
//!
//! # Procedural generation
//!
//! [`sample_height_mm`] is a pure function of `(world_seed, sample_x, sample_z)`.
//! The HMAC-SHA256 message is domain-separated and versioned; sample
//! coordinates are encoded as big-endian `i64`. Amplitude is confined to
//! [`GENERATED_HEIGHT_MIN_MM`]..=[`GENERATED_HEIGHT_MAX_MM`]. Adjacent chunk
//! views share border sample coordinates and therefore identical heights.
//!
//! # Safety bound
//!
//! Candidate enumeration fails closed with
//! [`HeightfieldError::CandidateLimitExceeded`] when the selected cell count
//! would exceed [`HEIGHTFIELD_MAX_SELECTED_CELLS`]. The constitution does not
//! yet publish a numeric workload cap for this surface; the constant is an
//! explicit implementation safety limit, not silent truncation.

use crate::collider::{Collider, HorizontalFootprint, WorldPointMm};
use crate::shape::WORLD_BOUND_MM;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::fmt;

type HmacSha256 = Hmac<Sha256>;

/// Horizontal extent of one chunk in millimetres (64 m).
pub const CHUNK_SIZE_MM: i64 = 64_000;

/// Procedural heightfield generator contract version embedded in every sample
/// hash message.
pub const HEIGHTFIELD_GENERATOR_VERSION: u16 = 1;

/// Domain separator (UTF-8) for procedural sample hashing.
pub const HEIGHTFIELD_GENERATOR_DOMAIN: &[u8] = b"aigent.place/heightfield/sample/v1";

/// Inclusive minimum height produced by [`sample_height_mm`] (millimetres).
pub const GENERATED_HEIGHT_MIN_MM: i64 = -8_192;

/// Inclusive maximum height produced by [`sample_height_mm`] (millimetres).
pub const GENERATED_HEIGHT_MAX_MM: i64 = 8_191;

/// Maximum cells one footprint selection may return.
///
/// Legal divisors of [`CHUNK_SIZE_MM`] include 1 mm, which can invent
/// astronomical candidate rectangles inside the world bound. This cap fails
/// closed instead of allocating unbounded memory.
pub const HEIGHTFIELD_MAX_SELECTED_CELLS: usize = 1_048_576;

const GENERATED_HEIGHT_SPAN: u64 = (GENERATED_HEIGHT_MAX_MM - GENERATED_HEIGHT_MIN_MM + 1) as u64;

/// Validated heightfield cell size.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HeightfieldConfig {
    cell_size_mm: i64,
}

impl HeightfieldConfig {
    /// Validate a constitutional `heightfield_cell_size_mm`.
    ///
    /// # Errors
    ///
    /// Returns [`HeightfieldError::InvalidCellSize`] when `cell_size_mm` is not
    /// strictly positive, or [`HeightfieldError::CellSizeNotChunkDivisor`] when
    /// it does not exactly divide [`CHUNK_SIZE_MM`].
    pub fn new(cell_size_mm: i64) -> Result<Self, HeightfieldError> {
        if cell_size_mm <= 0 {
            return Err(HeightfieldError::InvalidCellSize { cell_size_mm });
        }
        if CHUNK_SIZE_MM % cell_size_mm != 0 {
            return Err(HeightfieldError::CellSizeNotChunkDivisor { cell_size_mm });
        }
        Ok(Self { cell_size_mm })
    }

    #[must_use]
    pub const fn cell_size_mm(self) -> i64 {
        self.cell_size_mm
    }
}

/// Procedural heightfield: validated cell size plus world seed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Heightfield {
    seed: [u8; 32],
    config: HeightfieldConfig,
}

impl Heightfield {
    /// Construct a heightfield from a 32-byte world seed and cell size.
    ///
    /// # Errors
    ///
    /// Propagates [`HeightfieldConfig::new`] failures.
    pub fn new(seed: [u8; 32], cell_size_mm: i64) -> Result<Self, HeightfieldError> {
        Ok(Self {
            seed,
            config: HeightfieldConfig::new(cell_size_mm)?,
        })
    }

    #[must_use]
    pub fn seed(&self) -> &[u8; 32] {
        &self.seed
    }

    #[must_use]
    pub const fn config(&self) -> HeightfieldConfig {
        self.config
    }

    #[must_use]
    pub const fn cell_size_mm(&self) -> i64 {
        self.config.cell_size_mm
    }

    /// Pure deterministic sample height at global lattice coordinates.
    #[must_use]
    pub fn sample_height_mm(&self, global_sample_x: i64, global_sample_z: i64) -> i64 {
        sample_height_mm(&self.seed, global_sample_x, global_sample_z)
    }

    /// Lazy immutable view of one chunk's sample lattice (no eager full grid).
    ///
    /// # Errors
    ///
    /// Returns [`HeightfieldError::ChunkOriginOverflow`] when
    /// `chunk · CHUNK_SIZE_MM` overflows `i64`.
    pub fn chunk_view(
        &self,
        chunk_x: i32,
        chunk_z: i32,
    ) -> Result<ChunkSampleView<'_>, HeightfieldError> {
        let origin_x_mm = checked_chunk_origin_mm(chunk_x)?;
        let origin_z_mm = checked_chunk_origin_mm(chunk_z)?;
        let cell = self.cell_size_mm();
        // `cell` divides `CHUNK_SIZE_MM`, so origins are exact multiples.
        let first_sample_x = origin_x_mm / cell;
        let first_sample_z = origin_z_mm / cell;
        let samples_per_axis = (CHUNK_SIZE_MM / cell) + 1;
        Ok(ChunkSampleView {
            heightfield: self,
            chunk_x,
            chunk_z,
            first_sample_x,
            first_sample_z,
            samples_per_axis,
        })
    }

    /// Build the conservative terrain column for one global cell.
    ///
    /// # Errors
    ///
    /// Fails when cell horizontal bounds overflow or lie entirely outside the
    /// closed world interval on either axis.
    pub fn terrain_column(
        &self,
        cell_x: i64,
        cell_z: i64,
    ) -> Result<TerrainColumn, HeightfieldError> {
        let cell = CellCoord {
            x: cell_x,
            z: cell_z,
        };
        let (min_x_mm, max_x_mm) = cell_horizontal_bounds(cell_x, self.cell_size_mm())?;
        let (min_z_mm, max_z_mm) = cell_horizontal_bounds(cell_z, self.cell_size_mm())?;
        let corners = [
            self.sample_height_mm(cell_x, cell_z),
            self.sample_height_mm(cell_x + 1, cell_z),
            self.sample_height_mm(cell_x, cell_z + 1),
            self.sample_height_mm(cell_x + 1, cell_z + 1),
        ];
        let top_y_mm = corners.into_iter().max().expect("four corners");
        Ok(TerrainColumn {
            cell,
            min_x_mm,
            max_x_mm,
            min_z_mm,
            max_z_mm,
            lower_y_mm: -WORLD_BOUND_MM,
            top_y_mm,
        })
    }

    /// Enumerate cells with strictly positive horizontal intersection.
    ///
    /// Order: ascending `cell_x`, then ascending `cell_z`.
    ///
    /// # Errors
    ///
    /// Fail-closed on non-finite / out-of-world footprints, empty or zero-area
    /// footprints, integer overflow, or candidate counts above
    /// [`HEIGHTFIELD_MAX_SELECTED_CELLS`].
    pub fn select_cells(
        &self,
        footprint: HorizontalFootprint,
    ) -> Result<Vec<CellCoord>, HeightfieldError> {
        let (x0, x1) = cell_index_range(footprint.min_x(), footprint.max_x(), self.cell_size_mm())?;
        let (z0, z1) = cell_index_range(footprint.min_z(), footprint.max_z(), self.cell_size_mm())?;
        let x_count = checked_inclusive_count(x0, x1)?;
        let z_count = checked_inclusive_count(z0, z1)?;
        let total = x_count
            .checked_mul(z_count)
            .ok_or(HeightfieldError::IntegerOverflow {
                context: "selected cell count",
            })?;
        if total > HEIGHTFIELD_MAX_SELECTED_CELLS {
            return Err(HeightfieldError::CandidateLimitExceeded {
                count: total,
                limit: HEIGHTFIELD_MAX_SELECTED_CELLS,
            });
        }
        let mut out = Vec::with_capacity(total);
        let mut x = x0;
        loop {
            let mut z = z0;
            loop {
                out.push(CellCoord { x, z });
                if z == z1 {
                    break;
                }
                z += 1;
            }
            if x == x1 {
                break;
            }
            x += 1;
        }
        debug_assert_eq!(out.len(), total);
        Ok(out)
    }

    /// [`select_cells`] over a collider's aggregate horizontal footprint.
    pub fn select_cells_for_collider(
        &self,
        collider: &Collider,
    ) -> Result<Vec<CellCoord>, HeightfieldError> {
        self.select_cells(collider.horizontal_footprint())
    }

    /// Ground a collider at `translation` onto this heightfield.
    ///
    /// Selects intersected columns, takes the greatest column top, and returns
    /// a new translation whose Y changes by `support_top - aggregate.min.y`
    /// while X/Z stay bit-identical to `translation`. Inputs are not mutated.
    ///
    /// # Errors
    ///
    /// Propagates selection / column failures, reports
    /// [`HeightfieldError::NoTerrainContact`] when no cell is selected, or
    /// [`HeightfieldError::NonFiniteCoordinate`] when Y arithmetic is unsafe.
    pub fn ground(
        &self,
        collider: &Collider,
        translation: WorldPointMm,
    ) -> Result<GroundingResult, HeightfieldError> {
        let cells = self.select_cells_for_collider(collider)?;
        if cells.is_empty() {
            return Err(HeightfieldError::NoTerrainContact);
        }

        let mut support_top_mm = i64::MIN;
        let mut support_cell = cells[0];
        for cell in &cells {
            let column = self.terrain_column(cell.x, cell.z)?;
            if column.top_y_mm > support_top_mm
                || (column.top_y_mm == support_top_mm
                    && (column.cell.x, column.cell.z) < (support_cell.x, support_cell.z))
            {
                support_top_mm = column.top_y_mm;
                support_cell = column.cell;
            }
        }

        let aggregate_min_y = collider.aggregate().min().y();
        let support_top_f64 = i64_to_exact_f64(support_top_mm)?;
        let delta_y = checked_f64_sub(support_top_f64, aggregate_min_y)?;
        let new_y = checked_f64_add(translation.y(), delta_y)?;

        // Preserve X/Z bit-identically (including signed zero).
        let grounded = WorldPointMm::new(
            f64::from_bits(translation.x().to_bits()),
            new_y,
            f64::from_bits(translation.z().to_bits()),
        )
        .map_err(|_| HeightfieldError::NonFiniteCoordinate {
            context: "grounded translation",
        })?;
        debug_assert_eq!(grounded.x().to_bits(), translation.x().to_bits());
        debug_assert_eq!(grounded.z().to_bits(), translation.z().to_bits());

        Ok(GroundingResult {
            translation: grounded,
            support_top_mm,
            support_cell,
            selected_cells: cells,
        })
    }
}

/// Pure deterministic sample height (millimetres) for a world seed and global
/// lattice coordinates.
///
/// Encoding: `HMAC-SHA256(world_seed, domain || version_be_u16 || x_be_i64 ||
/// z_be_i64)`, then the first eight digest bytes as a big-endian `u64` mapped
/// into [`GENERATED_HEIGHT_MIN_MM`]..=[`GENERATED_HEIGHT_MAX_MM`]. The span
/// divides `2^64`, so reduction is exact and uniform.
#[must_use]
pub fn sample_height_mm(world_seed: &[u8; 32], global_sample_x: i64, global_sample_z: i64) -> i64 {
    let mut message = Vec::with_capacity(HEIGHTFIELD_GENERATOR_DOMAIN.len() + 2 + 8 + 8);
    message.extend_from_slice(HEIGHTFIELD_GENERATOR_DOMAIN);
    message.extend_from_slice(&HEIGHTFIELD_GENERATOR_VERSION.to_be_bytes());
    message.extend_from_slice(&global_sample_x.to_be_bytes());
    message.extend_from_slice(&global_sample_z.to_be_bytes());

    let mut mac =
        HmacSha256::new_from_slice(world_seed).expect("HMAC-SHA256 accepts any key length");
    mac.update(&message);
    let digest: [u8; 32] = mac.finalize().into_bytes().into();
    let raw = u64::from_be_bytes(digest[0..8].try_into().expect("8 bytes"));
    // Span is 2^14 and divides 2^64.
    debug_assert_eq!(u64::MAX % GENERATED_HEIGHT_SPAN, GENERATED_HEIGHT_SPAN - 1);
    GENERATED_HEIGHT_MIN_MM + (raw % GENERATED_HEIGHT_SPAN) as i64
}

/// Global signed cell coordinates on the heightfield lattice.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CellCoord {
    pub x: i64,
    pub z: i64,
}

/// Conservative terrain-column AABB derived from one cell's four corners.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TerrainColumn {
    cell: CellCoord,
    min_x_mm: i64,
    max_x_mm: i64,
    min_z_mm: i64,
    max_z_mm: i64,
    lower_y_mm: i64,
    top_y_mm: i64,
}

impl TerrainColumn {
    #[must_use]
    pub const fn cell(self) -> CellCoord {
        self.cell
    }

    #[must_use]
    pub const fn min_x_mm(self) -> i64 {
        self.min_x_mm
    }

    /// Closed horizontal maximum on `x` (neighbour face contact edge, or
    /// `+WORLD_BOUND_MM` when clipped).
    #[must_use]
    pub const fn max_x_mm(self) -> i64 {
        self.max_x_mm
    }

    #[must_use]
    pub const fn min_z_mm(self) -> i64 {
        self.min_z_mm
    }

    #[must_use]
    pub const fn max_z_mm(self) -> i64 {
        self.max_z_mm
    }

    /// Always `-WORLD_BOUND_MM`.
    #[must_use]
    pub const fn lower_y_mm(self) -> i64 {
        self.lower_y_mm
    }

    /// Maximum of the four global corner sample heights.
    #[must_use]
    pub const fn top_y_mm(self) -> i64 {
        self.top_y_mm
    }
}

/// Lazy chunk-local sample accessor. Border samples use global coordinates so
/// adjacent chunks agree without storing a dense lattice.
#[derive(Debug, Clone, Copy)]
pub struct ChunkSampleView<'a> {
    heightfield: &'a Heightfield,
    chunk_x: i32,
    chunk_z: i32,
    first_sample_x: i64,
    first_sample_z: i64,
    samples_per_axis: i64,
}

impl ChunkSampleView<'_> {
    #[must_use]
    pub const fn chunk_x(self) -> i32 {
        self.chunk_x
    }

    #[must_use]
    pub const fn chunk_z(self) -> i32 {
        self.chunk_z
    }

    /// Inclusive sample count along each axis (`CHUNK_SIZE/cell + 1`).
    #[must_use]
    pub const fn samples_per_axis(self) -> i64 {
        self.samples_per_axis
    }

    #[must_use]
    pub const fn first_global_sample_x(self) -> i64 {
        self.first_sample_x
    }

    #[must_use]
    pub const fn first_global_sample_z(self) -> i64 {
        self.first_sample_z
    }

    /// Map a local lattice index to a global sample coordinate.
    ///
    /// # Errors
    ///
    /// Returns [`HeightfieldError::LocalSampleOutOfRange`] when the index is
    /// outside `0..samples_per_axis`, or
    /// [`HeightfieldError::IntegerOverflow`] on checked addition overflow.
    pub fn global_sample_coord(
        &self,
        local_x: i64,
        local_z: i64,
    ) -> Result<(i64, i64), HeightfieldError> {
        if local_x < 0
            || local_z < 0
            || local_x >= self.samples_per_axis
            || local_z >= self.samples_per_axis
        {
            return Err(HeightfieldError::LocalSampleOutOfRange {
                local_x,
                local_z,
                samples_per_axis: self.samples_per_axis,
            });
        }
        let global_x =
            self.first_sample_x
                .checked_add(local_x)
                .ok_or(HeightfieldError::IntegerOverflow {
                    context: "local to global sample x",
                })?;
        let global_z =
            self.first_sample_z
                .checked_add(local_z)
                .ok_or(HeightfieldError::IntegerOverflow {
                    context: "local to global sample z",
                })?;
        Ok((global_x, global_z))
    }

    /// Sample height at a local lattice index.
    pub fn sample_at_local(&self, local_x: i64, local_z: i64) -> Result<i64, HeightfieldError> {
        let (gx, gz) = self.global_sample_coord(local_x, local_z)?;
        Ok(self.heightfield.sample_height_mm(gx, gz))
    }
}

/// Authoritative grounding outcome (pure; no entity mutation).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroundingResult {
    translation: WorldPointMm,
    support_top_mm: i64,
    support_cell: CellCoord,
    selected_cells: Vec<CellCoord>,
}

impl GroundingResult {
    /// Grounded entity translation (X/Z bit-identical to the input).
    #[must_use]
    pub fn translation(&self) -> WorldPointMm {
        self.translation
    }

    /// Greatest selected column top (millimetres).
    #[must_use]
    pub fn support_top_mm(&self) -> i64 {
        self.support_top_mm
    }

    /// Cell that supplied [`Self::support_top_mm`] (lowest `(x,z)` on ties).
    #[must_use]
    pub fn support_cell(&self) -> CellCoord {
        self.support_cell
    }

    /// Selected cells in canonical ascending `(cell_x, cell_z)` order.
    #[must_use]
    pub fn selected_cells(&self) -> &[CellCoord] {
        &self.selected_cells
    }
}

/// Closed set of heightfield / grounding failures.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HeightfieldError {
    InvalidCellSize {
        cell_size_mm: i64,
    },
    CellSizeNotChunkDivisor {
        cell_size_mm: i64,
    },
    ChunkOriginOverflow {
        chunk: i32,
    },
    LocalSampleOutOfRange {
        local_x: i64,
        local_z: i64,
        samples_per_axis: i64,
    },
    NonFiniteCoordinate {
        context: &'static str,
    },
    OutOfWorld {
        context: &'static str,
    },
    EmptyFootprint,
    NoTerrainContact,
    IntegerOverflow {
        context: &'static str,
    },
    CandidateLimitExceeded {
        count: usize,
        limit: usize,
    },
    CellOutOfWorld {
        axis_index: i64,
    },
}

impl fmt::Display for HeightfieldError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidCellSize { cell_size_mm } => {
                write!(f, "heightfield cell size {cell_size_mm} must be positive")
            }
            Self::CellSizeNotChunkDivisor { cell_size_mm } => write!(
                f,
                "heightfield cell size {cell_size_mm} must exactly divide {CHUNK_SIZE_MM}"
            ),
            Self::ChunkOriginOverflow { chunk } => {
                write!(f, "chunk origin overflow for chunk index {chunk}")
            }
            Self::LocalSampleOutOfRange {
                local_x,
                local_z,
                samples_per_axis,
            } => write!(
                f,
                "local sample ({local_x},{local_z}) outside 0..{samples_per_axis}"
            ),
            Self::NonFiniteCoordinate { context } => {
                write!(f, "non-finite heightfield coordinate: {context}")
            }
            Self::OutOfWorld { context } => {
                write!(f, "heightfield coordinate outside world bound: {context}")
            }
            Self::EmptyFootprint => write!(f, "footprint has no positive horizontal area"),
            Self::NoTerrainContact => write!(f, "no terrain cells under footprint"),
            Self::IntegerOverflow { context } => {
                write!(f, "heightfield integer overflow: {context}")
            }
            Self::CandidateLimitExceeded { count, limit } => write!(
                f,
                "heightfield candidate count {count} exceeds safety limit {limit}"
            ),
            Self::CellOutOfWorld { axis_index } => {
                write!(
                    f,
                    "terrain cell axis index {axis_index} is outside the world"
                )
            }
        }
    }
}

impl std::error::Error for HeightfieldError {}

fn checked_chunk_origin_mm(chunk: i32) -> Result<i64, HeightfieldError> {
    i64::from(chunk)
        .checked_mul(CHUNK_SIZE_MM)
        .ok_or(HeightfieldError::ChunkOriginOverflow { chunk })
}

/// Closed horizontal bounds for a cell on one axis, clipped to the world.
fn cell_horizontal_bounds(cell: i64, cell_size_mm: i64) -> Result<(i64, i64), HeightfieldError> {
    let min = cell
        .checked_mul(cell_size_mm)
        .ok_or(HeightfieldError::IntegerOverflow {
            context: "cell minimum edge",
        })?;
    let exclusive_max = cell
        .checked_add(1)
        .and_then(|v| v.checked_mul(cell_size_mm))
        .ok_or(HeightfieldError::IntegerOverflow {
            context: "cell exclusive maximum edge",
        })?;
    let clipped_min = min.max(-WORLD_BOUND_MM);
    let clipped_max = exclusive_max.min(WORLD_BOUND_MM);
    if clipped_min >= clipped_max {
        return Err(HeightfieldError::CellOutOfWorld { axis_index: cell });
    }
    Ok((clipped_min, clipped_max))
}

/// Inclusive cell-index range for a closed footprint span with positive length.
///
/// Half-open positive edges: a span selects cell `i` iff `hi > i·s` and
/// `lo < (i+1)·s`, using exact `f64` edge products. When `hi == +WORLD_BOUND_MM`
/// and that bound is an exact multiple of `s`, the last in-world cell still
/// matches because `i_max = W/s - 1` satisfies `i·s < W`.
fn cell_index_range(lo: f64, hi: f64, cell_size_mm: i64) -> Result<(i64, i64), HeightfieldError> {
    if !lo.is_finite() || !hi.is_finite() {
        return Err(HeightfieldError::NonFiniteCoordinate {
            context: "footprint span",
        });
    }
    let lo = if lo == 0.0 { 0.0 } else { lo };
    let hi = if hi == 0.0 { 0.0 } else { hi };
    if hi <= lo {
        return Err(HeightfieldError::EmptyFootprint);
    }
    let bound = i64_to_exact_f64(WORLD_BOUND_MM)?;
    if lo < -bound || hi > bound {
        return Err(HeightfieldError::OutOfWorld {
            context: "footprint span",
        });
    }

    let size = cell_size_mm;
    // i_min = least i with (i+1)*s > lo
    // i_max = greatest i with i*s < hi
    let mut i_min = least_index_with_right_edge_gt(lo, size)?;
    let mut i_max = greatest_index_with_left_edge_lt(hi, size)?;
    if i_max < i_min {
        return Err(HeightfieldError::NoTerrainContact);
    }

    // Only the world-edge cells can fail clipping; nudge endpoints inward a
    // few steps so a world-sized span cannot hang before the safety cap.
    for _ in 0..4 {
        if i_min > i_max || cell_horizontal_bounds(i_min, size).is_ok() {
            break;
        }
        i_min = i_min
            .checked_add(1)
            .ok_or(HeightfieldError::IntegerOverflow {
                context: "cell index nudge min",
            })?;
    }
    for _ in 0..4 {
        if i_max < i_min || cell_horizontal_bounds(i_max, size).is_ok() {
            break;
        }
        i_max = i_max
            .checked_sub(1)
            .ok_or(HeightfieldError::IntegerOverflow {
                context: "cell index nudge max",
            })?;
    }
    if i_max < i_min
        || cell_horizontal_bounds(i_min, size).is_err()
        || cell_horizontal_bounds(i_max, size).is_err()
    {
        return Err(HeightfieldError::NoTerrainContact);
    }
    Ok((i_min, i_max))
}

fn least_index_with_right_edge_gt(lo: f64, size: i64) -> Result<i64, HeightfieldError> {
    // Start near floor(lo/size) and adjust.
    let mut i = floor_div_exact(lo, size)?;
    loop {
        let right_index = i.checked_add(1).ok_or(HeightfieldError::IntegerOverflow {
            context: "least index right edge",
        })?;
        let right = checked_edge_f64(right_index, size)?;
        if right > lo {
            // Check whether i-1 also satisfies; if so, it is smaller.
            if i.checked_sub(1).is_some() {
                let prev_right = checked_edge_f64(i, size)?;
                if prev_right > lo {
                    i -= 1;
                    continue;
                }
            }
            return Ok(i);
        }
        i = right_index;
    }
}

fn greatest_index_with_left_edge_lt(hi: f64, size: i64) -> Result<i64, HeightfieldError> {
    let mut i = floor_div_exact(hi, size)?;
    // floor(hi/s) may equal an edge index where i*s == hi; that cell is excluded.
    loop {
        let left = checked_edge_f64(i, size)?;
        if left < hi {
            if let Some(next) = i.checked_add(1) {
                let next_left = checked_edge_f64(next, size)?;
                if next_left < hi {
                    i = next;
                    continue;
                }
            }
            return Ok(i);
        }
        i = i.checked_sub(1).ok_or(HeightfieldError::IntegerOverflow {
            context: "greatest index adjust",
        })?;
    }
}

fn floor_div_exact(value: f64, size: i64) -> Result<i64, HeightfieldError> {
    let size_f = i64_to_exact_f64(size)?;
    let approx = (value / size_f).floor();
    if !approx.is_finite() || approx < (i64::MIN as f64) * 0.5 || approx > (i64::MAX as f64) * 0.5 {
        return Err(HeightfieldError::IntegerOverflow {
            context: "floor division estimate",
        });
    }
    let mut i = approx as i64;
    loop {
        let edge = checked_edge_f64(i, size)?;
        if edge <= value {
            let next = match i.checked_add(1) {
                Some(v) => v,
                None => break,
            };
            let next_edge = checked_edge_f64(next, size)?;
            if next_edge <= value {
                i = next;
                continue;
            }
            break;
        }
        i = i.checked_sub(1).ok_or(HeightfieldError::IntegerOverflow {
            context: "floor division adjust",
        })?;
    }
    Ok(i)
}

fn checked_edge_f64(index: i64, cell_size_mm: i64) -> Result<f64, HeightfieldError> {
    let edge = index
        .checked_mul(cell_size_mm)
        .ok_or(HeightfieldError::IntegerOverflow {
            context: "cell edge product",
        })?;
    i64_to_exact_f64(edge)
}

fn checked_inclusive_count(lo: i64, hi: i64) -> Result<usize, HeightfieldError> {
    if hi < lo {
        return Err(HeightfieldError::IntegerOverflow {
            context: "inclusive count ordering",
        });
    }
    let span = hi.checked_sub(lo).and_then(|v| v.checked_add(1)).ok_or(
        HeightfieldError::IntegerOverflow {
            context: "inclusive count",
        },
    )?;
    usize::try_from(span).map_err(|_| HeightfieldError::IntegerOverflow {
        context: "inclusive count fits usize",
    })
}

fn i64_to_exact_f64(value: i64) -> Result<f64, HeightfieldError> {
    let as_f64 = value as f64;
    if as_f64 as i64 != value || !as_f64.is_finite() {
        return Err(HeightfieldError::IntegerOverflow {
            context: "i64 to f64 exact",
        });
    }
    Ok(if as_f64 == 0.0 { 0.0 } else { as_f64 })
}

fn checked_f64_add(a: f64, b: f64) -> Result<f64, HeightfieldError> {
    let sum = a + b;
    if !sum.is_finite() {
        return Err(HeightfieldError::NonFiniteCoordinate { context: "f64 add" });
    }
    Ok(if sum == 0.0 { 0.0 } else { sum })
}

fn checked_f64_sub(a: f64, b: f64) -> Result<f64, HeightfieldError> {
    let difference = a - b;
    if !difference.is_finite() {
        return Err(HeightfieldError::NonFiniteCoordinate { context: "f64 sub" });
    }
    Ok(if difference == 0.0 { 0.0 } else { difference })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shape::WORLD_BOUND_MM;
    use hmac::Mac;

    #[test]
    fn config_rejects_zero_and_non_divisor() {
        assert!(matches!(
            HeightfieldConfig::new(0),
            Err(HeightfieldError::InvalidCellSize { .. })
        ));
        assert!(matches!(
            HeightfieldConfig::new(-1000),
            Err(HeightfieldError::InvalidCellSize { .. })
        ));
        assert!(matches!(
            HeightfieldConfig::new(3000),
            Err(HeightfieldError::CellSizeNotChunkDivisor { .. })
        ));
        assert!(HeightfieldConfig::new(1000).is_ok());
        assert!(HeightfieldConfig::new(1).is_ok());
        assert!(HeightfieldConfig::new(CHUNK_SIZE_MM).is_ok());
    }

    #[test]
    fn sample_height_is_stable_and_in_range() {
        let seed = [7u8; 32];
        let a = sample_height_mm(&seed, 12, -34);
        let b = sample_height_mm(&seed, 12, -34);
        assert_eq!(a, b);
        assert!((GENERATED_HEIGHT_MIN_MM..=GENERATED_HEIGHT_MAX_MM).contains(&a));
    }

    #[test]
    fn sample_height_encoding_oracle_matches_public_function() {
        // Re-state the v1 message layout here so a silent encoding drift fails.
        let seed = [0xA5u8; 32];
        for &(x, z) in &[
            (0_i64, 0_i64),
            (1, -1),
            (-64, 0),
            (64, 0),
            (12_345, -67_890),
        ] {
            let mut message = Vec::new();
            message.extend_from_slice(HEIGHTFIELD_GENERATOR_DOMAIN);
            message.extend_from_slice(&HEIGHTFIELD_GENERATOR_VERSION.to_be_bytes());
            message.extend_from_slice(&x.to_be_bytes());
            message.extend_from_slice(&z.to_be_bytes());
            let mut mac =
                HmacSha256::new_from_slice(&seed).expect("HMAC-SHA256 accepts any key length");
            mac.update(&message);
            let digest: [u8; 32] = mac.finalize().into_bytes().into();
            let raw = u64::from_be_bytes(digest[0..8].try_into().expect("8 bytes"));
            let expected = GENERATED_HEIGHT_MIN_MM + (raw % GENERATED_HEIGHT_SPAN) as i64;
            assert_eq!(sample_height_mm(&seed, x, z), expected);
        }
    }

    #[test]
    fn positive_and_negative_chunk_seams_share_samples() {
        let hf = Heightfield::new([9u8; 32], 1000).expect("config");
        let left = hf.chunk_view(-1, 0).expect("left");
        let right = hf.chunk_view(0, 0).expect("right");
        let seam_left = left
            .sample_at_local(left.samples_per_axis() - 1, 0)
            .unwrap();
        let seam_right = right.sample_at_local(0, 0).unwrap();
        assert_eq!(seam_left, seam_right);
        assert_eq!(
            left.global_sample_coord(left.samples_per_axis() - 1, 3)
                .unwrap(),
            right.global_sample_coord(0, 3).unwrap()
        );
    }

    #[test]
    fn column_top_is_max_not_average_or_single_corner() {
        let hf = Heightfield::new([3u8; 32], 1000).expect("config");
        let mut found = false;
        for x in 0..32 {
            for z in 0..32 {
                let c00 = hf.sample_height_mm(x, z);
                let c10 = hf.sample_height_mm(x + 1, z);
                let c01 = hf.sample_height_mm(x, z + 1);
                let c11 = hf.sample_height_mm(x + 1, z + 1);
                let max = c00.max(c10).max(c01).max(c11);
                let avg = (c00 + c10 + c01 + c11) / 4;
                if max != avg && max != c00 && max != c10 {
                    let col = hf.terrain_column(x, z).expect("column");
                    assert_eq!(col.top_y_mm(), max);
                    assert_eq!(col.lower_y_mm(), -WORLD_BOUND_MM);
                    found = true;
                    break;
                }
            }
            if found {
                break;
            }
        }
        assert!(
            found,
            "expected a non-flat procedural cell in the probe window"
        );
    }

    #[test]
    fn half_open_edge_excludes_zero_thickness_touch() {
        let (a, b) = cell_index_range(0.0, 1000.0, 1000).expect("span");
        assert_eq!((a, b), (0, 0));
        let (a, b) = cell_index_range(1000.0, 1500.0, 1000).expect("span");
        assert_eq!((a, b), (1, 1));
        let (a, b) = cell_index_range(-500.0, 500.0, 1000).expect("span");
        assert_eq!((a, b), (-1, 0));
    }

    #[test]
    fn world_bound_face_is_owned_by_last_cell() {
        let s = 1000_i64;
        let (a, b) = cell_index_range((WORLD_BOUND_MM - 500) as f64, WORLD_BOUND_MM as f64, s)
            .expect("span");
        let last = WORLD_BOUND_MM / s - 1;
        assert_eq!(a, last);
        assert_eq!(b, last);
        let bounds = cell_horizontal_bounds(last, s).expect("bounds");
        assert_eq!(bounds.1, WORLD_BOUND_MM);
    }
}

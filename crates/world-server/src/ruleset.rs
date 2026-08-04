//! Validated ruleset generations and tick-boundary activation.

use std::collections::BTreeMap;

/// Default `movement.lease_ttl_ms` from the ruleset catalog.
pub const DEFAULT_LEASE_TTL_MS: u32 = 10_000;

/// Default ordinary soak delay in ticks.
pub const DEFAULT_SOAK_DELAY_TICKS: u64 = 1;

/// Complete parameter map for one immutable ruleset generation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RulesetParameters {
    values: BTreeMap<String, i64>,
}

impl Default for RulesetParameters {
    fn default() -> Self {
        Self::catalog_defaults()
    }
}

impl RulesetParameters {
    #[must_use]
    pub fn catalog_defaults() -> Self {
        let mut values = BTreeMap::new();
        values.insert(
            "movement.lease_ttl_ms".into(),
            i64::from(DEFAULT_LEASE_TTL_MS),
        );
        values.insert(
            "governance.soak_delay_ticks".into(),
            DEFAULT_SOAK_DELAY_TICKS as i64,
        );
        values.insert("governance.meta_soak_delay_ticks".into(), 2);
        values.insert("governance.cost_ceiling".into(), 100);
        values.insert("governance.candidate_cost".into(), 1);
        Self { values }
    }

    #[must_use]
    pub fn get(&self, path: &str) -> Option<i64> {
        self.values.get(path).copied()
    }

    pub fn set(&mut self, path: impl Into<String>, value: i64) {
        self.values.insert(path.into(), value);
    }

    #[must_use]
    pub fn values_for_digest(&self) -> &BTreeMap<String, i64> {
        &self.values
    }

    #[must_use]
    pub fn lease_ttl_ms(&self) -> u32 {
        self.get("movement.lease_ttl_ms")
            .unwrap_or(i64::from(DEFAULT_LEASE_TTL_MS))
            .clamp(1, u32::MAX as i64) as u32
    }

    #[must_use]
    pub fn soak_delay_ticks(&self) -> u64 {
        self.get("governance.soak_delay_ticks")
            .unwrap_or(DEFAULT_SOAK_DELAY_TICKS as i64)
            .max(0) as u64
    }
}

/// One immutable live or pending ruleset generation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RulesetGeneration {
    pub generation_id: u64,
    pub activated_tick: u64,
    pub parameters: RulesetParameters,
}

/// Pending candidate waiting for soak + tick-boundary activation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingRuleset {
    pub generation_id: u64,
    pub activate_at_tick: u64,
    pub parameters: RulesetParameters,
}

/// Validation failure codes (subset sufficient for the skeleton).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RulesetValidationError {
    IncompleteCatalog,
    UnknownParameter { path: String },
    OutOfRange { path: String },
    CrossField,
    CostExceeded,
}

/// Validate a complete candidate parameter map.
pub fn validate_candidate(parameters: &RulesetParameters) -> Result<(), RulesetValidationError> {
    let required = [
        "movement.lease_ttl_ms",
        "governance.soak_delay_ticks",
        "governance.meta_soak_delay_ticks",
        "governance.cost_ceiling",
        "governance.candidate_cost",
    ];
    for path in parameters.values.keys() {
        if !required.contains(&path.as_str()) {
            return Err(RulesetValidationError::UnknownParameter { path: path.clone() });
        }
    }
    for path in required {
        if parameters.get(path).is_none() {
            return Err(RulesetValidationError::IncompleteCatalog);
        }
    }
    let lease = parameters.get("movement.lease_ttl_ms").unwrap();
    if !(1_000..=60_000).contains(&lease) {
        return Err(RulesetValidationError::OutOfRange {
            path: "movement.lease_ttl_ms".into(),
        });
    }
    let soak = parameters.get("governance.soak_delay_ticks").unwrap();
    let meta = parameters.get("governance.meta_soak_delay_ticks").unwrap();
    if soak < 0 || meta < soak {
        return Err(RulesetValidationError::CrossField);
    }
    let cost = parameters.get("governance.candidate_cost").unwrap();
    let ceiling = parameters.get("governance.cost_ceiling").unwrap();
    if cost > ceiling {
        return Err(RulesetValidationError::CostExceeded);
    }
    Ok(())
}

/// Live + optional pending ruleset with tick-boundary activation.
#[derive(Debug, Clone)]
pub struct RulesetStore {
    live: RulesetGeneration,
    pending: Option<PendingRuleset>,
    next_generation_id: u64,
}

impl Default for RulesetStore {
    fn default() -> Self {
        Self::new()
    }
}

impl RulesetStore {
    #[must_use]
    pub fn new() -> Self {
        Self {
            live: RulesetGeneration {
                generation_id: 1,
                activated_tick: 0,
                parameters: RulesetParameters::catalog_defaults(),
            },
            pending: None,
            next_generation_id: 2,
        }
    }

    #[must_use]
    pub fn live(&self) -> &RulesetGeneration {
        &self.live
    }

    #[must_use]
    pub fn pending(&self) -> Option<&PendingRuleset> {
        self.pending.as_ref()
    }

    /// Schedule a validated candidate. Invalid candidates leave live unchanged.
    pub fn schedule(
        &mut self,
        parameters: RulesetParameters,
        current_tick: u64,
    ) -> Result<u64, RulesetValidationError> {
        validate_candidate(&parameters)?;
        let generation_id = self.next_generation_id;
        self.next_generation_id = self.next_generation_id.saturating_add(1);
        let activate_at_tick = current_tick.saturating_add(self.live.parameters.soak_delay_ticks());
        self.pending = Some(PendingRuleset {
            generation_id,
            activate_at_tick,
            parameters,
        });
        Ok(generation_id)
    }

    /// Attempt activation at the end of `completed_tick`. Returns true if live swapped.
    pub fn try_activate_at_boundary(&mut self, completed_tick: u64, soak_ok: bool) -> bool {
        let Some(pending) = &self.pending else {
            return false;
        };
        if completed_tick < pending.activate_at_tick {
            return false;
        }
        if !soak_ok {
            self.pending = None;
            return false;
        }
        let pending = self.pending.take().expect("pending");
        self.live = RulesetGeneration {
            generation_id: pending.generation_id,
            activated_tick: completed_tick,
            parameters: pending.parameters,
        };
        true
    }

    /// Restore durable live + optional pending after restart.
    #[must_use]
    pub fn from_recovered(live: RulesetGeneration, pending: Option<PendingRuleset>) -> Self {
        let next = pending
            .as_ref()
            .map(|pending| pending.generation_id.saturating_add(1))
            .unwrap_or_else(|| live.generation_id.saturating_add(1))
            .max(live.generation_id.saturating_add(1));
        Self {
            live,
            pending,
            next_generation_id: next,
        }
    }

    /// Restore pending after crash without activating it.
    pub fn restore_pending(&mut self, pending: PendingRuleset) {
        self.next_generation_id = self
            .next_generation_id
            .max(pending.generation_id.saturating_add(1));
        self.pending = Some(pending);
    }
}

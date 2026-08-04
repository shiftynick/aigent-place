//! Fixed 20 Hz / 50 ms simulation clock (logical ticks only).

/// Simulation frequency in hertz.
pub const TICK_HZ: u32 = 20;

/// Duration of one simulation tick in milliseconds.
pub const TICK_MS: u32 = 50;

/// Default movement lease TTL from the ruleset catalog (`movement.lease_ttl_ms`).
pub const DEFAULT_LEASE_TTL_MS: u32 = 10_000;

/// Convert a millisecond duration into whole ticks, rounding up.
#[must_use]
pub fn ms_to_ticks(ms: u32) -> u64 {
    let ms = u64::from(ms);
    let tick = u64::from(TICK_MS);
    ms.div_ceil(tick)
}

/// Convert a tick count into milliseconds.
#[must_use]
pub fn ticks_to_ms(ticks: u64) -> u64 {
    ticks.saturating_mul(u64::from(TICK_MS))
}

/// Monotonic logical tick index. Never reads the wall clock.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TickClock {
    /// Next tick that will run when `advance` is called (starts at 1).
    next_tick: u64,
}

impl TickClock {
    /// Create a clock whose first advanced tick is `1`.
    #[must_use]
    pub const fn new() -> Self {
        Self { next_tick: 1 }
    }

    /// Tick index that will run next.
    #[must_use]
    pub const fn next_tick(&self) -> u64 {
        self.next_tick
    }

    /// Last completed tick, or `0` before any advance.
    #[must_use]
    pub const fn last_completed(&self) -> u64 {
        self.next_tick.saturating_sub(1)
    }

    /// Advance one tick and return the completed tick index.
    pub fn advance(&mut self) -> u64 {
        let completed = self.next_tick;
        self.next_tick = self.next_tick.saturating_add(1);
        completed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tick_constants_match_architecture() {
        assert_eq!(TICK_HZ, 20);
        assert_eq!(TICK_MS, 50);
        assert_eq!(u64::from(TICK_HZ) * u64::from(TICK_MS), 1_000);
        assert_eq!(ms_to_ticks(DEFAULT_LEASE_TTL_MS), 200);
    }

    #[test]
    fn clock_advances_without_wall_clock() {
        let mut clock = TickClock::new();
        assert_eq!(clock.last_completed(), 0);
        assert_eq!(clock.advance(), 1);
        assert_eq!(clock.advance(), 2);
        assert_eq!(clock.last_completed(), 2);
        assert_eq!(clock.next_tick(), 3);
    }
}

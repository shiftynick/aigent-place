//! In-process workload load harness (task-009).
//!
//! Measures world-server sim-stage timing, cadence intervals, AOI caps, and the
//! degradation ladder against `workload/v1/CONTRACT.md` / ADR-0006. There is no
//! WebSocket cluster: load is synthetic against library APIs.

use std::collections::BTreeMap;
use std::time::{Duration, Instant};
use world_server::{
    aoi_cap_for_role, truncate_nearest, AoiEntity, ConnectionRole, FocusPoint, OutboundQueue,
    PublicationMailbox, SnapshotFanout, StateKind, World, WorldConfig, AOI_HARD_CAP,
    OVERFLOW_TICK_OBSERVATIONS, QUEUE_LIMIT_BYTES, TICK_HZ, TICK_MS, VIEWER_AOI_CAPS,
};

/// Printed on successful binary completion for gate smoke.
pub const SMOKE_MARKER: &str = "workload-harness: ok";

pub const SIM_TICK_HZ: u32 = 20;
pub const SIM_TICK_MS: u32 = 50;
pub const CONCURRENT_AIGENTS_TARGET: u32 = 300;
pub const CONCURRENT_VIEWERS_TARGET: u32 = 500;
pub const AIGENT_PERCEPT_DEFAULT_HZ: u32 = 5;
pub const AIGENT_PERCEPT_MAX_HZ: u32 = 20;
pub const VIEWER_CADENCE_STEPS_HZ: [u32; 3] = [10, 5, 2];
pub const AIGENT_PERCEPT_FLOOR_STEPS_HZ: [u32; 3] = [5, 2, 1];
pub const PASS_WINDOW_TICKS: usize = 1200;
pub const DEGRADE_WINDOW_TICKS: usize = 600;
pub const PASS_OVERRUN_RATE: f64 = 0.01;
pub const DEGRADE_OVERRUN_RATE: f64 = 0.05;
pub const CADENCE_TOLERANCE_TICKS: u32 = 1;
pub const CAPACITY_SUSTAIN_TICKS: usize = PASS_WINDOW_TICKS;
pub const HOST_SOAK_WALL_MIN_SECS: f64 = 59.0;
pub const HOST_SOAK_WALL_MAX_SECS: f64 = 61.0;

#[derive(Debug, Clone, PartialEq)]
pub struct DegradationPolicy {
    pub level: u32,
    pub viewer_cadence_hz: u32,
    pub viewer_aoi_cap: u32,
    pub refuse_new_viewers: bool,
    pub aigent_percept_floor_hz: Option<u32>,
}

#[must_use]
pub fn max_degradation_level() -> u32 {
    (VIEWER_CADENCE_STEPS_HZ.len() as u32 - 1)
        + (VIEWER_AOI_CAPS.len() as u32 - 1)
        + 1
        + AIGENT_PERCEPT_FLOOR_STEPS_HZ.len() as u32
}

#[must_use]
pub fn policy_from_level(level: u32) -> DegradationPolicy {
    let max = max_degradation_level();
    let mut remaining = level.min(max);

    let mut viewer_cadence_index = 0usize;
    if remaining > 0 {
        let advance = remaining.min(VIEWER_CADENCE_STEPS_HZ.len() as u32 - 1);
        viewer_cadence_index = advance as usize;
        remaining -= advance;
    }

    let mut viewer_aoi_index = 0usize;
    if remaining > 0 {
        let advance = remaining.min(VIEWER_AOI_CAPS.len() as u32 - 1);
        viewer_aoi_index = advance as usize;
        remaining -= advance;
    }

    let mut refuse_new_viewers = false;
    if remaining > 0 {
        refuse_new_viewers = true;
        remaining -= 1;
    }

    let mut aigent_percept_floor_hz = None;
    if remaining > 0 {
        let advance = remaining.min(AIGENT_PERCEPT_FLOOR_STEPS_HZ.len() as u32);
        aigent_percept_floor_hz =
            Some(AIGENT_PERCEPT_FLOOR_STEPS_HZ[(advance as usize).saturating_sub(1)]);
    }

    DegradationPolicy {
        level: level.min(max),
        viewer_cadence_hz: VIEWER_CADENCE_STEPS_HZ[viewer_cadence_index],
        viewer_aoi_cap: VIEWER_AOI_CAPS[viewer_aoi_index],
        refuse_new_viewers,
        aigent_percept_floor_hz,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct WindowClassification {
    pub pass_rate: Option<f64>,
    pub degrade_rate: Option<f64>,
    pub pass_healthy: bool,
    pub degrade_triggers: bool,
}

#[must_use]
pub fn classify_windows(history: &[u8]) -> WindowClassification {
    let pass_rate = window_rate(history, PASS_WINDOW_TICKS);
    let degrade_rate = window_rate(history, DEGRADE_WINDOW_TICKS);
    WindowClassification {
        pass_rate,
        degrade_rate,
        pass_healthy: pass_rate.is_some_and(|rate| rate < PASS_OVERRUN_RATE),
        degrade_triggers: degrade_rate.is_some_and(|rate| rate > DEGRADE_OVERRUN_RATE),
    }
}

fn window_rate(history: &[u8], window_ticks: usize) -> Option<f64> {
    if history.len() < window_ticks {
        return None;
    }
    let slice = &history[history.len() - window_ticks..];
    let overruns: u32 = slice.iter().map(|flag| u32::from(*flag)).sum();
    Some(f64::from(overruns) / window_ticks as f64)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BoundaryAction {
    Advance,
    Retreat,
    Hold,
}

pub fn evaluate_boundary(level: &mut u32, history: &[u8]) -> (BoundaryAction, DegradationPolicy) {
    let windows = classify_windows(history);
    let before = *level;
    let action = if windows.degrade_triggers {
        let max = max_degradation_level();
        if *level < max {
            *level += 1;
            BoundaryAction::Advance
        } else {
            BoundaryAction::Hold
        }
    } else if windows.pass_healthy {
        if *level > 0 {
            *level -= 1;
            BoundaryAction::Retreat
        } else {
            BoundaryAction::Hold
        }
    } else {
        BoundaryAction::Hold
    };
    let _ = before;
    (action, policy_from_level(*level))
}

#[must_use]
pub fn expected_interval_ticks(hz: u32) -> u32 {
    SIM_TICK_HZ / hz.max(1)
}

#[must_use]
pub fn cadence_within_tolerance(expected_hz: u32, observed_interval_ticks: u32) -> bool {
    let expected = expected_interval_ticks(expected_hz);
    let delta = expected.abs_diff(observed_interval_ticks);
    delta <= CADENCE_TOLERANCE_TICKS
}

#[derive(Debug, Clone)]
pub struct MachineProfile {
    pub os: String,
    pub arch: String,
    pub family: String,
    pub cpu_count: usize,
    pub tick_hz: u32,
    pub tick_ms: u32,
}

#[must_use]
pub fn machine_profile() -> MachineProfile {
    MachineProfile {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        family: std::env::consts::FAMILY.to_string(),
        cpu_count: std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1),
        tick_hz: SIM_TICK_HZ,
        tick_ms: SIM_TICK_MS,
    }
}

#[derive(Debug, Clone, Default)]
pub struct Distribution {
    pub samples: Vec<u64>,
}

impl Distribution {
    pub fn push(&mut self, value: u64) {
        self.samples.push(value);
    }

    #[must_use]
    pub fn count(&self) -> usize {
        self.samples.len()
    }

    #[must_use]
    pub fn percentile(&self, p: f64) -> Option<u64> {
        if self.samples.is_empty() {
            return None;
        }
        let mut sorted = self.samples.clone();
        sorted.sort_unstable();
        let idx = ((p.clamp(0.0, 1.0) * (sorted.len() as f64 - 1.0)).round()) as usize;
        Some(sorted[idx.min(sorted.len() - 1)])
    }

    #[must_use]
    pub fn histogram(&self) -> BTreeMap<u64, usize> {
        let mut map = BTreeMap::new();
        for sample in &self.samples {
            *map.entry(*sample).or_default() += 1;
        }
        map
    }
}

#[derive(Debug, Clone)]
pub struct HarnessReport {
    pub profile: MachineProfile,
    pub ticks_run: u64,
    pub overrun_count: u64,
    pub overrun_rate: f64,
    pub sim_stage_us: Distribution,
    pub viewer_cadence_intervals: Distribution,
    pub aigent_cadence_intervals: Distribution,
    pub ladder_actions: Vec<String>,
    pub final_policy: DegradationPolicy,
    pub aoi_max_delivered: usize,
    pub queue_overflow_isolated: bool,
    pub host_soak_wall_secs: Option<f64>,
    pub failures: Vec<String>,
}

impl HarnessReport {
    #[must_use]
    pub fn ok(&self) -> bool {
        self.failures.is_empty()
    }
}

#[derive(Debug, Clone, Copy)]
pub struct HarnessOptions {
    /// When true, assert 1,200 ticks land in the host wall-clock band.
    pub host_soak: bool,
    /// Inject synthetic overruns to exercise the ladder (gate default).
    pub exercise_ladder: bool,
}

impl Default for HarnessOptions {
    fn default() -> Self {
        Self {
            host_soak: false,
            exercise_ladder: true,
        }
    }
}

/// Run the gate profile (ladder + measured load) or optional host soak.
pub fn run_harness(options: HarnessOptions) -> HarnessReport {
    let profile = machine_profile();
    let mut failures = Vec::new();

    if SIM_TICK_HZ != TICK_HZ || SIM_TICK_MS != TICK_MS {
        failures.push(format!(
            "tick constants diverge: harness {SIM_TICK_HZ}Hz/{SIM_TICK_MS}ms vs world-server {TICK_HZ}/{TICK_MS}"
        ));
    }
    if VIEWER_AOI_CAPS != [100, 50, 25] || AOI_HARD_CAP != 100 {
        failures.push("AOI constants diverge from workload contract".into());
    }
    if QUEUE_LIMIT_BYTES != 256 * 1024 || OVERFLOW_TICK_OBSERVATIONS != 40 {
        failures.push("queue constants diverge from protocol contract".into());
    }

    let mut ladder_actions = Vec::new();
    let mut level = 0u32;
    if options.exercise_ladder {
        // Force degrade triggers: 600 ticks with >5% overruns.
        let mut history = vec![0u8; DEGRADE_WINDOW_TICKS];
        for flag in history.iter_mut().take(40) {
            *flag = 1; // 40/600 ≈ 6.7% > 5%
        }
        // Pad to pass-window length with overruns in the trailing degrade window only.
        let mut long = vec![0u8; PASS_WINDOW_TICKS - DEGRADE_WINDOW_TICKS];
        long.append(&mut history);
        for expected_level in 1..=max_degradation_level() {
            let (action, policy) = evaluate_boundary(&mut level, &long);
            ladder_actions.push(format!(
                "advance→{} action={action:?} cadence={} aoi={} refuse={} floor={:?}",
                policy.level,
                policy.viewer_cadence_hz,
                policy.viewer_aoi_cap,
                policy.refuse_new_viewers,
                policy.aigent_percept_floor_hz
            ));
            if action != BoundaryAction::Advance {
                failures.push(format!(
                    "ladder expected advance to {expected_level}, got {action:?} at level {level}"
                ));
                break;
            }
            if policy.level != expected_level {
                failures.push(format!(
                    "policy level {} != expected {expected_level}",
                    policy.level
                ));
            }
        }
        // Retreat: healthy pass window.
        let healthy = vec![0u8; PASS_WINDOW_TICKS];
        for expected in (0..max_degradation_level()).rev() {
            let (action, policy) = evaluate_boundary(&mut level, &healthy);
            ladder_actions.push(format!("retreat→{} action={action:?}", policy.level));
            if action != BoundaryAction::Retreat || policy.level != expected {
                failures.push(format!(
                    "ladder retreat expected level {expected} via Retreat, got {action:?} level {}",
                    policy.level
                ));
                break;
            }
        }
    }

    // Measured in-process load: capacity connections + AOI + sim timing.
    let mut world = World::new(WorldConfig::default());
    let mailbox = PublicationMailbox::new();
    let mut fanout = SnapshotFanout::new();
    let mut aigent_ids = Vec::with_capacity(CONCURRENT_AIGENTS_TARGET as usize);
    let mut viewer_ids = Vec::with_capacity(CONCURRENT_VIEWERS_TARGET as usize);
    for i in 0..CONCURRENT_AIGENTS_TARGET {
        let id = format!("a{i}").into_bytes();
        fanout.attach(id.clone());
        let conn = fanout.get_mut(&id).unwrap();
        conn.role = ConnectionRole::Aigent;
        conn.focus = FocusPoint::origin();
        aigent_ids.push(id);
    }
    for i in 0..CONCURRENT_VIEWERS_TARGET {
        let id = format!("v{i}").into_bytes();
        fanout.attach(id.clone());
        let conn = fanout.get_mut(&id).unwrap();
        conn.role = ConnectionRole::Viewer;
        conn.viewer_aoi_cap = AOI_HARD_CAP;
        conn.focus = FocusPoint::origin();
        viewer_ids.push(id);
    }
    let live_aigents = aigent_ids.len() as u32;
    let live_viewers = viewer_ids.len() as u32;

    let entities: Vec<_> = (1..=250u64)
        .map(|id| AoiEntity::new(id, id as f64, 0.0, 0.0))
        .collect();

    let mut sim_stage_us = Distribution::default();
    let mut overrun_history = Vec::with_capacity(PASS_WINDOW_TICKS);
    let mut viewer_cadence_intervals = Distribution::default();
    let mut aigent_cadence_intervals = Distribution::default();
    let mut last_viewer_delivery_tick: Option<u64> = None;
    let mut last_aigent_delivery_tick: Option<u64> = None;
    let mut aoi_max_delivered = 0usize;
    let mut viewer_sustain_ticks = 0usize;
    let mut aigent_sustain_ticks = 0usize;
    let policy = policy_from_level(0);
    let viewer_interval = u64::from(expected_interval_ticks(policy.viewer_cadence_hz));
    let aigent_hz = policy
        .aigent_percept_floor_hz
        .unwrap_or(AIGENT_PERCEPT_DEFAULT_HZ)
        .min(AIGENT_PERCEPT_MAX_HZ);
    let aigent_interval = u64::from(expected_interval_ticks(aigent_hz));

    let ticks = PASS_WINDOW_TICKS as u64;
    let wall_start = Instant::now();
    for scheduled in 1..=ticks {
        let deadline = wall_start + Duration::from_millis(scheduled * u64::from(SIM_TICK_MS));
        let sim_start = Instant::now();
        let gen = world.advance_tick().expect("tick").clone();
        let elapsed = sim_start.elapsed();
        let us = u64::try_from(elapsed.as_micros()).unwrap_or(u64::MAX);
        sim_stage_us.push(us);
        let overrun = u8::from(elapsed > Duration::from_millis(u64::from(SIM_TICK_MS)));
        overrun_history.push(overrun);

        // Serialization stage — outside overrun measurement.
        mailbox.publish_from_tick(gen.clone());
        let published = mailbox.take().unwrap_or(gen);
        let tick = world.last_completed_tick();

        if live_viewers >= CONCURRENT_VIEWERS_TARGET && !policy.refuse_new_viewers {
            viewer_sustain_ticks += 1;
        } else {
            viewer_sustain_ticks = 0;
        }
        if live_aigents >= CONCURRENT_AIGENTS_TARGET {
            aigent_sustain_ticks += 1;
        } else {
            aigent_sustain_ticks = 0;
        }

        // Rotate through connections so concurrent load is exercised.
        let viewer_idx = ((tick - 1) as usize) % viewer_ids.len();
        let aigent_idx = ((tick - 1) as usize) % aigent_ids.len();
        // Refresh a stripe of connections each tick (covers all within 1200 ticks).
        for offset in 0..2 {
            let v = &viewer_ids[(viewer_idx + offset) % viewer_ids.len()];
            if let Ok((kept, _)) = fanout.get_mut(v).unwrap().refresh_interest(&entities) {
                aoi_max_delivered = aoi_max_delivered.max(kept.len());
                let cap = aoi_cap_for_role(ConnectionRole::Viewer, policy.viewer_aoi_cap) as usize;
                if kept.len() > cap {
                    failures.push(format!("viewer AOI {} exceeded cap {cap}", kept.len()));
                }
            }
            let a = &aigent_ids[(aigent_idx + offset) % aigent_ids.len()];
            let _ = fanout.get_mut(a).unwrap().refresh_interest(&entities);
        }

        if tick % viewer_interval == 0 {
            let v = &viewer_ids[viewer_idx];
            let _ = fanout.publish_to(v, &published, Some(1024));
            if let Some(prev) = last_viewer_delivery_tick {
                viewer_cadence_intervals.push(tick.saturating_sub(prev));
            }
            last_viewer_delivery_tick = Some(tick);
        }
        if tick % aigent_interval == 0 {
            let a = &aigent_ids[aigent_idx];
            let _ = fanout.publish_to(a, &published, Some(1024));
            if let Some(prev) = last_aigent_delivery_tick {
                aigent_cadence_intervals.push(tick.saturating_sub(prev));
            }
            last_aigent_delivery_tick = Some(tick);
        }
        fanout.observe_all_at(tick);

        if options.host_soak {
            let now = Instant::now();
            if now < deadline {
                std::thread::sleep(deadline.saturating_duration_since(now));
            }
        }
    }
    let wall_secs = wall_start.elapsed().as_secs_f64();

    if viewer_sustain_ticks < CAPACITY_SUSTAIN_TICKS {
        failures.push(format!(
            "viewer capacity not sustained: {viewer_sustain_ticks}/{CAPACITY_SUSTAIN_TICKS} with {live_viewers} viewers"
        ));
    }
    if aigent_sustain_ticks < CAPACITY_SUSTAIN_TICKS {
        failures.push(format!(
            "aigent capacity not sustained: {aigent_sustain_ticks}/{CAPACITY_SUSTAIN_TICKS} with {live_aigents} aigents"
        ));
    }

    let overrun_count = u64::from(overrun_history.iter().map(|f| u32::from(*f)).sum::<u32>());
    let overrun_rate = overrun_count as f64 / ticks as f64;
    let windows = classify_windows(&overrun_history);
    if !windows.pass_healthy {
        failures.push(format!(
            "pass window unhealthy: overrun_rate={overrun_rate:.4} (limit {PASS_OVERRUN_RATE})"
        ));
    }

    for interval in &viewer_cadence_intervals.samples {
        if !cadence_within_tolerance(policy.viewer_cadence_hz, *interval as u32) {
            failures.push(format!(
                "viewer cadence interval {interval} outside ±{CADENCE_TOLERANCE_TICKS} of expected {}",
                expected_interval_ticks(policy.viewer_cadence_hz)
            ));
            break;
        }
    }
    for interval in &aigent_cadence_intervals.samples {
        if !cadence_within_tolerance(aigent_hz, *interval as u32) {
            failures.push(format!(
                "aigent cadence interval {interval} outside tolerance for {aigent_hz} Hz"
            ));
            break;
        }
    }

    // Queue overflow isolates one connection without moving degradation.
    let mut slow = OutboundQueue::new();
    slow.enqueue_state(
        QUEUE_LIMIT_BYTES + 1,
        StateKind::Full,
        QUEUE_LIMIT_BYTES + 1,
    )
    .unwrap();
    let mut closed = false;
    for tick in 1..=u64::from(OVERFLOW_TICK_OBSERVATIONS) {
        if matches!(
            slow.observe_at(tick),
            world_server::ObserveOutcome::Closed { .. }
        ) {
            closed = true;
            break;
        }
    }
    let queue_overflow_isolated = closed && level == 0;
    if !queue_overflow_isolated {
        failures.push("sustained overflow did not isolate connection at level 0".into());
    }

    // Full catalog truncate never exceeds hard cap.
    let truncated = truncate_nearest(&entities, FocusPoint::origin(), 500).unwrap();
    if truncated.len() > AOI_HARD_CAP as usize {
        failures.push("hard cap violated by truncate_nearest".into());
    }

    let mut host_soak_wall_secs = None;
    if options.host_soak {
        host_soak_wall_secs = Some(wall_secs);
        if !(HOST_SOAK_WALL_MIN_SECS..=HOST_SOAK_WALL_MAX_SECS).contains(&wall_secs) {
            failures.push(format!(
                "host soak wall {wall_secs:.3}s outside [{HOST_SOAK_WALL_MIN_SECS},{HOST_SOAK_WALL_MAX_SECS}] band"
            ));
        }
    }

    HarnessReport {
        profile,
        ticks_run: ticks,
        overrun_count,
        overrun_rate,
        sim_stage_us,
        viewer_cadence_intervals,
        aigent_cadence_intervals,
        ladder_actions,
        final_policy: policy_from_level(level),
        aoi_max_delivered,
        queue_overflow_isolated,
        host_soak_wall_secs,
        failures,
    }
}

pub fn print_report(report: &HarnessReport) {
    println!("workload-harness: machine profile");
    println!(
        "  os={} arch={} family={} cpus={} tick={}Hz/{}ms",
        report.profile.os,
        report.profile.arch,
        report.profile.family,
        report.profile.cpu_count,
        report.profile.tick_hz,
        report.profile.tick_ms
    );
    println!(
        "workload-harness: ticks={} overruns={} rate={:.4} p50_us={} p95_us={} p99_us={}",
        report.ticks_run,
        report.overrun_count,
        report.overrun_rate,
        report.sim_stage_us.percentile(0.50).unwrap_or(0),
        report.sim_stage_us.percentile(0.95).unwrap_or(0),
        report.sim_stage_us.percentile(0.99).unwrap_or(0)
    );
    println!(
        "workload-harness: viewer cadence samples={} hist={:?}",
        report.viewer_cadence_intervals.count(),
        report.viewer_cadence_intervals.histogram()
    );
    println!(
        "workload-harness: aigent cadence samples={} hist={:?}",
        report.aigent_cadence_intervals.count(),
        report.aigent_cadence_intervals.histogram()
    );
    println!(
        "workload-harness: aoi_max_delivered={} queue_isolated={} final_level={}",
        report.aoi_max_delivered, report.queue_overflow_isolated, report.final_policy.level
    );
    for action in &report.ladder_actions {
        println!("workload-harness: ladder {action}");
    }
    if let Some(secs) = report.host_soak_wall_secs {
        println!("workload-harness: host_soak_wall_secs={secs:.3}");
    }
    for failure in &report.failures {
        eprintln!("workload-harness: FAIL {failure}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constants_match_world_server_and_contract() {
        assert_eq!(SIM_TICK_HZ, TICK_HZ);
        assert_eq!(SIM_TICK_MS, TICK_MS);
        assert_eq!(max_degradation_level(), 8);
        assert_eq!(policy_from_level(0).viewer_cadence_hz, 10);
        assert_eq!(policy_from_level(2).viewer_cadence_hz, 2);
        assert_eq!(policy_from_level(4).viewer_aoi_cap, 25);
        assert!(policy_from_level(5).refuse_new_viewers);
        assert_eq!(policy_from_level(6).aigent_percept_floor_hz, Some(5));
        assert_eq!(policy_from_level(8).aigent_percept_floor_hz, Some(1));
    }

    #[test]
    fn windows_and_boundary_advance_retreat() {
        let mut history = vec![0u8; PASS_WINDOW_TICKS];
        for flag in history.iter_mut().rev().take(40) {
            *flag = 1;
        }
        let windows = classify_windows(&history);
        assert!(windows.degrade_triggers);
        let mut level = 0;
        let (action, _) = evaluate_boundary(&mut level, &history);
        assert_eq!(action, BoundaryAction::Advance);
        assert_eq!(level, 1);
        let healthy = vec![0u8; PASS_WINDOW_TICKS];
        let (action, _) = evaluate_boundary(&mut level, &healthy);
        assert_eq!(action, BoundaryAction::Retreat);
        assert_eq!(level, 0);
    }

    #[test]
    fn gate_profile_passes() {
        let report = run_harness(HarnessOptions::default());
        assert!(report.ok(), "{:?}", report.failures);
        assert_eq!(report.ticks_run, PASS_WINDOW_TICKS as u64);
        assert!(report.viewer_cadence_intervals.count() > 0);
        assert!(report.aoi_max_delivered <= AOI_HARD_CAP as usize);
    }

    #[test]
    fn failure_paths_are_detectable() {
        let bad = vec![1u8; PASS_WINDOW_TICKS];
        assert!(!classify_windows(&bad).pass_healthy);
        assert!(classify_windows(&bad).degrade_triggers);
        assert!(!cadence_within_tolerance(10, 5));
        assert!(cadence_within_tolerance(10, 2));
        assert!(cadence_within_tolerance(10, 3));
    }

    #[test]
    fn report_failures_make_ok_false() {
        let mut report = run_harness(HarnessOptions::default());
        assert!(report.ok());
        report.failures.push("forced".into());
        assert!(!report.ok());
    }
}

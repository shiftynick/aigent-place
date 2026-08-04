//! Canonical per-tick command ordering.

/// Ordering key: `(arrival_tick, aigent_id bytes, sequence)`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandKey {
    pub arrival_tick: u64,
    pub aigent_id: Vec<u8>,
    pub sequence: u64,
}

impl CommandKey {
    #[must_use]
    pub fn new(arrival_tick: u64, aigent_id: impl Into<Vec<u8>>, sequence: u64) -> Self {
        Self {
            arrival_tick,
            aigent_id: aigent_id.into(),
            sequence,
        }
    }
}

impl PartialOrd for CommandKey {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for CommandKey {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.arrival_tick
            .cmp(&other.arrival_tick)
            .then_with(|| self.aigent_id.cmp(&other.aigent_id))
            .then_with(|| self.sequence.cmp(&other.sequence))
    }
}

/// Stable sort of command indices by canonical key.
#[must_use]
pub fn canonical_command_order(keys: &[CommandKey]) -> Vec<usize> {
    let mut indices: Vec<usize> = (0..keys.len()).collect();
    indices.sort_by(|&left, &right| keys[left].cmp(&keys[right]).then(left.cmp(&right)));
    indices
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sorts_by_tick_then_aigent_bytes_then_sequence() {
        let keys = vec![
            CommandKey::new(2, b"b", 1),
            CommandKey::new(1, b"z", 9),
            CommandKey::new(1, b"a", 2),
            CommandKey::new(1, b"a", 1),
        ];
        let order = canonical_command_order(&keys);
        assert_eq!(order, vec![3, 2, 1, 0]);
    }
}

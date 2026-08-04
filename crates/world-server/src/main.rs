//! Scaffold entry point for the authoritative world server.
//!
//! Runtime simulation arrives in later tasks. This binary only proves the
//! pinned Rust workspace builds and executes a documented smoke path.

pub const SMOKE_MARKER: &str = "world-server: smoke ok";

fn main() {
    println!("{SMOKE_MARKER}");
}

#[cfg(test)]
mod tests {
    use super::SMOKE_MARKER;

    #[test]
    fn smoke_marker_matches_documented_output() {
        assert_eq!(SMOKE_MARKER, "world-server: smoke ok");
    }
}

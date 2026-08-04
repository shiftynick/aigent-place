//! Scaffold entry point for the authoritative world server.

use world_server::SMOKE_MARKER;

fn main() {
    println!("{SMOKE_MARKER}");
}

#[cfg(test)]
mod tests {
    use world_server::SMOKE_MARKER;

    #[test]
    fn smoke_marker_matches_documented_output() {
        assert_eq!(SMOKE_MARKER, "world-server: smoke ok");
    }
}

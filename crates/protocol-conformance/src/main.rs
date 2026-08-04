//! Non-interactive protocol conformance client for the unified product gate.

use protocol_conformance::{exit_code_for, run_all, SMOKE_MARKER};

fn main() {
    let failures = run_all();
    if failures.is_empty() {
        println!("{SMOKE_MARKER}");
        return;
    }
    eprintln!("protocol-conformance: {} failure(s)", failures.len());
    for failure in &failures {
        eprintln!("  {}: {}", failure.id, failure.detail);
    }
    std::process::exit(exit_code_for(&failures));
}

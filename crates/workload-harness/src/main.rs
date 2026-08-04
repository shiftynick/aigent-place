//! Non-interactive workload load harness for the product gate.

use workload_harness::{print_report, run_harness, HarnessOptions, SMOKE_MARKER};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let host_soak = args.iter().any(|a| a == "--host-soak");
    let options = HarnessOptions {
        host_soak,
        exercise_ladder: true,
    };
    let report = run_harness(options);
    print_report(&report);
    if report.ok() {
        println!("{SMOKE_MARKER}");
        return;
    }
    std::process::exit(1);
}

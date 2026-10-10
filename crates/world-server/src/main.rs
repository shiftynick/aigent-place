//! Scaffold entry point for the authoritative world server.

use sha2::{Digest, Sha256};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use world_server::{serve, SessionHub, TransportState, DEFAULT_LISTEN_JOURNAL_PATH, SMOKE_MARKER};

fn print_usage() {
    eprintln!(
        "usage: world-server [--listen|--listen-any [HOST:PORT]] [--journal PATH | --demo-plaza [--demo-activity]]\n  default listen: 127.0.0.1:7600\n  default journal: {DEFAULT_LISTEN_JOURNAL_PATH} (cwd-relative; SQLite WAL; noise terrain)\n  --demo-plaza: temporary in-memory world; resets on restart; cannot combine with --journal\n  --demo-activity: server-proved cooperative activity; requires --demo-plaza\n  without flags: print smoke marker"
    );
}

/// Non-auth run correlation token, minted once outside the simulation stage.
/// Portable startup time/PID/checked local sequence are freshness inputs, not
/// replay or gameplay inputs. SHA-256 truncation has theoretical collisions;
/// this is deliberately neither an authentication secret nor durable identity.
fn fresh_demo_run_id() -> Result<[u8; 16], String> {
    static RUN_SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let sequence = RUN_SEQUENCE
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| n.checked_add(1))
        .map_err(|_| "startup run sequence exhausted".to_string())?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?;
    let mut hash = Sha256::new();
    hash.update(b"aigent.demo.activity.run.v1\0");
    hash.update(now.as_nanos().to_be_bytes());
    hash.update(std::process::id().to_be_bytes());
    hash.update(sequence.to_be_bytes());
    let token: [u8; 16] = hash.finalize()[..16]
        .try_into()
        .expect("SHA256 prefix length");
    if token == [0; 16] {
        return Err("zero startup run token".into());
    }
    Ok(token)
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        println!("{SMOKE_MARKER}");
        return;
    }
    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        print_usage();
        return;
    }

    let mut listen_any = false;
    let mut listen = false;
    let mut demo_plaza = false;
    let mut demo_activity = false;
    let mut addr_raw: Option<String> = None;
    let mut journal_path: Option<PathBuf> = None;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--listen-any" => {
                listen = true;
                listen_any = true;
            }
            "--listen" => {
                listen = true;
            }
            "--demo-plaza" => {
                demo_plaza = true;
            }
            "--demo-activity" => {
                demo_activity = true;
            }
            "--journal" => {
                index += 1;
                let Some(path) = args.get(index) else {
                    eprintln!("world-server: --journal requires a PATH");
                    print_usage();
                    std::process::exit(2);
                };
                if path.starts_with("--") {
                    eprintln!("world-server: --journal requires a PATH");
                    print_usage();
                    std::process::exit(2);
                }
                journal_path = Some(PathBuf::from(path));
            }
            flag if flag.starts_with("--") => {
                eprintln!("world-server: unknown argument {flag}");
                print_usage();
                std::process::exit(2);
            }
            value => {
                if addr_raw.is_some() {
                    eprintln!("world-server: unexpected extra argument {value}");
                    print_usage();
                    std::process::exit(2);
                }
                addr_raw = Some(value.to_string());
            }
        }
        index += 1;
    }

    if !listen {
        eprintln!("world-server: unknown arguments {args:?}");
        print_usage();
        std::process::exit(2);
    }

    // Reject before opening/touching storage or binding a listening socket.
    if demo_plaza && journal_path.is_some() {
        eprintln!("world-server: --demo-plaza is temporary and cannot combine with --journal");
        std::process::exit(2);
    }

    if demo_activity && !demo_plaza {
        eprintln!("world-server: --demo-activity requires --demo-plaza and cannot use a journal");
        std::process::exit(2);
    }

    let addr_raw = addr_raw.unwrap_or_else(|| "127.0.0.1:7600".into());
    let addr: SocketAddr = match addr_raw.parse() {
        Ok(addr) => addr,
        Err(error) => {
            eprintln!("world-server: invalid listen address {addr_raw:?}: {error}");
            std::process::exit(2);
        }
    };
    if !listen_any && !addr.ip().is_loopback() {
        eprintln!(
            "world-server: refusing non-loopback bind {addr} without --listen-any (trusted-inject demo)"
        );
        std::process::exit(2);
    }

    let state = if demo_plaza {
        eprintln!(
            "world-server: listening on ws://{addr}/ws (temporary demo plaza; marked in-memory state resets on restart; two demo bindings; demo trusted-inject{}; loopback peers only unless --listen-any)",
            if listen_any { ", --listen-any" } else { "" }
        );
        if demo_activity {
            let run_id = match fresh_demo_run_id() {
                Ok(token) => token,
                Err(error) => {
                    eprintln!("world-server: demo run identifier failed: {error}");
                    std::process::exit(1);
                }
            };
            eprintln!("world-server: optional shared demo activity enabled; run resets on restart");
            TransportState::new_demo_activity(SessionHub::new_v1(), listen_any, run_id)
        } else {
            TransportState::new_demo_plaza(SessionHub::new_v1(), listen_any)
        }
    } else {
        let journal_path =
            journal_path.unwrap_or_else(|| PathBuf::from(DEFAULT_LISTEN_JOURNAL_PATH));
        let state = match TransportState::try_new_with_durable_journal(
            SessionHub::new_v1(),
            listen_any,
            &journal_path,
        ) {
            Ok(state) => state,
            Err(error) => {
                eprintln!(
                    "world-server: durable journal open/recovery failed for {}: {error}",
                    journal_path.display()
                );
                std::process::exit(1);
            }
        };

        eprintln!(
        "world-server: listening on ws://{addr}/ws (journal {}; demo trusted-inject{}; loopback peers only unless --listen-any)",
        journal_path.display(),
        if listen_any { ", --listen-any" } else { "" }
        );
        state
    };
    if let Err(error) = serve(addr, state).await {
        eprintln!("world-server: listen failed: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use world_server::SMOKE_MARKER;

    #[test]
    fn startup_tokens_are_nonzero_and_distinct() {
        let a = super::fresh_demo_run_id().unwrap();
        let b = super::fresh_demo_run_id().unwrap();
        assert_ne!(a, [0; 16]);
        assert_ne!(a, b);
    }

    #[test]
    fn smoke_marker_matches_documented_output() {
        assert_eq!(SMOKE_MARKER, "world-server: smoke ok");
    }
}

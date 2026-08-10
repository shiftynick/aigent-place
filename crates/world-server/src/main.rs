//! Scaffold entry point for the authoritative world server.

use std::net::SocketAddr;
use std::path::PathBuf;
use world_server::{serve, SessionHub, TransportState, DEFAULT_LISTEN_JOURNAL_PATH, SMOKE_MARKER};

fn print_usage() {
    eprintln!(
        "usage: world-server [--listen|--listen-any [HOST:PORT]] [--journal PATH]\n  default listen: 127.0.0.1:7600\n  default journal: {DEFAULT_LISTEN_JOURNAL_PATH} (cwd-relative; SQLite WAL)\n  without flags: print smoke marker"
    );
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

    let journal_path = journal_path.unwrap_or_else(|| PathBuf::from(DEFAULT_LISTEN_JOURNAL_PATH));
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
    if let Err(error) = serve(addr, state).await {
        eprintln!("world-server: listen failed: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use world_server::SMOKE_MARKER;

    #[test]
    fn smoke_marker_matches_documented_output() {
        assert_eq!(SMOKE_MARKER, "world-server: smoke ok");
    }
}

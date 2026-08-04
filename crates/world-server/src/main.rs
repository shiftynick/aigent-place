//! Scaffold entry point for the authoritative world server.

use std::net::SocketAddr;
use world_server::{serve, SessionHub, TransportState, SMOKE_MARKER};

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        println!("{SMOKE_MARKER}");
        return;
    }
    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        eprintln!(
            "usage: world-server [--listen|--listen-any [HOST:PORT]]\n  default listen: 127.0.0.1:7600\n  without flags: print smoke marker"
        );
        return;
    }
    let listen_any = args.iter().any(|arg| arg == "--listen-any");
    let listen = listen_any || args.iter().any(|arg| arg == "--listen");
    if !listen {
        eprintln!("world-server: unknown arguments {args:?}");
        std::process::exit(2);
    }
    let addr_raw = args
        .iter()
        .find(|arg| !arg.starts_with("--"))
        .cloned()
        .unwrap_or_else(|| "127.0.0.1:7600".into());
    let addr: SocketAddr = addr_raw.parse().expect("listen address host:port");
    if !listen_any && !addr.ip().is_loopback() {
        eprintln!(
            "world-server: refusing non-loopback bind {addr} without --listen-any (trusted-inject demo)"
        );
        std::process::exit(2);
    }
    let state = TransportState::new_with_options(SessionHub::new_v1(), listen_any);
    eprintln!(
        "world-server: listening on ws://{addr}/ws (demo trusted-inject{}; loopback peers only unless --listen-any)",
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

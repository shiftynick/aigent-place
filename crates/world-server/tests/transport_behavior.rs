//! WebSocket handshake bridge behavioral tests (task-033).

use std::sync::Arc;
use std::time::Duration;

use aigent_protocol::{
    handshake_frame, ClientHello, ConnectionRole, HandshakeFrame, ProtocolErrorCode, ServerHello,
};
use futures_util::{SinkExt, StreamExt};
use prost::Message;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use world_server::{serve_ephemeral, SessionHub, TransportState};

fn client_hello_aigent(aigent_id: &[u8]) -> Vec<u8> {
    HandshakeFrame {
        body: Some(handshake_frame::Body::ClientHello(ClientHello {
            role: ConnectionRole::Aigent as i32,
            offered_protocol_majors: vec![1],
            offered_features: vec![],
            aigent_id: aigent_id.to_vec(),
        })),
    }
    .encode_to_vec()
}

async fn connect_and_hello(
    url: &str,
    aigent_id: &[u8],
) -> (
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    ServerHello,
) {
    let (mut ws, _) = tokio_tungstenite::connect_async(url)
        .await
        .expect("connect");
    ws.send(WsMessage::Binary(client_hello_aigent(aigent_id).into()))
        .await
        .expect("send hello");
    let reply = ws.next().await.expect("reply").expect("ok");
    let WsMessage::Binary(bytes) = reply else {
        panic!("expected binary ServerHello, got {reply:?}");
    };
    let frame = HandshakeFrame::decode(bytes.as_ref()).expect("decode handshake");
    match frame.body {
        Some(handshake_frame::Body::ServerHello(hello)) => (ws, hello),
        other => panic!("expected ServerHello, got {other:?}"),
    }
}

#[tokio::test]
async fn websocket_handshake_accepts_aigent() {
    let state = TransportState::new(SessionHub::new_v1());
    let (addr, server) = serve_ephemeral(Arc::clone(&state)).await.unwrap();
    tokio::spawn(async move {
        let _ = server.await;
    });
    let url = format!("ws://{addr}/ws");
    let (_ws, hello) = connect_and_hello(&url, b"agent-a").await;
    assert_eq!(hello.selected_protocol_major, 1);
    assert!(!hello.connection_id.is_empty());
    assert!(!hello.session_epoch.is_empty());
    assert_eq!(
        hello.mode,
        aigent_protocol::ConnectionMode::CommandCapable as i32
    );
}

#[tokio::test]
async fn websocket_reconnect_closes_displaced_socket() {
    let state = TransportState::new(SessionHub::new_v1());
    let (addr, server) = serve_ephemeral(state).await.unwrap();
    tokio::spawn(async move {
        let _ = server.await;
    });
    let url = format!("ws://{addr}/ws");
    let (mut first_ws, first) = connect_and_hello(&url, b"agent-a").await;
    let (_second_ws, second) = connect_and_hello(&url, b"agent-a").await;
    assert_ne!(first.session_epoch, second.session_epoch);
    // Displaced first socket should be closed by the server.
    let closed = tokio::time::timeout(Duration::from_secs(2), first_ws.next())
        .await
        .expect("first socket should close")
        .transpose()
        .ok()
        .flatten();
    assert!(
        closed.is_none()
            || matches!(closed, Some(WsMessage::Close(_)))
            || matches!(closed, Some(WsMessage::Binary(_))),
        "displaced connection should end, got {closed:?}"
    );
}

#[tokio::test]
async fn malformed_handshake_is_rejected_without_panic() {
    let state = TransportState::new(SessionHub::new_v1());
    let (addr, server) = serve_ephemeral(state).await.unwrap();
    tokio::spawn(async move {
        let _ = server.await;
    });
    let url = format!("ws://{addr}/ws");
    let (mut ws, _) = tokio_tungstenite::connect_async(url).await.unwrap();
    ws.send(WsMessage::Binary(b"\x00\xff not protobuf".to_vec().into()))
        .await
        .unwrap();
    let reply = ws.next().await.unwrap().unwrap();
    let WsMessage::Binary(bytes) = reply else {
        panic!("expected reject frame");
    };
    let frame = HandshakeFrame::decode(bytes.as_ref()).unwrap();
    match frame.body {
        Some(handshake_frame::Body::HandshakeReject(reject)) => {
            assert_eq!(reject.code, ProtocolErrorCode::InvalidEnvelope as i32);
        }
        other => panic!("expected HandshakeReject, got {other:?}"),
    }
}

#[tokio::test]
async fn malformed_post_handshake_closes_without_blocking_logical_ticks() {
    let state = TransportState::new(SessionHub::new_v1());
    let tick_state = Arc::clone(&state);
    let (addr, server) = serve_ephemeral(Arc::clone(&state)).await.unwrap();
    tokio::spawn(async move {
        let _ = server.await;
    });
    let ticker = tokio::spawn(async move {
        for _ in 0..40 {
            tick_state.advance_logical_tick();
            tokio::task::yield_now().await;
        }
    });
    let url = format!("ws://{addr}/ws");
    let (mut ws, _hello) = connect_and_hello(&url, b"agent-b").await;
    // Empty protobuf Envelope decodes but fails required-field validation.
    ws.send(WsMessage::Binary(vec![].into())).await.unwrap();
    let _ = tokio::time::timeout(Duration::from_secs(2), ws.next()).await;
    ticker.await.unwrap();
    assert!(state.peek_arrival_tick() >= 40);
}

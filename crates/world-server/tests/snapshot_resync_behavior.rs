//! WebSocket SnapshotResyncRequest → full snapshot without reconnect (task-951113).

use std::sync::Arc;
use std::time::Duration;

use aigent_protocol::{
    envelope, handshake_frame, ClientHello, ConnectionRole, Envelope, HandshakeFrame, ServerHello,
    SnapshotResyncRequest,
};
use futures_util::{SinkExt, StreamExt};
use prost::Message;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use world_server::{serve_ephemeral, SessionHub, TransportState, World, WorldConfig};

fn client_hello(role: ConnectionRole) -> Vec<u8> {
    HandshakeFrame {
        body: Some(handshake_frame::Body::ClientHello(ClientHello {
            role: role as i32,
            offered_protocol_majors: vec![1],
            offered_features: vec![],
            aigent_id: vec![],
        })),
    }
    .encode_to_vec()
}

async fn connect(
    url: &str,
) -> (
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    ServerHello,
) {
    let (mut ws, _) = tokio_tungstenite::connect_async(url)
        .await
        .expect("connect");
    ws.send(WsMessage::Binary(
        client_hello(ConnectionRole::Viewer).into(),
    ))
    .await
    .expect("hello");
    let reply = ws.next().await.expect("reply").expect("ok");
    let WsMessage::Binary(bytes) = reply else {
        panic!("expected ServerHello binary");
    };
    let frame = HandshakeFrame::decode(bytes.as_ref()).unwrap();
    match frame.body {
        Some(handshake_frame::Body::ServerHello(hello)) => (ws, hello),
        other => panic!("expected ServerHello, got {other:?}"),
    }
}

async fn next_envelope(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Envelope {
    let msg = tokio::time::timeout(Duration::from_secs(2), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let WsMessage::Binary(bytes) = msg else {
        panic!("expected binary");
    };
    Envelope::decode(bytes.as_ref()).unwrap()
}

async fn publish_next(state: &TransportState) {
    let gen = {
        let mut world = state.world.lock().await;
        world.advance_tick().unwrap().clone()
    };
    state.publish_generation(gen);
}

#[tokio::test]
async fn snapshot_resync_request_emits_full_snapshot_without_reconnect() {
    let state = TransportState::new(SessionHub::new_v1());
    {
        let mut world = state.world.lock().await;
        *world = World::new(WorldConfig::default());
    }
    let (addr, server) = serve_ephemeral(Arc::clone(&state)).await.unwrap();
    tokio::spawn(async move {
        let _ = server.await;
    });
    let url = format!("ws://{addr}/ws");
    let (mut viewer, hello) = connect(&url).await;
    let connection_id = hello.connection_id.clone();

    publish_next(&state).await;
    let _ = state.drain_fanout(None).await;
    let first = next_envelope(&mut viewer).await;
    let first_baseline = match first.body {
        Some(envelope::Body::FullSnapshot(snap)) => snap.baseline_id,
        other => panic!("expected FullSnapshot, got {other:?}"),
    };

    publish_next(&state).await;
    let _ = state.drain_fanout(None).await;
    let delta = next_envelope(&mut viewer).await;
    assert!(matches!(delta.body, Some(envelope::Body::SnapshotDelta(_))));

    {
        let mut fanout = state.fanout.lock().await;
        let connection = fanout.get_mut(&connection_id).unwrap();
        connection.events.epoch = 9;
        connection.events.next_sequence = 42;
    }
    let events_before = {
        let fanout = state.fanout.lock().await;
        fanout.get(&connection_id).unwrap().events.clone()
    };

    let request = Envelope {
        protocol_major: 1,
        connection_id: connection_id.clone(),
        message_id: 7,
        metadata: Some(aigent_protocol::EnvelopeMetadata {
            required_features: vec![],
        }),
        body: Some(envelope::Body::SnapshotResyncRequest(
            SnapshotResyncRequest {
                baseline_id: Some(first_baseline),
            },
        )),
    }
    .encode_to_vec();
    viewer
        .send(WsMessage::Binary(request.into()))
        .await
        .expect("send resync");

    let resynced = next_envelope(&mut viewer).await;
    let new_baseline = match resynced.body {
        Some(envelope::Body::FullSnapshot(snap)) => snap.baseline_id,
        other => panic!("expected resync FullSnapshot, got {other:?}"),
    };
    assert_ne!(new_baseline, first_baseline);

    let events_after = {
        let fanout = state.fanout.lock().await;
        fanout.get(&connection_id).unwrap().events.clone()
    };
    assert_eq!(events_after, events_before);

    let dup = Envelope {
        protocol_major: 1,
        connection_id: connection_id.clone(),
        message_id: 7,
        metadata: Some(aigent_protocol::EnvelopeMetadata {
            required_features: vec![],
        }),
        body: Some(envelope::Body::SnapshotResyncRequest(
            SnapshotResyncRequest {
                baseline_id: Some(first_baseline),
            },
        )),
    }
    .encode_to_vec();
    viewer
        .send(WsMessage::Binary(dup.into()))
        .await
        .expect("send duplicate");
    let err = next_envelope(&mut viewer).await;
    match err.body {
        Some(envelope::Body::ProtocolError(error)) => {
            assert_eq!(
                error.code,
                aigent_protocol::ProtocolErrorCode::InvalidEnvelope as i32
            );
            assert_eq!(error.related_message_id, Some(7));
        }
        other => panic!("expected INVALID_ENVELOPE, got {other:?}"),
    }
    {
        let fanout = state.fanout.lock().await;
        assert_eq!(
            fanout.get(&connection_id).unwrap().snapshot.baseline_id(),
            Some(new_baseline)
        );
    }
    publish_next(&state).await;
    let _ = state.drain_fanout(None).await;
    let after = next_envelope(&mut viewer).await;
    match after.body {
        Some(envelope::Body::SnapshotDelta(delta)) => {
            assert_eq!(delta.baseline_id, new_baseline);
        }
        other => panic!("expected delta on same connection, got {other:?}"),
    }
}

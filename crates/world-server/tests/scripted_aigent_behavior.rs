//! Scripted aigent move-lease path (task-035).

use std::sync::Arc;
use std::time::Duration;

use aigent_protocol::{
    command_result, envelope, handshake_frame, ClientHello, Command, CommandKind, CommandMetadata,
    ConnectionRole, Envelope, HandshakeFrame, ServerHello,
};
use futures_util::{SinkExt, StreamExt};
use prost::Message;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use world_server::{serve_ephemeral, spawn_simulation_loop, SessionHub, TransportState};

fn client_hello(aigent_id: &[u8]) -> Vec<u8> {
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

fn move_command(
    connection_id: &[u8],
    session_epoch: &[u8],
    message_id: u64,
    sequence: u64,
    idempotency_key: &[u8],
) -> Vec<u8> {
    Envelope {
        protocol_major: 1,
        connection_id: connection_id.to_vec(),
        message_id,
        metadata: None,
        body: Some(envelope::Body::Command(Command {
            metadata: Some(CommandMetadata {
                session_epoch: session_epoch.to_vec(),
                sequence,
                idempotency_key: idempotency_key.to_vec(),
            }),
            kind: CommandKind::Move as i32,
            payload: vec![],
        })),
    }
    .encode_to_vec()
}

async fn connect(
    url: &str,
    aigent_id: &[u8],
) -> (
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    ServerHello,
) {
    let (mut ws, _) = tokio_tungstenite::connect_async(url)
        .await
        .expect("connect");
    ws.send(WsMessage::Binary(client_hello(aigent_id).into()))
        .await
        .expect("hello");
    let reply = ws.next().await.expect("reply").expect("ok");
    let WsMessage::Binary(bytes) = reply else {
        panic!("expected ServerHello");
    };
    let frame = HandshakeFrame::decode(bytes.as_ref()).unwrap();
    match frame.body {
        Some(handshake_frame::Body::ServerHello(hello)) => (ws, hello),
        other => panic!("expected ServerHello, got {other:?}"),
    }
}

async fn next_command_result(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> aigent_protocol::CommandResult {
    for _ in 0..32 {
        let msg = tokio::time::timeout(Duration::from_secs(2), ws.next())
            .await
            .expect("timeout")
            .expect("closed")
            .expect("ok");
        let WsMessage::Binary(bytes) = msg else {
            continue;
        };
        let envelope = Envelope::decode(bytes.as_ref()).unwrap();
        if let Some(envelope::Body::CommandResult(result)) = envelope.body {
            return result;
        }
    }
    panic!("no CommandResult received");
}

#[tokio::test]
async fn scripted_move_lease_accepts_and_idempotency_replays() {
    let state = TransportState::new(SessionHub::new_v1());
    let _sim = spawn_simulation_loop(Arc::clone(&state));
    let (addr, server) = serve_ephemeral(Arc::clone(&state)).await.unwrap();
    tokio::spawn(async move {
        let _ = server.await;
    });
    let url = format!("ws://{addr}/ws");
    let (mut ws, hello) = connect(&url, b"scripted-a").await;

    let first = move_command(
        &hello.connection_id,
        &hello.session_epoch,
        1,
        1,
        b"move-idem-1",
    );
    ws.send(WsMessage::Binary(first.into()))
        .await
        .expect("send move");
    let result = next_command_result(&mut ws).await;
    assert!(matches!(
        result.outcome,
        Some(command_result::Outcome::Accepted(_))
    ));

    // Wait for at least one sim tick so the lease applies.
    tokio::time::sleep(Duration::from_millis(120)).await;
    {
        let world = state.world.lock().await;
        assert!(
            world.last_completed_tick() >= 1,
            "simulation loop should advance ticks"
        );
        assert!(
            !world
                .last_generation()
                .map(|gen| gen.active_leases.is_empty())
                .unwrap_or(true),
            "move should grant an active lease visible on a published generation"
        );
    }

    let replay = move_command(
        &hello.connection_id,
        &hello.session_epoch,
        2,
        1,
        b"move-idem-1",
    );
    ws.send(WsMessage::Binary(replay.into()))
        .await
        .expect("replay");
    let replayed = next_command_result(&mut ws).await;
    assert!(matches!(
        replayed.outcome,
        Some(command_result::Outcome::Accepted(_))
    ));

    let renew = move_command(
        &hello.connection_id,
        &hello.session_epoch,
        3,
        2,
        b"move-idem-2",
    );
    ws.send(WsMessage::Binary(renew.into()))
        .await
        .expect("renew");
    let renewed = next_command_result(&mut ws).await;
    assert!(matches!(
        renewed.outcome,
        Some(command_result::Outcome::Accepted(_))
    ));
    tokio::time::sleep(Duration::from_millis(120)).await;
    let world = state.world.lock().await;
    assert!(world.last_completed_tick() >= 2);
}

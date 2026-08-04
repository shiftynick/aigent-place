fn main() {
    use aigent_protocol::*;
    use prost::Message;
    use std::fs;
    use std::path::PathBuf;

    let out =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../protocol/v1/conformance/binary");
    fs::create_dir_all(&out).unwrap();

    let envelope = Envelope {
        protocol_major: 1,
        connection_id: b"conn-1".to_vec(),
        message_id: 42,
        metadata: Some(EnvelopeMetadata {
            required_features: vec![FeatureUse {
                feature_id: "demo".into(),
                version: 1,
            }],
        }),
        body: Some(envelope::Body::ProtocolError(ProtocolError {
            related_message_id: Some(7),
            code: ProtocolErrorCode::UnsupportedProtocol as i32,
            message: "major 99 unsupported".into(),
            retry_after_ticks: None,
        })),
    };
    let handshake = HandshakeFrame {
        body: Some(handshake_frame::Body::HandshakeReject(HandshakeReject {
            code: ProtocolErrorCode::UnsupportedProtocol as i32,
            message: "no overlapping major".into(),
            compatibility: vec![CompatibilityRecord {
                protocol_major: 1,
                deprecated_at_unix_ms: 0,
                command_support_until_unix_ms: 0,
                current_mode: ConnectionMode::SpectateOnly as i32,
            }],
        })),
    };
    let outcome = CommandOutcome {
        build_id: "build-a".into(),
        replay_version: 1,
        prior_generation: 0,
        command: Some(DurableCommandDescriptor {
            command_id: "restored".into(),
            arrival_tick: 1,
            aigent_id: b"a".to_vec(),
            session_epoch: b"9".to_vec(),
            sequence: 1,
            idempotency_key: b"restore-key".to_vec(),
            protocol_major: 1,
            kind: CommandKind::Move as i32,
            required_features: vec![],
            payload_mode: aigent_protocol::DurablePayloadMode::Bytes as i32,
            canonical_payload: b"{\"value\":4}".to_vec(),
        }),
        digest: hex::decode("22e4bcda0cc31c4e93636633f291fa68135e4ed41ed48794f9a03bd4be27f87c")
            .unwrap(),
        result: Some(DurableCommandResult {
            outcome: Some(durable_command_result::Outcome::Accepted(CommandAccepted {
                affected_entities: vec![],
                payload: vec![],
                affected_world_entities: vec![WorldEntityReference {
                    entity_id: 9,
                    revision: 1,
                }],
            })),
        }),
        encoded_frame_bytes: 1,
        generation_record_count: 1,
        alias: false,
        preserve_idempotency: false,
        committed_at: 3,
        events: vec![DurableOrderedEvent {
            stream_id: b"7".to_vec(),
            stream_epoch: 1,
            sequence: 1,
            ordinal: 1,
            encoded_bytes: 5,
            committed_at: 3,
            payload: b"event".to_vec(),
        }],
        rng_audit: vec![],
    };

    fs::write(
        out.join("envelope-protocol-error.hex"),
        hex::encode(envelope.encode_to_vec()),
    )
    .unwrap();
    fs::write(
        out.join("handshake-reject.hex"),
        hex::encode(handshake.encode_to_vec()),
    )
    .unwrap();
    fs::write(
        out.join("command-outcome.hex"),
        hex::encode(outcome.encode_to_vec()),
    )
    .unwrap();
    println!("wrote fixtures to {}", out.display());
}

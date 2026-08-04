//! Generated bindings for `aigent.protocol.v1`.
//!
//! Wire types come only from `protocol/v1/aigent.proto` via `prost`
//! (see ADR-0008). Do not hand-copy envelope fields here.

#![allow(clippy::derive_partial_eq_without_eq)]

include!(concat!(env!("OUT_DIR"), "/aigent.protocol.v1.rs"));

#[cfg(test)]
mod tests {
    use super::*;
    use prost::Message;
    use std::path::PathBuf;

    fn fixture_bytes(name: &str) -> Vec<u8> {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../protocol/v1/conformance/binary")
            .join(name);
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
        let hex: String = text.chars().filter(|c| !c.is_whitespace()).collect();
        hex::decode(hex).expect("fixture hex")
    }

    fn sample_envelope() -> Envelope {
        Envelope {
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
        }
    }

    fn sample_handshake_reject() -> HandshakeFrame {
        HandshakeFrame {
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
        }
    }

    fn sample_command_outcome() -> CommandOutcome {
        CommandOutcome {
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
                payload_mode: DurablePayloadMode::Bytes as i32,
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
        }
    }

    #[test]
    fn envelope_fixture_round_trips() {
        let expected = fixture_bytes("envelope-protocol-error.hex");
        let encoded = sample_envelope().encode_to_vec();
        assert_eq!(
            hex::encode(&encoded),
            hex::encode(&expected),
            "Rust encoding must match committed fixture"
        );
        let decoded = Envelope::decode(expected.as_slice()).expect("decode");
        assert_eq!(decoded, sample_envelope());
        assert_eq!(decoded.encode_to_vec(), expected);
    }

    #[test]
    fn handshake_reject_fixture_round_trips() {
        let expected = fixture_bytes("handshake-reject.hex");
        let encoded = sample_handshake_reject().encode_to_vec();
        assert_eq!(hex::encode(&encoded), hex::encode(&expected));
        let decoded = HandshakeFrame::decode(expected.as_slice()).expect("decode");
        assert_eq!(decoded, sample_handshake_reject());
    }

    #[test]
    fn command_outcome_fixture_round_trips() {
        let expected = fixture_bytes("command-outcome.hex");
        let encoded = sample_command_outcome().encode_to_vec();
        assert_eq!(hex::encode(&encoded), hex::encode(&expected));
        let decoded = CommandOutcome::decode(expected.as_slice()).expect("decode");
        assert_eq!(decoded, sample_command_outcome());
    }

    #[test]
    fn unknown_envelope_fields_are_ignored() {
        let mut bytes = sample_envelope().encode_to_vec();
        // Append unknown field 99 as a length-delimited string "x".
        // Tag must be encoded as a protobuf varint (794 = 0x9A 0x06).
        bytes.extend_from_slice(&[0x9A, 0x06, 0x01, b'x']);
        let decoded = Envelope::decode(bytes.as_slice()).expect("decode with unknown");
        assert_eq!(decoded.protocol_major, 1);
        assert_eq!(
            decoded.body,
            sample_envelope().body,
            "known body preserved while unknown field ignored"
        );
    }

    #[test]
    fn malformed_envelope_bytes_fail_deterministically() {
        let err = Envelope::decode(&b"\x00\xff"[..]).expect_err("truncated");
        let message = err.to_string();
        assert!(
            message.contains("failed")
                || message.contains("buffer")
                || message.contains("tag")
                || message.contains("length"),
            "unexpected error text: {message}"
        );
    }

    #[test]
    fn sint64_coordinates_preserve_full_range() {
        let vector = Vector3Millimeters {
            x_mm: i64::MIN / 2,
            y_mm: 0,
            z_mm: i64::MAX / 2,
        };
        let decoded = Vector3Millimeters::decode(vector.encode_to_vec().as_slice()).unwrap();
        assert_eq!(decoded, vector);
    }
}

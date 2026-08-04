//! Owner-side protocol conformance scenarios against the in-memory server contract.
//!
//! There is no WebSocket listen path yet; this client drives `SessionHub` and
//! snapshot fan-out library APIs while encoding/decoding `aigent-protocol`
//! wire types for round-trip and malformed cases.

use aigent_protocol::{
    CommandKind, CommandRejectionCode, CompatibilityRecord, ConnectionMode as ProtoConnectionMode,
    Envelope, EnvelopeMetadata, FeatureUse, HandshakeFrame, HandshakeReject, ProtocolError,
    ProtocolErrorCode, SnapshotResyncReason,
};
use prost::Message;
use world_server::{
    AuthoritativeResult, ClientHello, CommandOutcome, CommandSubmit, ConnectionMode,
    ConnectionRole, FeatureOffer, HandshakeOutcome, IdentityBinding, PublicationMailbox,
    SnapshotFanout, SnapshotStatus, World, WorldConfig,
};

/// Printed on successful binary completion for gate smoke.
pub const SMOKE_MARKER: &str = "protocol-conformance: ok";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScenarioFailure {
    pub id: &'static str,
    pub detail: String,
}

fn fail(id: &'static str, detail: impl Into<String>) -> ScenarioFailure {
    ScenarioFailure {
        id,
        detail: detail.into(),
    }
}

fn inject(id: &[u8]) -> IdentityBinding {
    IdentityBinding::TestTrustedInject {
        aigent_id: id.to_vec(),
    }
}

fn hello_aigent(conn: &[u8], aigent: &[u8]) -> ClientHello {
    ClientHello {
        role: ConnectionRole::Aigent,
        offered_majors: vec![1],
        offered_features: vec![],
        aigent_id: Some(aigent.to_vec()),
        connection_id: conn.to_vec(),
        identity: inject(aigent),
    }
}

fn cmd(
    conn: &[u8],
    epoch: &[u8],
    message_id: u64,
    sequence: u64,
    key: &[u8],
    kind: CommandKind,
    digest: &[u8],
) -> CommandSubmit {
    CommandSubmit {
        connection_id: conn.to_vec(),
        protocol_major: 1,
        message_id,
        session_epoch: epoch.to_vec(),
        sequence,
        idempotency_key: key.to_vec(),
        kind,
        content_digest: digest.to_vec(),
        required_features: vec![],
    }
}

fn accepted_epoch(outcome: HandshakeOutcome) -> Result<Vec<u8>, String> {
    match outcome {
        HandshakeOutcome::Accepted {
            session_epoch: Some(epoch),
            mode: ConnectionMode::CommandCapable,
            ..
        } => Ok(epoch),
        other => Err(format!("expected command-capable accept, got {other:?}")),
    }
}

/// Run every conformance scenario. Returns failures (empty = pass).
pub fn run_all() -> Vec<ScenarioFailure> {
    run_scenarios(SCENARIOS)
}

/// Run an explicit scenario list (used by the binary and mismatch tests).
pub fn run_scenarios(scenarios: &[Scenario]) -> Vec<ScenarioFailure> {
    let mut failures = Vec::new();
    for scenario in scenarios {
        if let Err(failure) = (scenario.run)() {
            failures.push(failure);
        }
    }
    failures
}

/// Format failures the way the binary prints them; returns process exit code.
#[must_use]
pub fn exit_code_for(failures: &[ScenarioFailure]) -> i32 {
    if failures.is_empty() {
        0
    } else {
        1
    }
}

pub struct Scenario {
    pub run: fn() -> Result<(), ScenarioFailure>,
}

const SCENARIOS: &[Scenario] = &[
    Scenario {
        run: handshake_negotiates_major_v1,
    },
    Scenario {
        run: feature_negotiation_selects_offered_version,
    },
    Scenario {
        run: valid_command_round_trip,
    },
    Scenario {
        run: malformed_handshake_rejected,
    },
    Scenario {
        run: malformed_envelope_bytes_fail,
    },
    Scenario {
        run: compatibility_no_overlapping_major,
    },
    Scenario {
        run: compatibility_unsupported_feature_and_move,
    },
    Scenario {
        run: viewer_spectate_only_cannot_mutate,
    },
    Scenario {
        run: baseline_loss_requires_resync,
    },
    Scenario {
        run: resync_preserves_event_stream,
    },
    Scenario {
        run: wire_fixture_envelope_round_trip,
    },
];

fn handshake_negotiates_major_v1() -> Result<(), ScenarioFailure> {
    let id = "handshake-negotiates-major-v1";
    let mut hub = world_server::SessionHub::new_v1();
    match hub.handshake(hello_aigent(b"c1", b"a1")) {
        HandshakeOutcome::Accepted {
            protocol_major: 1,
            mode: ConnectionMode::CommandCapable,
            session_epoch: Some(_),
            ..
        } => Ok(()),
        other => Err(fail(id, format!("unexpected handshake outcome: {other:?}"))),
    }
}

fn feature_negotiation_selects_offered_version() -> Result<(), ScenarioFailure> {
    let id = "feature-negotiation-selects-offered-version";
    let mut hub = world_server::SessionHub::new_v1();
    hub.offer_feature(1, ConnectionMode::CommandCapable, "demo", 2);
    let mut hello = hello_aigent(b"c-feat", b"a-feat");
    hello.offered_features = vec![
        FeatureOffer {
            feature_id: "demo".into(),
            version: 2,
        },
        FeatureOffer {
            feature_id: "unknown-feature".into(),
            version: 9,
        },
    ];
    match hub.handshake(hello) {
        HandshakeOutcome::Accepted { features, .. } => {
            let demo = features
                .iter()
                .find(|f| f.feature_id == "demo")
                .ok_or_else(|| fail(id, "demo feature not selected"))?;
            if demo.version != 2 {
                return Err(fail(
                    id,
                    format!("expected demo version 2, got {}", demo.version),
                ));
            }
            if features.iter().any(|f| f.feature_id == "unknown-feature") {
                return Err(fail(id, "unknown feature must be ignored"));
            }
            Ok(())
        }
        other => Err(fail(id, format!("handshake failed: {other:?}"))),
    }
}

fn valid_command_round_trip() -> Result<(), ScenarioFailure> {
    let id = "valid-command-round-trip";
    let mut hub = world_server::SessionHub::new_v1();
    let epoch = accepted_epoch(hub.handshake(hello_aigent(b"c-rt", b"a-rt")))
        .map_err(|detail| fail(id, detail))?;
    let outcome = hub.submit_command(cmd(
        b"c-rt",
        &epoch,
        1,
        1,
        b"k-rt",
        CommandKind::CancelIntent,
        b"digest-rt",
    ));
    match outcome {
        CommandOutcome::Result {
            replayed: false,
            result: AuthoritativeResult::Accepted { .. },
            ..
        } => Ok(()),
        other => Err(fail(id, format!("expected accepted result, got {other:?}"))),
    }
}

fn malformed_handshake_rejected() -> Result<(), ScenarioFailure> {
    let id = "malformed-handshake-rejected";
    let mut hub = world_server::SessionHub::new_v1();
    let mismatched = hub.handshake(ClientHello {
        role: ConnectionRole::Aigent,
        offered_majors: vec![1],
        offered_features: vec![],
        aigent_id: Some(b"claimed".to_vec()),
        connection_id: b"c-bad".to_vec(),
        identity: inject(b"trusted"),
    });
    match mismatched {
        HandshakeOutcome::Rejected {
            code: ProtocolErrorCode::InvalidEnvelope,
        } => Ok(()),
        other => Err(fail(
            id,
            format!("expected INVALID_ENVELOPE reject, got {other:?}"),
        )),
    }
}

fn malformed_envelope_bytes_fail() -> Result<(), ScenarioFailure> {
    let id = "malformed-envelope-bytes-fail";
    match Envelope::decode(&b"\x00\xff"[..]) {
        Err(_) => Ok(()),
        Ok(decoded) => Err(fail(
            id,
            format!("expected decode failure, got {decoded:?}"),
        )),
    }
}

fn compatibility_no_overlapping_major() -> Result<(), ScenarioFailure> {
    let id = "compatibility-no-overlapping-major";
    let mut hub = world_server::SessionHub::new_v1();
    let outcome = hub.handshake(ClientHello {
        role: ConnectionRole::Aigent,
        offered_majors: vec![99],
        offered_features: vec![],
        aigent_id: Some(b"a99".to_vec()),
        connection_id: b"c99".to_vec(),
        identity: inject(b"a99"),
    });
    match outcome {
        HandshakeOutcome::Rejected {
            code: ProtocolErrorCode::UnsupportedProtocol,
        } => Ok(()),
        other => Err(fail(
            id,
            format!("expected UNSUPPORTED_PROTOCOL, got {other:?}"),
        )),
    }
}

fn compatibility_unsupported_feature_and_move() -> Result<(), ScenarioFailure> {
    let id = "compatibility-unsupported-feature-and-move";
    let mut hub = world_server::SessionHub::new_v1();
    hub.offer_feature(1, ConnectionMode::CommandCapable, "demo", 1);
    let mut hello = hello_aigent(b"c-uf", b"a-uf");
    hello.offered_features = vec![FeatureOffer {
        feature_id: "demo".into(),
        version: 1,
    }];
    let epoch = accepted_epoch(hub.handshake(hello)).map_err(|detail| fail(id, detail))?;

    let bad_feature = hub.submit_command(CommandSubmit {
        required_features: vec![FeatureOffer {
            feature_id: "demo".into(),
            version: 99,
        }],
        ..cmd(b"c-uf", &epoch, 1, 1, b"k", CommandKind::Stop, b"d")
    });
    match bad_feature {
        CommandOutcome::ProtocolError {
            code: ProtocolErrorCode::UnsupportedFeature,
            ..
        } => {}
        other => {
            return Err(fail(
                id,
                format!("expected UNSUPPORTED_FEATURE, got {other:?}"),
            ))
        }
    }

    let unsupported = hub.submit_command(cmd(
        b"c-uf",
        &epoch,
        2,
        1,
        b"move-key",
        CommandKind::Move,
        b"move-digest",
    ));
    match unsupported {
        CommandOutcome::Result {
            result:
                AuthoritativeResult::Rejected {
                    code: CommandRejectionCode::UnsupportedMessage,
                },
            ..
        } => Ok(()),
        other => Err(fail(
            id,
            format!("expected UNSUPPORTED_MESSAGE, got {other:?}"),
        )),
    }
}

fn viewer_spectate_only_cannot_mutate() -> Result<(), ScenarioFailure> {
    let id = "viewer-spectate-only-cannot-mutate";
    let mut hub = world_server::SessionHub::new_v1();
    let viewer = hub.handshake(ClientHello {
        role: ConnectionRole::Viewer,
        offered_majors: vec![1],
        offered_features: vec![],
        aigent_id: None,
        connection_id: b"v1".to_vec(),
        identity: inject(b"ignored"),
    });
    match viewer {
        HandshakeOutcome::Accepted {
            mode: ConnectionMode::SpectateOnly,
            session_epoch: None,
            ..
        } => {}
        other => {
            return Err(fail(
                id,
                format!("expected spectate-only viewer, got {other:?}"),
            ))
        }
    }
    let mutate = hub.submit_command(cmd(b"v1", b"", 1, 1, b"k", CommandKind::Stop, b"d"));
    match mutate {
        CommandOutcome::Result {
            result:
                AuthoritativeResult::Rejected {
                    code: CommandRejectionCode::SpectateOnly,
                },
            ..
        } => Ok(()),
        other => Err(fail(id, format!("expected SPECTATE_ONLY, got {other:?}"))),
    }
}

fn baseline_loss_requires_resync() -> Result<(), ScenarioFailure> {
    let id = "baseline-loss-requires-resync";
    let mut world = World::new(WorldConfig::default());
    let mut fanout = SnapshotFanout::new();
    fanout.attach(b"c1".to_vec());
    let gen = world.advance_tick().unwrap().clone();
    let first = fanout
        .publish_to(b"c1", &gen, None)
        .ok_or_else(|| fail(id, "publish missing"))?;
    let baseline = match first {
        world_server::PublishOutcome::FullSnapshot { baseline_id, .. } => baseline_id,
        other => return Err(fail(id, format!("expected full snapshot, got {other:?}"))),
    };
    fanout
        .get_mut(b"c1")
        .ok_or_else(|| fail(id, "missing connection"))?
        .snapshot
        .expire_baseline(baseline);
    let payload = world_server::StubSnapshotPayload::from_generation(&gen);
    let err = fanout
        .get_mut(b"c1")
        .unwrap()
        .snapshot
        .deliver_delta(Some(baseline), payload)
        .expect_err("expired baseline must fail");
    if err.reason != SnapshotResyncReason::BaselineExpired {
        return Err(fail(
            id,
            format!("expected BaselineExpired, got {:?}", err.reason),
        ));
    }
    if fanout.get(b"c1").unwrap().snapshot.status() != SnapshotStatus::ResyncRequired {
        return Err(fail(id, "status must be ResyncRequired"));
    }
    Ok(())
}

fn resync_preserves_event_stream() -> Result<(), ScenarioFailure> {
    let id = "resync-preserves-event-stream";
    let mut world = World::new(WorldConfig::default());
    let mailbox = PublicationMailbox::new();
    let mut fanout = SnapshotFanout::new();
    fanout.attach(b"c1".to_vec());
    let gen = world.advance_tick().unwrap().clone();
    mailbox.publish_from_tick(gen.clone());
    let _ = mailbox.take();
    fanout
        .publish_to(b"c1", &gen, None)
        .ok_or_else(|| fail(id, "initial publish missing"))?;
    let baseline = fanout
        .get(b"c1")
        .unwrap()
        .snapshot
        .baseline_id()
        .ok_or_else(|| fail(id, "missing baseline"))?;
    // Seed a non-default event cursor so a buggy resync that resets to defaults fails.
    {
        let connection = fanout.get_mut(b"c1").unwrap();
        connection.events.epoch = 3;
        connection.events.next_sequence = 17;
    }
    fanout
        .get_mut(b"c1")
        .unwrap()
        .snapshot
        .expire_baseline(baseline);
    let events_before = fanout.get(b"c1").unwrap().events.clone();
    if events_before.epoch != 3 || events_before.next_sequence != 17 {
        return Err(fail(
            id,
            format!("seeded cursor lost before resync: {events_before:?}"),
        ));
    }
    world.advance_tick().unwrap();
    let gen2 = world.published().unwrap().clone();
    let (new_baseline, _payload, events_after, _enqueue) = fanout
        .client_resync(b"c1", &gen2, None)
        .ok_or_else(|| fail(id, "resync missing"))?;
    if new_baseline == baseline {
        return Err(fail(id, "resync must allocate a new baseline"));
    }
    if events_after != events_before {
        return Err(fail(
            id,
            format!("event stream mutated: {events_before:?} -> {events_after:?}"),
        ));
    }
    Ok(())
}

fn wire_fixture_envelope_round_trip() -> Result<(), ScenarioFailure> {
    let id = "wire-fixture-envelope-round-trip";
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../protocol/v1/conformance/binary/envelope-protocol-error.hex");
    let text = std::fs::read_to_string(&path)
        .map_err(|error| fail(id, format!("read {}: {error}", path.display())))?;
    let hex: String = text.chars().filter(|c| !c.is_whitespace()).collect();
    let expected = hex::decode(&hex).map_err(|error| fail(id, format!("hex decode: {error}")))?;

    let sample = Envelope {
        protocol_major: 1,
        connection_id: b"conn-1".to_vec(),
        message_id: 42,
        metadata: Some(EnvelopeMetadata {
            required_features: vec![FeatureUse {
                feature_id: "demo".into(),
                version: 1,
            }],
        }),
        body: Some(aigent_protocol::envelope::Body::ProtocolError(
            ProtocolError {
                related_message_id: Some(7),
                code: ProtocolErrorCode::UnsupportedProtocol as i32,
                message: "major 99 unsupported".into(),
                retry_after_ticks: None,
            },
        )),
    };
    let encoded = sample.encode_to_vec();
    if encoded != expected {
        return Err(fail(
            id,
            format!(
                "encode mismatch: got {} expected {}",
                hex::encode(&encoded),
                hex::encode(&expected)
            ),
        ));
    }
    let decoded = Envelope::decode(expected.as_slice())
        .map_err(|error| fail(id, format!("decode: {error}")))?;
    if decoded != sample {
        return Err(fail(id, "decoded envelope != sample"));
    }

    // HandshakeReject wire shape remains decodable (compatibility reporting).
    let reject = HandshakeFrame {
        body: Some(aigent_protocol::handshake_frame::Body::HandshakeReject(
            HandshakeReject {
                code: ProtocolErrorCode::UnsupportedProtocol as i32,
                message: "no overlapping major".into(),
                compatibility: vec![CompatibilityRecord {
                    protocol_major: 1,
                    deprecated_at_unix_ms: 0,
                    command_support_until_unix_ms: 0,
                    current_mode: ProtoConnectionMode::SpectateOnly as i32,
                }],
            },
        )),
    };
    let reject_bytes = reject.encode_to_vec();
    let reject_decoded = HandshakeFrame::decode(reject_bytes.as_slice())
        .map_err(|error| fail(id, format!("reject decode: {error}")))?;
    if reject_decoded != reject {
        return Err(fail(id, "handshake reject round-trip mismatch"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_scenarios_pass() {
        let failures = run_all();
        assert!(failures.is_empty(), "conformance failures: {failures:#?}");
    }

    #[test]
    fn smoke_marker_stable() {
        assert_eq!(SMOKE_MARKER, "protocol-conformance: ok");
    }

    #[test]
    fn mismatch_diagnostics_are_deterministic() {
        let failure = fail("compat-demo", "expected UNSUPPORTED_PROTOCOL, got Accepted");
        assert_eq!(failure.id, "compat-demo");
        assert_eq!(
            failure.detail,
            "expected UNSUPPORTED_PROTOCOL, got Accepted"
        );
        assert_eq!(
            format!("{}: {}", failure.id, failure.detail),
            "compat-demo: expected UNSUPPORTED_PROTOCOL, got Accepted"
        );
    }

    #[test]
    fn forced_mismatch_fails_run_scenarios_and_sets_exit_code() {
        fn always_fail() -> Result<(), ScenarioFailure> {
            Err(fail("forced-mismatch", "expected reject, got accept"))
        }
        let failures = run_scenarios(&[Scenario { run: always_fail }]);
        assert_eq!(failures.len(), 1);
        assert_eq!(failures[0].id, "forced-mismatch");
        assert_eq!(
            format!("  {}: {}", failures[0].id, failures[0].detail),
            "  forced-mismatch: expected reject, got accept"
        );
        assert_eq!(exit_code_for(&failures), 1);
        assert_eq!(exit_code_for(&[]), 0);
    }
}

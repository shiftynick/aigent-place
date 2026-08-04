//! Session / command-result behavioral tests (task-018).

use aigent_protocol::{CommandKind, CommandRejectionCode, ProtocolErrorCode};
use world_server::{
    AuthoritativeResult, ClientHello, CommandOutcome, CommandSubmit, ConnectionMode,
    ConnectionRole, FeatureOffer, HandshakeOutcome, IdentityBinding, SessionHub,
};

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

fn accepted_epoch(outcome: HandshakeOutcome) -> Vec<u8> {
    match outcome {
        HandshakeOutcome::Accepted {
            session_epoch: Some(epoch),
            ..
        } => epoch,
        other => panic!("expected command-capable hello, got {other:?}"),
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

fn result_code(outcome: &CommandOutcome) -> Option<CommandRejectionCode> {
    match outcome {
        CommandOutcome::Result {
            result: AuthoritativeResult::Rejected { code },
            ..
        } => Some(*code),
        _ => None,
    }
}

#[test]
fn reconnect_displaces_and_resets_sequence() {
    let mut hub = SessionHub::new_v1();
    let epoch1 = accepted_epoch(hub.handshake(hello_aigent(b"c1", b"agent-a")));
    let accept = hub.submit_command(cmd(
        b"c1",
        &epoch1,
        1,
        1,
        b"k1",
        CommandKind::CancelIntent,
        b"d1",
    ));
    assert!(matches!(
        accept,
        CommandOutcome::Result {
            replayed: false,
            result: AuthoritativeResult::Accepted { .. },
            ..
        }
    ));

    let second = hub.handshake(hello_aigent(b"c2", b"agent-a"));
    let epoch2 = match second {
        HandshakeOutcome::Accepted {
            displaced: Some(notice),
            session_epoch: Some(epoch),
            ..
        } => {
            assert_eq!(notice.replaced_connection_id, b"c1");
            assert_eq!(notice.replaced_session_epoch, epoch1);
            assert_ne!(epoch, epoch1);
            epoch
        }
        other => panic!("expected displacement, got {other:?}"),
    };

    let stale = hub.submit_command(cmd(b"c1", &epoch1, 2, 2, b"k2", CommandKind::Stop, b"d2"));
    assert_eq!(
        result_code(&stale),
        Some(CommandRejectionCode::StaleSessionEpoch)
    );

    let fresh = hub.submit_command(cmd(b"c2", &epoch2, 1, 1, b"k3", CommandKind::Stop, b"d3"));
    assert!(matches!(
        fresh,
        CommandOutcome::Result {
            sequence: 1,
            result: AuthoritativeResult::Accepted { .. },
            ..
        }
    ));
}

#[test]
fn sequence_gap_reorder_and_replay() {
    let mut hub = SessionHub::new_v1();
    let epoch = accepted_epoch(hub.handshake(hello_aigent(b"c1", b"a1")));
    let gap = hub.submit_command(cmd(b"c1", &epoch, 1, 2, b"k", CommandKind::Stop, b"d"));
    assert_eq!(result_code(&gap), Some(CommandRejectionCode::SequenceGap));

    let first = hub.submit_command(cmd(
        b"c1",
        &epoch,
        2,
        1,
        b"k1",
        CommandKind::CancelIntent,
        b"digest-1",
    ));
    assert!(matches!(
        first,
        CommandOutcome::Result {
            replayed: false,
            result: AuthoritativeResult::Accepted { .. },
            ..
        }
    ));
    let replay = hub.submit_command(cmd(
        b"c1",
        &epoch,
        3,
        1,
        b"k1",
        CommandKind::CancelIntent,
        b"digest-1",
    ));
    assert!(matches!(
        replay,
        CommandOutcome::Result {
            replayed: true,
            result: AuthoritativeResult::Accepted { .. },
            ..
        }
    ));
    let conflict = hub.submit_command(cmd(
        b"c1",
        &epoch,
        4,
        1,
        b"k1",
        CommandKind::CancelIntent,
        b"digest-OTHER",
    ));
    assert_eq!(
        result_code(&conflict),
        Some(CommandRejectionCode::SequenceContentConflict)
    );
}

#[test]
fn idempotency_replays_across_epochs_and_conflicts_on_digest() {
    let mut hub = SessionHub::new_v1();
    let epoch1 = accepted_epoch(hub.handshake(hello_aigent(b"c1", b"a1")));
    let first = hub.submit_command(cmd(
        b"c1",
        &epoch1,
        1,
        1,
        b"same-key",
        CommandKind::CancelIntent,
        b"same-digest",
    ));
    assert!(matches!(
        first,
        CommandOutcome::Result {
            replayed: false,
            ..
        }
    ));

    let epoch2 = accepted_epoch(hub.handshake(hello_aigent(b"c2", b"a1")));
    let replay = hub.submit_command(cmd(
        b"c2",
        &epoch2,
        1,
        1,
        b"same-key",
        CommandKind::CancelIntent,
        b"same-digest",
    ));
    assert!(matches!(
        replay,
        CommandOutcome::Result {
            replayed: true,
            result: AuthoritativeResult::Accepted { .. },
            ..
        }
    ));

    let conflict = hub.submit_command(cmd(
        b"c2",
        &epoch2,
        2,
        2,
        b"same-key",
        CommandKind::CancelIntent,
        b"other-digest",
    ));
    assert_eq!(
        result_code(&conflict),
        Some(CommandRejectionCode::IdempotencyConflict)
    );
}

#[test]
fn unsupported_feature_and_move_rejection_are_stable() {
    let mut hub = SessionHub::new_v1();
    hub.offer_feature(1, ConnectionMode::CommandCapable, "demo", 1);
    let mut hello = hello_aigent(b"c1", b"a1");
    hello.offered_features = vec![FeatureOffer::exact("demo", 1)];
    let epoch = accepted_epoch(hub.handshake(hello));

    let bad_feature = hub.submit_command(CommandSubmit {
        required_features: vec![FeatureOffer::exact("demo", 99)],
        ..cmd(b"c1", &epoch, 1, 1, b"k", CommandKind::Stop, b"d")
    });
    assert!(matches!(
        bad_feature,
        CommandOutcome::ProtocolError {
            code: ProtocolErrorCode::UnsupportedFeature,
            ..
        }
    ));

    let unsupported = hub.submit_command(cmd(
        b"c1",
        &epoch,
        2,
        1,
        b"say-key",
        CommandKind::Say,
        b"say-digest",
    ));
    assert_eq!(
        result_code(&unsupported),
        Some(CommandRejectionCode::UnsupportedMessage)
    );
    let replay = hub.submit_command(cmd(
        b"c1",
        &epoch,
        3,
        1,
        b"say-key",
        CommandKind::Say,
        b"say-digest",
    ));
    assert!(matches!(
        replay,
        CommandOutcome::Result {
            replayed: true,
            result: AuthoritativeResult::Rejected {
                code: CommandRejectionCode::UnsupportedMessage
            },
            ..
        }
    ));
}

#[test]
fn viewer_cannot_mutate_and_mismatched_inject_is_rejected() {
    let mut hub = SessionHub::new_v1();
    let viewer = hub.handshake(ClientHello {
        role: ConnectionRole::Viewer,
        offered_majors: vec![1],
        offered_features: vec![],
        aigent_id: None,
        connection_id: b"v1".to_vec(),
        identity: inject(b"ignored"),
    });
    assert!(matches!(
        viewer,
        HandshakeOutcome::Accepted {
            mode: ConnectionMode::SpectateOnly,
            session_epoch: None,
            ..
        }
    ));
    let mutate = hub.submit_command(cmd(b"v1", b"", 1, 1, b"k", CommandKind::Stop, b"d"));
    assert_eq!(
        result_code(&mutate),
        Some(CommandRejectionCode::SpectateOnly)
    );

    let mismatched = hub.handshake(ClientHello {
        role: ConnectionRole::Aigent,
        offered_majors: vec![1],
        offered_features: vec![],
        aigent_id: Some(b"claimed".to_vec()),
        connection_id: b"c-bad".to_vec(),
        identity: inject(b"trusted"),
    });
    assert!(matches!(
        mismatched,
        HandshakeOutcome::Rejected {
            code: ProtocolErrorCode::InvalidEnvelope
        }
    ));

    let epoch = accepted_epoch(hub.handshake(hello_aigent(b"c-ok", b"trusted")));
    let reuse = hub.handshake(hello_aigent(b"c-ok", b"trusted"));
    assert!(matches!(
        reuse,
        HandshakeOutcome::Rejected {
            code: ProtocolErrorCode::InvalidEnvelope
        }
    ));
    let _ = epoch;
}

#[test]
fn idempotency_conflicts_when_kind_differs_under_same_digest() {
    let mut hub = SessionHub::new_v1();
    let epoch = accepted_epoch(hub.handshake(hello_aigent(b"c1", b"a1")));
    hub.submit_command(cmd(
        b"c1",
        &epoch,
        1,
        1,
        b"k",
        CommandKind::CancelIntent,
        b"digest",
    ));
    let conflict = hub.submit_command(cmd(b"c1", &epoch, 2, 2, b"k", CommandKind::Stop, b"digest"));
    assert_eq!(
        result_code(&conflict),
        Some(CommandRejectionCode::IdempotencyConflict)
    );
}

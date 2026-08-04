//! Feature version set intersection (task-919264).

use world_server::{
    ConnectionMode, ConnectionRole, FeatureOffer, HandshakeOutcome, IdentityBinding, SessionHub,
};

fn hello_aigent(connection_id: &[u8], aigent_id: &[u8]) -> world_server::ClientHello {
    world_server::ClientHello {
        role: ConnectionRole::Aigent,
        offered_majors: vec![1],
        offered_features: vec![],
        aigent_id: Some(aigent_id.to_vec()),
        connection_id: connection_id.to_vec(),
        identity: IdentityBinding::TestTrustedInject {
            aigent_id: aigent_id.to_vec(),
        },
    }
}

#[test]
fn feature_negotiation_intersects_noncontiguous_client_versions() {
    let mut hub = SessionHub::new_v1();
    hub.offer_feature(1, ConnectionMode::CommandCapable, "demo", 2);
    let mut hello = hello_aigent(b"c-gap", b"a-gap");
    // Client supports 1 and 3 only - must not false-accept server mid version 2.
    hello.offered_features = vec![FeatureOffer {
        feature_id: "demo".into(),
        supported_versions: vec![1, 3],
    }];
    match hub.handshake(hello) {
        HandshakeOutcome::Accepted { features, .. } => {
            let demo = features.iter().find(|f| f.feature_id == "demo").unwrap();
            assert_eq!(demo.version(), 1);
        }
        other => panic!("expected accepted handshake, got {other:?}"),
    }

    let mut hello = hello_aigent(b"c-gap2", b"a-gap2");
    hello.offered_features = vec![FeatureOffer {
        feature_id: "demo".into(),
        supported_versions: vec![3],
    }];
    match hub.handshake(hello) {
        HandshakeOutcome::Accepted { features, .. } => {
            assert!(
                features.iter().all(|f| f.feature_id != "demo"),
                "no mutual version must omit the feature"
            );
        }
        other => panic!("expected accepted handshake, got {other:?}"),
    }
}

#[test]
fn feature_negotiation_contiguous_offer_still_picks_highest_mutual() {
    let mut hub = SessionHub::new_v1();
    hub.offer_feature(1, ConnectionMode::CommandCapable, "demo", 2);
    let mut hello = hello_aigent(b"c-cont", b"a-cont");
    hello.offered_features = vec![FeatureOffer {
        feature_id: "demo".into(),
        supported_versions: vec![1, 2, 3],
    }];
    match hub.handshake(hello) {
        HandshakeOutcome::Accepted { features, .. } => {
            let demo = features.iter().find(|f| f.feature_id == "demo").unwrap();
            assert_eq!(demo.version(), 2);
        }
        other => panic!("expected accepted handshake, got {other:?}"),
    }
}

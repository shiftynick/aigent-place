//! Connection sessions, handshake, and authoritative command results.
//!
//! Production authentication is not implemented. Tests bind identity through
//! [`IdentityBinding::TestTrustedInject`] (operator Q2=A / task-018).

use aigent_protocol::{CommandKind, CommandRejectionCode, ProtocolErrorCode};
use std::collections::{BTreeMap, HashMap};

/// How the server obtains the authenticated aigent identity for a hello.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdentityBinding {
    /// Test-only: trust these bytes as the connection's aigent_id.
    /// ClientHello.aigent_id must match exactly.
    TestTrustedInject { aigent_id: Vec<u8> },
}

/// Compatibility row for protocol-major selection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompatibilityRecord {
    pub major: u32,
    pub command_capable: bool,
    pub decoder: bool,
    pub spectator_projection: bool,
    pub deprecated_at_unix_ms: Option<u64>,
    pub command_support_until_unix_ms: Option<u64>,
}

/// Offered feature version during handshake.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FeatureOffer {
    pub feature_id: String,
    pub version: u32,
}

/// Client hello inputs (semantic; no WebSocket).
#[derive(Debug, Clone)]
pub struct ClientHello {
    pub role: ConnectionRole,
    pub offered_majors: Vec<u32>,
    pub offered_features: Vec<FeatureOffer>,
    /// Client-supplied aigent_id bytes (must match inject for aigent role).
    pub aigent_id: Option<Vec<u8>>,
    pub connection_id: Vec<u8>,
    pub identity: IdentityBinding,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionRole {
    Aigent,
    Viewer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionMode {
    CommandCapable,
    SpectateOnly,
}

/// Authoritative accepted/rejected command result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthoritativeResult {
    Accepted {
        affected_entities: Vec<(Vec<u8>, u64)>,
    },
    Rejected {
        code: CommandRejectionCode,
    },
}

impl AuthoritativeResult {
    #[must_use]
    pub fn rejected(code: CommandRejectionCode) -> Self {
        Self::Rejected { code }
    }

    #[must_use]
    pub fn accepted_empty() -> Self {
        Self::Accepted {
            affected_entities: vec![],
        }
    }
}

#[derive(Debug, Clone)]
pub struct CommandSubmit {
    pub connection_id: Vec<u8>,
    pub protocol_major: u32,
    pub message_id: u64,
    pub session_epoch: Vec<u8>,
    pub sequence: u64,
    pub idempotency_key: Vec<u8>,
    pub kind: CommandKind,
    pub content_digest: Vec<u8>,
    pub required_features: Vec<FeatureOffer>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HandshakeOutcome {
    Accepted {
        mode: ConnectionMode,
        protocol_major: u32,
        connection_id: Vec<u8>,
        session_epoch: Option<Vec<u8>>,
        features: Vec<FeatureOffer>,
        upgrade_required: bool,
        displaced: Option<ConnectionDisplaced>,
    },
    Rejected {
        code: ProtocolErrorCode,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectionDisplaced {
    pub replaced_connection_id: Vec<u8>,
    pub replaced_session_epoch: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandOutcome {
    Result {
        command_message_id: u64,
        sequence: u64,
        idempotency_key: Vec<u8>,
        result: AuthoritativeResult,
        replayed: bool,
    },
    ProtocolError {
        code: ProtocolErrorCode,
        related_message_id: Option<u64>,
    },
}

#[derive(Debug, Clone)]
struct IdempotencyRecord {
    content_digest: Vec<u8>,
    kind: CommandKind,
    result: AuthoritativeResult,
}

#[derive(Debug, Clone)]
struct SequenceRecord {
    content_digest: Vec<u8>,
    idempotency_key: Vec<u8>,
    kind: CommandKind,
    result: AuthoritativeResult,
}

#[derive(Debug, Clone)]
struct LiveSession {
    active_epoch: Vec<u8>,
    next_sequence: u64,
    sequences: HashMap<u64, SequenceRecord>,
}

#[derive(Debug, Clone)]
struct Connection {
    mode: ConnectionMode,
    protocol_major: u32,
    #[allow(dead_code)]
    role: ConnectionRole,
    connection_id: Vec<u8>,
    aigent_id: Option<Vec<u8>>,
    selected_features: BTreeMap<String, u32>,
    session: Option<LiveSession>,
    displaced: bool,
}

/// In-memory multi-connection session hub (no WebSocket, no production auth).
#[derive(Debug, Clone)]
pub struct SessionHub {
    compatibility: Vec<CompatibilityRecord>,
    /// major -> mode -> feature_id -> max version
    features: HashMap<u32, HashMap<&'static str, BTreeMap<String, u32>>>,
    connections: HashMap<Vec<u8>, Connection>,
    /// Live command-capable connection per aigent_id.
    live_aigent: HashMap<Vec<u8>, Vec<u8>>,
    idempotency: HashMap<(Vec<u8>, u32, Vec<u8>), IdempotencyRecord>,
    next_epoch: u64,
    /// Server-owned clock for deprecation decisions (injectable in tests).
    evaluation_clock_unix_ms: Option<u64>,
}

impl Default for SessionHub {
    fn default() -> Self {
        Self::new_v1()
    }
}

impl SessionHub {
    /// Hub with protocol major 1 command-capable and empty feature catalogs.
    #[must_use]
    pub fn new_v1() -> Self {
        let mut features = HashMap::new();
        let mut by_mode = HashMap::new();
        by_mode.insert("command_capable", BTreeMap::new());
        by_mode.insert("spectate_only", BTreeMap::new());
        features.insert(1, by_mode);
        Self {
            compatibility: vec![CompatibilityRecord {
                major: 1,
                command_capable: true,
                decoder: true,
                spectator_projection: true,
                deprecated_at_unix_ms: None,
                command_support_until_unix_ms: None,
            }],
            features,
            connections: HashMap::new(),
            live_aigent: HashMap::new(),
            idempotency: HashMap::new(),
            next_epoch: 1,
            evaluation_clock_unix_ms: None,
        }
    }

    /// Set the server evaluation clock used for protocol retirement checks.
    pub fn set_evaluation_clock_unix_ms(&mut self, now: Option<u64>) {
        self.evaluation_clock_unix_ms = now;
    }

    /// Register an available feature version for handshake negotiation.
    pub fn offer_feature(
        &mut self,
        major: u32,
        mode: ConnectionMode,
        feature_id: &str,
        version: u32,
    ) {
        let mode_key = match mode {
            ConnectionMode::CommandCapable => "command_capable",
            ConnectionMode::SpectateOnly => "spectate_only",
        };
        self.features
            .entry(major)
            .or_default()
            .entry(mode_key)
            .or_default()
            .insert(feature_id.to_string(), version);
    }

    pub fn handshake(&mut self, hello: ClientHello) -> HandshakeOutcome {
        if self.connections.contains_key(&hello.connection_id) {
            return HandshakeOutcome::Rejected {
                code: ProtocolErrorCode::InvalidEnvelope,
            };
        }

        let mut offered = hello.offered_majors.clone();
        offered.sort_unstable();
        offered.dedup();
        if offered.is_empty() || offered.iter().any(|&m| m == 0) {
            return HandshakeOutcome::Rejected {
                code: ProtocolErrorCode::InvalidEnvelope,
            };
        }

        match hello.role {
            ConnectionRole::Aigent => {
                let IdentityBinding::TestTrustedInject { aigent_id } = &hello.identity;
                if hello.aigent_id.as_ref() != Some(aigent_id) {
                    return HandshakeOutcome::Rejected {
                        code: ProtocolErrorCode::InvalidEnvelope,
                    };
                }
            }
            ConnectionRole::Viewer => {
                if hello.aigent_id.is_some() {
                    return HandshakeOutcome::Rejected {
                        code: ProtocolErrorCode::InvalidEnvelope,
                    };
                }
            }
        }

        let offered_set: std::collections::HashSet<u32> = offered.iter().copied().collect();
        let now = self.evaluation_clock_unix_ms;
        let command_major = self
            .compatibility
            .iter()
            .filter(|record| {
                offered_set.contains(&record.major)
                    && record.command_capable
                    && record.decoder
                    && match record.deprecated_at_unix_ms {
                        None => true,
                        Some(_) => now
                            .zip(record.command_support_until_unix_ms)
                            .is_some_and(|(now, until)| now <= until),
                    }
            })
            .max_by_key(|record| record.major);
        let retired_major = self
            .compatibility
            .iter()
            .filter(|record| {
                offered_set.contains(&record.major)
                    && record.decoder
                    && record.spectator_projection
                    && record.deprecated_at_unix_ms.is_some()
                    && now
                        .zip(record.command_support_until_unix_ms)
                        .is_some_and(|(now, until)| now >= until)
            })
            .max_by_key(|record| record.major);
        let selected = command_major.or(retired_major);
        let Some(selected) = selected else {
            return HandshakeOutcome::Rejected {
                code: ProtocolErrorCode::UnsupportedProtocol,
            };
        };

        let mode = if command_major.is_some() && hello.role == ConnectionRole::Aigent {
            ConnectionMode::CommandCapable
        } else {
            ConnectionMode::SpectateOnly
        };

        if hello.connection_id.is_empty() {
            return HandshakeOutcome::Rejected {
                code: ProtocolErrorCode::InvalidEnvelope,
            };
        }

        let issued_epoch = if mode == ConnectionMode::CommandCapable {
            let epoch = format!("sess-{}", self.next_epoch).into_bytes();
            self.next_epoch = self.next_epoch.saturating_add(1);
            Some(epoch)
        } else {
            None
        };

        let mode_key = match mode {
            ConnectionMode::CommandCapable => "command_capable",
            ConnectionMode::SpectateOnly => "spectate_only",
        };
        let available = self
            .features
            .get(&selected.major)
            .and_then(|modes| modes.get(mode_key))
            .cloned()
            .unwrap_or_default();
        let features = match select_features(&available, &hello.offered_features) {
            Ok(features) => features,
            Err(()) => {
                return HandshakeOutcome::Rejected {
                    code: ProtocolErrorCode::InvalidEnvelope,
                };
            }
        };

        let mut displaced = None;
        if mode == ConnectionMode::CommandCapable {
            let aigent_id = hello.aigent_id.clone().expect("aigent hello");
            if let Some(previous_conn) = self
                .live_aigent
                .insert(aigent_id.clone(), hello.connection_id.clone())
            {
                if let Some(previous) = self.connections.get_mut(&previous_conn) {
                    if let Some(session) = previous.session.take() {
                        previous.displaced = true;
                        previous.mode = ConnectionMode::SpectateOnly;
                        displaced = Some(ConnectionDisplaced {
                            replaced_connection_id: previous_conn,
                            replaced_session_epoch: session.active_epoch,
                        });
                    }
                }
            }
        }

        let connection = Connection {
            mode,
            protocol_major: selected.major,
            role: hello.role,
            connection_id: hello.connection_id.clone(),
            aigent_id: hello.aigent_id.clone(),
            selected_features: features
                .iter()
                .map(|feature| (feature.feature_id.clone(), feature.version))
                .collect(),
            session: issued_epoch.as_ref().map(|epoch| LiveSession {
                active_epoch: epoch.clone(),
                next_sequence: 1,
                sequences: HashMap::new(),
            }),
            displaced: false,
        };
        self.connections
            .insert(hello.connection_id.clone(), connection);

        HandshakeOutcome::Accepted {
            mode,
            protocol_major: selected.major,
            connection_id: hello.connection_id,
            session_epoch: issued_epoch,
            features,
            upgrade_required: command_major.is_none(),
            displaced,
        }
    }

    /// Look up the aigent id bound to a live connection, if any.
    #[must_use]
    pub fn aigent_id_for(&self, connection_id: &[u8]) -> Option<Vec<u8>> {
        self.connections
            .get(connection_id)
            .and_then(|connection| connection.aigent_id.clone())
    }

    pub fn submit_command(&mut self, command: CommandSubmit) -> CommandOutcome {
        let related = (command.message_id > 0).then_some(command.message_id);
        let Some(connection) = self.connections.get(&command.connection_id).cloned() else {
            return CommandOutcome::ProtocolError {
                code: ProtocolErrorCode::InvalidEnvelope,
                related_message_id: related,
            };
        };
        if connection.displaced
            || command.protocol_major != connection.protocol_major
            || command.connection_id != connection.connection_id
            || command.message_id == 0
            || command.sequence == 0
            || command.idempotency_key.is_empty()
        {
            if connection.displaced
                && command.protocol_major == connection.protocol_major
                && command.connection_id == connection.connection_id
                && command.message_id > 0
                && command.sequence > 0
                && !command.idempotency_key.is_empty()
            {
                return reject_result(
                    command.message_id,
                    command.sequence,
                    command.idempotency_key,
                    CommandRejectionCode::StaleSessionEpoch,
                    false,
                );
            }
            return CommandOutcome::ProtocolError {
                code: ProtocolErrorCode::InvalidEnvelope,
                related_message_id: related,
            };
        }
        for feature in &command.required_features {
            if connection.selected_features.get(&feature.feature_id) != Some(&feature.version) {
                return CommandOutcome::ProtocolError {
                    code: ProtocolErrorCode::UnsupportedFeature,
                    related_message_id: related,
                };
            }
        }
        if connection.mode != ConnectionMode::CommandCapable {
            return reject_result(
                command.message_id,
                command.sequence,
                command.idempotency_key,
                CommandRejectionCode::SpectateOnly,
                false,
            );
        }
        let session = connection.session.as_ref().expect("command-capable");
        if command.session_epoch != session.active_epoch {
            return reject_result(
                command.message_id,
                command.sequence,
                command.idempotency_key,
                CommandRejectionCode::StaleSessionEpoch,
                false,
            );
        }

        if command.sequence < session.next_sequence {
            if let Some(prior) = session.sequences.get(&command.sequence) {
                if prior.content_digest == command.content_digest
                    && prior.idempotency_key == command.idempotency_key
                    && prior.kind == command.kind
                {
                    return CommandOutcome::Result {
                        command_message_id: command.message_id,
                        sequence: command.sequence,
                        idempotency_key: command.idempotency_key,
                        result: prior.result.clone(),
                        replayed: true,
                    };
                }
            }
            return reject_result(
                command.message_id,
                command.sequence,
                command.idempotency_key,
                CommandRejectionCode::SequenceContentConflict,
                false,
            );
        }
        if command.sequence > session.next_sequence {
            return reject_result(
                command.message_id,
                command.sequence,
                command.idempotency_key,
                CommandRejectionCode::SequenceGap,
                false,
            );
        }

        // Exact-next: kind availability before cross-epoch idempotency.
        if !kind_available(command.kind) {
            return self.record_exact_rejection(&command, CommandRejectionCode::UnsupportedMessage);
        }

        let aigent_id = connection.aigent_id.clone().expect("aigent");
        let key = (
            aigent_id.clone(),
            connection.protocol_major,
            command.idempotency_key.clone(),
        );
        let (result, replayed) = if let Some(prior) = self.idempotency.get(&key) {
            if prior.content_digest != command.content_digest || prior.kind != command.kind {
                return self
                    .record_exact_rejection(&command, CommandRejectionCode::IdempotencyConflict);
            }
            (prior.result.clone(), true)
        } else {
            // Available kinds with empty authoritative mutation (cancel/stop and
            // geometry no-ops until the world core applies typed payloads).
            let result = AuthoritativeResult::accepted_empty();
            self.idempotency.insert(
                key,
                IdempotencyRecord {
                    content_digest: command.content_digest.clone(),
                    kind: command.kind,
                    result: result.clone(),
                },
            );
            (result, false)
        };

        self.store_sequence_result(&command, result.clone());
        CommandOutcome::Result {
            command_message_id: command.message_id,
            sequence: command.sequence,
            idempotency_key: command.idempotency_key,
            result,
            replayed,
        }
    }

    fn record_exact_rejection(
        &mut self,
        command: &CommandSubmit,
        code: CommandRejectionCode,
    ) -> CommandOutcome {
        let result = AuthoritativeResult::rejected(code);
        self.store_sequence_result(command, result.clone());
        CommandOutcome::Result {
            command_message_id: command.message_id,
            sequence: command.sequence,
            idempotency_key: command.idempotency_key.clone(),
            result,
            replayed: false,
        }
    }

    fn store_sequence_result(&mut self, command: &CommandSubmit, result: AuthoritativeResult) {
        let connection = self
            .connections
            .get_mut(&command.connection_id)
            .expect("connection");
        let session = connection.session.as_mut().expect("session");
        session.sequences.insert(
            command.sequence,
            SequenceRecord {
                content_digest: command.content_digest.clone(),
                idempotency_key: command.idempotency_key.clone(),
                kind: command.kind,
                result,
            },
        );
        session.next_sequence += 1;
    }
}

fn kind_available(kind: CommandKind) -> bool {
    matches!(
        kind,
        CommandKind::Move
            | CommandKind::CancelIntent
            | CommandKind::Stop
            | CommandKind::PlaceObject
            | CommandKind::SetShape
            | CommandKind::Unstick
    )
}

fn reject_result(
    message_id: u64,
    sequence: u64,
    idempotency_key: Vec<u8>,
    code: CommandRejectionCode,
    replayed: bool,
) -> CommandOutcome {
    CommandOutcome::Result {
        command_message_id: message_id,
        sequence,
        idempotency_key,
        result: AuthoritativeResult::rejected(code),
        replayed,
    }
}

fn select_features(
    available: &BTreeMap<String, u32>,
    offered: &[FeatureOffer],
) -> Result<Vec<FeatureOffer>, ()> {
    let mut seen = std::collections::HashSet::new();
    let mut selected = Vec::new();
    for offer in offered {
        if offer.version == 0 || !seen.insert(offer.feature_id.clone()) {
            return Err(());
        }
        if let Some(&server_version) = available.get(&offer.feature_id) {
            let version = offer.version.min(server_version);
            if version > 0 {
                selected.push(FeatureOffer {
                    feature_id: offer.feature_id.clone(),
                    version,
                });
            }
        }
    }
    selected.sort_by(|left, right| left.feature_id.cmp(&right.feature_id));
    Ok(selected)
}

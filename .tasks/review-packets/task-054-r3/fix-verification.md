# Verified repairs for round3

Physical state FIFO and accounting: original8e236+regression tests compiled; coalescing_withdraws_superseded_socket_frames failed16vs1 retainedframes; buffered_enter_is_not_lost_after_the_old_frame_count_limit failed{}vs{1}. Incremental coalescing always promotes to full, physically removes only pending state, and retains active-write charges and ordered/control frames.

Delta-only coalescing: originalsource red test delta_only_coalescing_emits_a_complete_full_snapshot compiled then failed because it remainedDelta. Repaired queue/fanout promotes every dropped incremental transition to full.

Resync hold: originalsource red resync_waits_for_full_write_and_charges_exact_envelope failed"resync remains held while full is only buffered". Matching-full completion releases hold; an older active full cannot release a newer hold. Exact same serialized envelope drives measurement and send.

Orderedresults: originalsource red ordered_results_are_not_evicted_by_frame_count_pressure failed792byteschargedvs528received. The single byte-driven FIFO preserves all24resultsequence values, with no frame-count eviction.

Corruptshape: originalsource invalid_shape_does_not_install_a_partial_snapshot failed on successfulFull. Fallible conversion reports SnapshotEncodeError(entity_id,cause) and leaves interest/baseline untouched; recovery is typed/observable. Failedresync preserves baseline,interest,eventcursor. Realbaselinefullbody retained separately fromlastdelta.

Cancellableactivewrite: await-only helper red close_cancels_a_confirmed_active_write compiled then timed out afteroneshot proves activewrite started. Newclose-select helper stops the stalledwrite without ack; pendingfull+ordered and newerhold/chargedactivebytes remainuntilcleanup.

Generatedviewer: originalsource with red decoder/actualmain tests ran17tests:10failures. It lost fullshape fields, accepted missingdigest/revision/position/overbounds, and malformedwire. Generatedmessage returnvalues plus descriptor framing and semanticvalidation preserve fullshape fields and requireddata.16semantic/render/recoverymutants and4outerenvelope/handshake mutants eachcompiled and produced behavioralassertion failures.

Outerframing: pre-outerfix main ran13tests:7failed onwrongknownfieldwire,nestedboundaries,nestedmetadata,andmalformedhandshake. Shared framing guard now covers envelope and handshake too. Unknown-group red test compiled:2passed/1failed on11-bytevarint; recursive strictunknown-group guard retains validunknown groups and rejectsbadvarints,lengths,mismatched/missingends,depth>100.

Viewerreconnect: realmain tests now exercise generated positions,targetinterpolation,fullreplacement,enter/modify/leave,meshresource disposal,oldsocket callbacks,newbaseline identity,malformed/unsupported recovery,and invalidtransition atomicity. The renderer is the only substituted UIboundary; no copiedstateimplementation.

Realworkload: constant_bytes,missing_bodies,missing_shapes mutants eachcompiled thenassertionfailed with targetedfailure markers. Restored source passes. All500viewers/300aigents receive realencodedstate in a bounded8tickslice; one valid slowviewer receives160ticks of coalescingpressure. Actualreturnedframes are decoded against independentauthoritativenearest100records and measuredwirelengths; ordered-eventoverflow closesonlyisolatedtestconnection after40ticks.

AOIfixture: strictshapeencoder exposed5/6existing liveAOI testfailures (typedempty-sloterror andsockettimeouts). Replacedzero-byteemptytree fixture with deterministicnonemptybox;6/6nowpass without weakeningcorruption rejection.

Historicalfixtureoverwrite andresyncundercharge fixes are preserved; gate continues comparing Rustencodedbytes tocommittedhex withoutwriting bydefault. Fixtures are decoded and fullyasserted bygeneratedviewer tests.

Final semantic envelope/hello repair and final gate evidence are appended after their real runs.

Finalsemanticboundary: pre-fix actualmain regression command node /tmp/task054-semantic-red.mjs ran23isolatedidentity/zeroID/duplicateID/missingmetadata/unselectedfeature/direction/hello cases;0pass/23behavioralassertionfailures. Currentactualviewer passes54tests;9individualsemanticguard mutants failtheir namedassertions. The viewer now rejectsinvalididentity,IDs,metadata,features,anddirectionbeforestatechanges,andrejectsinvalidhello beforeinstalling negotiatedidentity. Legitimate distinctnoncontiguous/out-of-order IDsremainvalid. Legalunknownmetadatafields survive, while malformednestedknown fields failbefore featuresemantics.

Final unified gate was rerun after all mutations and final documentation/cache fixes: exit 0 in 52.0s; product provenance is captured in evidence.md.


## Incomplete round3 attempt: verified findings and repairs

The first dispatch returned error_max_budget_usd for both axes; it is not a completed cold-review round or passing review. Its assistant findings were independently checked against the tree. Retry uses the same round3, independent calls, fresh finished packet and sufficient budget.

SPEC low finding about post-mutation gate provenance: all mutation scripts restore source; the final unified gate was nevertheless rerun after every mutation and final edit. Fresh product diff/status capture and SHA-256 immediately follow it in this packet.

STANDARDS medium protocol-documentation finding: verified missing inner snapshot semantics in CONTRACT.md. The normative contract now records body/delta versions, digest, ID/revision/position/shape fields, nearest-first cap, explicit unique/disjoint transition sets, atomic invalid-transition recovery and complete-full replacement/hold rules. Focused protocol/world contract checks pass (31 tests), followed by the complete gate. No new schema or architecture decision.

STANDARDS low unbounded-ID-history finding: verified seenMessageIds previously grew across a long connection. A private 65,536-ID cap renews the socket/identity and full baseline before accepting another unique envelope. node /tmp/task054-cap-red.mjs runs the actual-main boundary regression against pre-cap source: compiled/run, assertion failure 1 != 3 at “the next new ID closes the bounded session”. Final test accepts all 65,536 prior IDs, closes once, disposes meshes, accepts fresh identity/baseline/ID1 and rejects stale callback. Final 55/55 viewer tests and full gate pass.

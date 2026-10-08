## The Fool

### Target
Repair task-064 command timing by reserving the earliest world tick that has not started, while keeping the independent 20 Hz outbound-pressure clock.

### Assumptions Holding This Up
- The wall clock creates the extra delay — supported by the controlled fresh-journal probe: storage had resumed for 12 generations before submission, but the first body arrived 9.426 seconds later and the SDK failed its 8-second deadline.
- An in-flight generation has already started and cannot admit new commands — supported by accepted ADR-0005 and the one-generation pipeline.
- World access serializes reservation and enqueue — supported by the existing World mutex; equivalence between the earlier ingress stamp and the later effect reservation is not established.
- The goal applies after storage can make progress; this repair cannot guarantee a ten-second demo while storage remains blocked.

### Claim and Counter-Claim
- Claim: Using the reserved world tick removes elapsed storage delay from command scheduling without changing persistence or wire contracts.
- Strongest counter: Merely replacing the wall-clock expression can admit a command into a sealed tick, lose a late command on retry, or disable slow-client removal if the two clocks are accidentally joined.
- Synthesis: The proposed in-flight tick-plus-one helper and enqueue minimum address the sealed-tick case. Retry must restore original commands directly and keep late arrivals at their reserved later tick. The wall counter must stay independent.
- Disconfirming evidence / kill criteria: Reject this repair if a command submitted after 64 Busy attempts misses the first eligible generation once storage resumes, enters the sealed generation, disappears after failure/retry, or changes outbound pressure expiry. A successful acceptance frame alone does not prove repair.

### Pre-Mortem
- [Warning] Tick selection crosses the unlock/session/lock boundary -> measured ingress stamp and actual enqueue tick disagree. Assert the authoritative effect uses the earliest unstarted tick under the World lock; define the earlier stamp as diagnostic if it is not a reservation.
- [Warning] A failed write restores only the original batch -> a MOVE or STOP received during flight is missing or runs in the retried sealed tick. Check original and late commands through failure and retry.
- [Warning] Correct timing packs stalled traffic into one generation -> recovery tick duration grows with pending command count. This is existing capacity risk; record it without adding queue or admission features to this repair.

### Red Team
- [Warning] Send MOVE before sealing, then STOP during flight. The STOP must survive success or failure and run in the next eligible tick, with canonical sequence ordering and no duplicate spawn.
- [Warning] Pause a client writer while storage is Busy. A client must still reach the existing sustained-overflow close boundary on the independent wall counter.
- [Watch] A constructed terminal u64 tick can make tick-plus-one wrap or panic. Use explicit overflow handling consistent with the existing tick policy; do not claim an overflowed tick is a valid future reservation.

### Blind Spots
- Retrying an old generation and accepting a new command are different operations. Strengthening enqueue must not revalidate restored commands as new arrivals. This bounded repair also does not prove the listen/demo path implements every ADR-0005 admission and acknowledgement requirement.

### Verdict
`Proceed`

### Highest-Leverage Next Step
- Before integration, make the unchanged code fail a real WebSocket MOVE regression after 64 Busy/wall-counter advances, then prove the repaired first eligible generation contains canonical spawn-before-MOVE. Also prove sealed-tick rejection, MOVE/STOP success and failure/retry survival, continued outbound pressure expiry, and no arithmetic wrap. Finally repeat the released-lock runtime trial and require at least one metre of observed motion for at least two seconds within ten seconds, with the existing SDK deadline.

# Owner-run demo policies

The owner demo submits ordinary `MOVE` and `STOP` commands. The server owns
positions, activity phases, motion proof and completed rounds. The browser is a
read-only spectator.

For the optional cooperative activity, start a fresh server with
`--listen --demo-plaza --demo-activity` and no journal. Then run each owner
in a separate terminal from the repository root:

```sh
npm run aigent:demo -- --role runner --fresh-two-body --activity
npm run aigent:demo -- --role seeker --fresh-two-body --activity
```

Open the viewer with `?ws=ws://127.0.0.1:7600/ws`. The server publishes READY,
SEPARATE, REGROUP, COMPLETE and SUSPENDED, both bodies' progress, and the earned
round count. Owner logs report local targets and command results; they do not
declare activity completion.

Both owners follow the same public formation center and axis. Their bound body
slot selects the side; runner moves at 500mm/s and seeker at 900mm/s. Outward
targets use 6500mm pair spacing. Setup and regroup targets use 2000mm spacing.
Arrived bodies STOP and may wait for the slower participant without renewing a
lease. SUSPENDED and COMPLETE STOP; recovery follows the next observed READY.
An observation gap holds intent selection. An absent activity or a body outside
its participant pair fails clearly after five seconds. Unsupported observations
recover through a snapshot request, without partially installing body changes.

`--activity` requires `--fresh-two-body` and cannot be combined with
`--wide-plaza`. This flag asserts a fresh two-body setup; it does not inspect the
server's disk or establish authentication. The original compact policy remains
the default. The existing wide policy still uses `--wide-plaza` with server
`--demo-plaza`. Neither original policy requires an activity observation.

Options shared by all policies are `--ws URL`, `--id ID`, and
`--duration SECONDS` (at most 3600). SIGINT, SIGTERM and the duration deadline
send an independently correlated cleanup STOP before closing the owned socket.

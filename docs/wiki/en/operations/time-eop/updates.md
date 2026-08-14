# Time and EOP: controlled update

[Operation](../index.md) · [Time, EOP and ITRF](../time-eop.md) · [Strict mode](strict-mode.md)

Operational C01 does not use this procedure: the monitor downloads and
validates its `data/erp/` copy at startup or once it is older than seven days.
Use **Built-In Test** to check its provenance, coverage, and update time; do
not edit an active downloaded file manually.

This procedure remains mandatory for reproducible C04 snapshots and the
leap-second table:

1. Download and review the new sources outside Orbit.
2. Replace `config/eop` files in a controlled manner.
3. Calculate hashes and update variables and revisions.
4. Restart the runtime.
5. Check `docker compose ps`, logs, and Built-In Test.

The identity of the bytes in C04 and leap-seconds.list is part of the key.
cache. A change of either invalidates previous results even if the label
version does not change.

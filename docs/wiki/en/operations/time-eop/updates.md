# Time and EOP: controlled update

[Operation](../index.md) · [Time, EOP and ITRF](../time-eop.md) · [Strict mode](strict-mode.md)

1. Download and review the new fonts outside of Orbit.
2. Replace config/eop files in a controlled manner.
3. Calculate hashes and update variables and revisions.
4. Restart runtime.
5. Check docker compose ps and logs.

The identity of the bytes in C04 and leap-seconds.list is part of the key.
cache. A change of either invalidates previous results even if the label
version does not change.
# Time and EOP: local files

[Operation](../index.md) · [Time, EOP and ITRF](../time-eop.md)

| Product | Function | Accepted format |
| --- | --- | --- |
| IERS EOP C04 | DUT1, polar motion, dX, dY and LOD. | ASCII C04-14 or C04-20 with IAU 2000A dX/dY. |
| leap-seconds.list | UTC, TAI, TT and GNSS scales. | ASCII IERS/NTP with identity and expiration. |

Do not use a C04 IAU 1980 that declares dPsi/dEps instead of dX/dY. Orbit it
rejects when the header identifies it.
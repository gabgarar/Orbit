# Time operation, EOP and ITRF

[Start](../index.md) · [Operation](index.md) · [Settings](configuration.md)

Orbit treats time, terrestrial orientation and realization as contracts
explicit. Does not discharge time products during a propagation or a
transformation: The operator mounts local snapshots and identifies each revision.

## Temporal and frame chain

~~~mermaid
flowchart LR
    UTC[UTC] -->|DUT1| UT1[UT1]
    UTC -->|segundos intercalares| TAI[TAI]
    TAI -->|+ 32.184 s| TT[TT]
    I[GCRF / ICRF / EME2000] --> C[CIRS] --> T[TIRS] --> R[ITRF]
    M[TEME] --> P[PEF] --> R
~~~

The interface displays UTC. UT1 is obtained by applying DUT1 and TT using
UTC → TAI → TT. Generic ECI and ECEF labels are rejected. The acronym
correct is ITRF, not IRTF.

## Operational guides

| Theme | Content |
| --- | --- |
| [Local Files](time-eop/data-files.md) | C04 and leap-seconds.list required. |
| [Strict Mode](time-eop/strict-mode.md) | Hashes, variables and testable coverage. |
| [Realizations and visual mode](time-eop/realizations.md) | IGS20, ITRF2020 and approaches. |
| [Controlled Update](time-eop/updates.md) | Snapshot renewal and cache invalidation. |
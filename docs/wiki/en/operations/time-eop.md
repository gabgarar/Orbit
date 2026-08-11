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

A rigorous `ITRF` label is not inferred from the globe or a UTC≈UT1 rotation.
Transforming an inertial state requires an explicit frame route, leap seconds,
and versioned EOP — at minimum DUT1, `xp`, `yp`, and `dX`/`dY` in the CIO
reduction. Without them the interface can present only an **approximate
Earth-fixed view**, never relabel it as ITRF.

For an imported GNSS product, the ERP selected with SP3 is the product contract
for requesting ITRF-to-ECI. It supplies UT1 and polar motion, but does not by
itself create an IGS-to-ITRF datum operation: the applicable realization route
must also exist and be applied. Only then does the UI show **ITRF (con ERP
aplicado)**. When ERP is absent, it must show **Marco terrestre aproximado (sin
ERP)** and reject any request declaring `require_eci`. The global C04 snapshot
is not silently adopted as an ERP for an SP3 revision: both sources retain
their own version and provenance.

## Operational guides

| Theme | Content |
| --- | --- |
| [Local Files](time-eop/data-files.md) | C04 and leap-seconds.list required. |
| [Strict Mode](time-eop/strict-mode.md) | Hashes, variables and testable coverage. |
| [Realizations and visual mode](time-eop/realizations.md) | IGS20, ITRF2020 and approaches. |
| [Controlled Update](time-eop/updates.md) | Snapshot renewal and cache invalidation. |

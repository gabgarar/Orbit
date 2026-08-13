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

## Manual orbit: TIME tab and local ERP

The manual-orbit design **TIME** tab contains two separate contracts:
**Design window** defines the UTC epochs to propagate, while **Orbit preview
frame** only chooses how to inspect the ephemeris. They are not two clocks or
two different dynamics.

A manual orbit ERP is explicitly attached from that tab as a local file. Orbit
does not silently download or adopt the global C04, an ERP belonging to an
already-loaded SP3, or an Internet value to complete that file. The result keeps
the attached ERP's name, provider, digest, UTC scale, and coverage limits.

After the ERP validates successfully, TIME replaces the **Design window** with
the complete interval covered by the file:

$$
D=[t_{ERP,min},t_{ERP,max}].
$$

It is not automatically clipped to an SP3/OEM layer already in the scene.
Clipping would hide the fact that the products have different coverages and
would change the manual design without an explicit operator action.

### When ERP is mandatory

The manual ERP is required when the Cowell composition includes an Earth-bound
force: currently `geopotential` or `drag`. Before previewing or creating, Orbit
requires the ERP to cover the complete design interval:

$$
D\subseteq E_{ERP}.
$$

When it is absent the error is **“Debe proporcionar un fichero ERP para
convertir a ECI.”**; when present but not covering the entire window, creation
is rejected with a coverage explanation. An operator can still design an
inertial-only force composition —for example `central`, third body, SRP, or
relativity— without attaching an ERP, but that does not enable a rigorous
Earth-fixed evaluation. Leap-second and ERFA requirements remain independent
from the manual ERP.

### Alignment with SP3, OEM, and scene range

There are no different “time frames”: Orbit's common clock is UTC. Coverage
may differ. Given a scene window \(S\) and finite layers with published domains
\(P_1,\ldots,P_k\), the permitted interval for a comparison, joint plot, or
calculation using both sources is:

$$
C=D\cap S\cap P_1\cap\cdots\cap P_k.
$$

- If \(C\) exists but is smaller than \(D\), TIME reports the **common
  window**. A joint operation must use it and must not extrapolate SP3/OEM.
- If \(C\) is empty, the manual orbit may be created when its own ERP contract
  is valid, but it cannot be presented as comparable or jointly analysable
  with those layers until the operator chooses overlapping products/ranges.
- Attaching an ERP never silently changes the global range. The operator may
  explicitly apply the common window, preserving reproducible project timing.

Manual-orbit provenance must include its design window, ERP coverage and digest
when used, selected preview frame, and the effective common window whenever a
multi-source operation runs.

## Operational guides

| Theme | Content |
| --- | --- |
| [Local Files](time-eop/data-files.md) | C04 and leap-seconds.list required. |
| [Strict Mode](time-eop/strict-mode.md) | Hashes, variables and testable coverage. |
| [Realizations and visual mode](time-eop/realizations.md) | IGS20, ITRF2020 and approaches. |
| [Controlled Update](time-eop/updates.md) | Snapshot renewal and cache invalidation. |

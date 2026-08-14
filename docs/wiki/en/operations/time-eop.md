# Time operation, EOP and ITRF

[Start](../index.md) · [Operation](index.md) · [Settings](configuration.md)

Orbit treats time, terrestrial orientation and realization as explicit
contracts. No propagation or transformation downloads time products. The
runtime may refresh a generic operational cache in the background at startup;
strict scientific routes still identify their local snapshots and every
revision used.

## Automatic IERS C01 cache

When no reproducible `ORBIT_EOP_C04_PATH` snapshot is configured, the health
monitor tries to load the official
[IERS EOP_C01_IAU2000_1846-now](https://datacenter.iers.org/data/latestVersion/EOP_C01_IAU2000_1846-now.txt)
product. Its mutable cache is:

```text
./data/erp/EOP_C01_IAU2000_1846-now.txt
```

The monitor validates the local copy first. If it is missing or its
modification time is older than seven days, it downloads the file over HTTPS,
validates it completely, and atomically replaces the cache. Startup and
`/health` do not wait for that download: the viewer retains nominal rotation
while the monitor works.

Validation requires a non-empty file, the C01 `COMB EARTH ROTATION DATA`
header, `MJD`, `PM-X`, `PM-Y`, `UT1-TAI`, `dX`, `dY`, and `LOD` columns,
ordered epochs, and finite values inside physical envelopes. C01 publishes
`UT1-TAI`, which Orbit converts to `UT1-UTC` with the local leap-second table;
it is not interpreted as C04. `PM-X`, `PM-Y`, `dX`, and `dY` are converted from
arcseconds to radians; `LOD` is already expressed in seconds.
The example probe checks the nominal `|LOD| < 1 ms` value; the parser also uses
a ±10 ms corruption envelope so it does not reject a legitimate combined or
historical IERS series by design. That operational limit does not alter the
stricter policy for an ERP attached to a product.

- If IERS fails while a validated copy exists, Orbit keeps that copy and
  publishes **Warning** with its age.
- If there is no valid copy, it publishes **Warning** or **Error** and uses
  only nominal ITRF rotation for visualization. It never invents ERP or
  extrapolates coverage.
- The file is outside the Docker image and mounted through `./data`, so it
  survives a restart without becoming release content.

This cache is global operational orientation, not a product ERP replacement or
implicit authorization for strict ECI. An explicit C04 has priority and is
never automatically replaced. An ERP attached to an SP3 keeps its own source,
coverage, and provenance.

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

In that same explicit action, the physical **State-vector epoch** is anchored
to \(t_{ERP,min}\). This prevents an old draft epoch from surviving when the
new ERP does not cover it. It may be edited afterwards, but Earth-bound forces
require it to remain within ERP coverage.

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
| [Local Files](time-eop/data-files.md) | Automatic C01 cache, explicit C04, and leap-seconds.list. |
| [Strict Mode](time-eop/strict-mode.md) | Hashes, variables and testable coverage. |
| [Realizations and visual mode](time-eop/realizations.md) | IGS20, ITRF2020 and approaches. |
| [Controlled Update](time-eop/updates.md) | Snapshot renewal and cache invalidation. |

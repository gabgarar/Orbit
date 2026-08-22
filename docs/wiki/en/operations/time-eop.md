# Time operation, EOP and ITRF

[Start](../index.md) · [Operation](index.md) · [Settings](configuration.md)

Orbit treats time, terrestrial orientation and realization as explicit
contracts. No propagation or transformation downloads time products. The
runtime may refresh a generic operational cache in the background at startup;
strict scientific routes still identify their local snapshots and every
revision used.

## Automatic IERS sources: C01 and finals2000A

When no reproducible `ORBIT_EOP_C04_PATH` snapshot is configured, the health
monitor tries to load the official
[IERS EOP_C01_IAU2000_1846-now](https://datacenter.iers.org/data/latestVersion/EOP_C01_IAU2000_1846-now.txt)
product. Its mutable cache is:

```text
./data/erp/EOP_C01_IAU2000_1846-now.txt
```

The monitor validates the local copy first. If it is missing, its modification
time is older than seven days, **or it no longer covers the instant being
checked**, it downloads the file over HTTPS, validates it completely, and
atomically replaces the cache. Thus a recent download that was published with
old coverage is not presented as current EOP. Startup and `/health` do not wait
for that download: the viewer retains nominal rotation while the monitor works.

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
  publishes **Warning** with its age and coverage boundary as separate facts.
- If C01 does not cover a stage, Orbit may continue with the next automatic
  product described below; it never presents that transition as if C01 remained
  current.
- The file is outside the Docker image and mounted through `./data`, so it
  survives a restart without becoming release content.

This cache is global operational orientation, not a product ERP replacement or
implicit authorization for strict ECI. An explicit C04 has priority and is
never automatically replaced. An ERP attached to an SP3 keeps its own source,
coverage, and provenance.

### Official rapid bridge and quality boundaries

When C01 does not reach a requested epoch, Orbit also queries the official IERS
Rapid Service / Prediction Centre product
[`finals2000A.all`](https://datacenter.iers.org/products/eop/rapid/standard/finals2000A.all).
It is downloaded only over HTTPS from the IERS Data Center, validated before
activation, and retained as a separate operational cache. A propagation,
transformation, or pass calculation never starts a download: only the
startup/diagnostic monitor refreshes these caches.

Its default path is `./data/erp/finals2000A.all`; a deployment can select
another mounted path through `ORBIT_FINALS2000A_CACHE_PATH`. Like C01, these
are mutable operational bytes outside a project and release image.

`finals2000A.all` is a daily ASCII product with EOP since 1973 and the IAU
2000A (`dX`/`dY`) representation. Its flags are part of the data: `I` denotes
the available IERS/Bulletin A determination for that parameter and `P` a
Bulletin A prediction. The file also contains Bulletin B columns. Orbit labels
a complete Bulletin B tuple `final` (**LOD remains Bulletin A or optional**);
otherwise, a Bulletin A tuple whose flags are all `I` is `rapid`, and one with
any `P` is `predicted`. It therefore never
calls the whole table “final” or turns a prediction into an observation. `LOD`
is not invented when its field is blank.

IERS normally publishes Bulletin A predictions for up to roughly one year, but
Orbit uses only rows actually present and validated in the snapshot; it neither
assumes a 365-day horizon nor turns that publication horizon into a precision
guarantee.

Automatic selection is evaluated **per epoch**, in this order, retaining the
provenance of each interval:

| Available interval | Source used | Label and guarantee |
| --- | --- | --- |
| The epoch is inside validated C01 coverage. | `EOP_C01_IAU2000`. | Combined C01 EOP; its end is a factual boundary of that particular cache copy. |
| C01 does not cover the epoch and `finals2000A.all` has every usable required parameter. | `finals2000A.all`. | `final` quality (complete Bulletin B tuple; LOD Bulletin A/optional), `rapid` (Bulletin A `I`), or `predicted` (any `P`), explicitly shown. A prediction is neither an observation nor a product ERP. |
| The epoch is after the last usable data from both automatic products, but no more than 30 days after the finals end. | Local linear extrapolation from the last two usable `finals2000A.all` samples. | **Extrapolated**: not IERS, not a valid ERP, and never enables a strict scientific route. |
| More than 30 days after the usable finals end, or without two compatible samples. | No automatic EOP. | `UTC≈UT1 visual fallback` with `approximate` quality; a strict route rejects and no slope is fabricated. |

There is no fixed calendar date for these transitions: they depend on the
validated samples in the two caches. The linear tail is hard-limited to **30
days** after the usable end of `finals2000A.all`. If that horizon is exceeded
or two compatible samples are unavailable, Orbit does not manufacture a slope;
the view degrades to nominal rotation and strict operations reject according to
their contract.

Linear extrapolation is a clearly labelled operational resource, not an
official IERS prediction. It never replaces configured C04, an SP3-bound ERP,
or a manual ERP; nor does it make an ECI/ITRF transformation valid when that
route requires a reproducible snapshot. Results retain `source`, quality, and
the interval of use, so an operator can exclude it or repeat the calculation
with updated data.

The **Diagnostics** ERP component exposes these transitions as
`coverageTimeline`: C01/finals intervals and, when needed, a
`linear-extrapolation` object with `start`, `end`, `startsAfter`, `quality`,
and `maxHorizonDays: 30`; it then publishes `nominal-fallback` from that `end`
with no finite end. `selection` repeats the operational instants
`extrapolationStartsAt`, `extrapolationEndsAt`, and `nominalFallbackStartsAt`.
They are facts from the validated cache, not manually configured dates.

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

## Manual orbit: TIME tab and optional local ERP

The manual-orbit design **TIME** tab contains two separate contracts:
**Design window** defines the UTC epochs to propagate, while **Orbit preview
frame** only chooses how to inspect the ephemeris. They are not two clocks or
two different dynamics.

For manual Earth-bound forces, Orbit uses the automatic IERS C01 →
`finals2000A.all` → labelled-linear-extrapolation chain for `geopotential` and
`drag` by default. A manual ERP is not required to create or preview a manual
orbit. These caches do not change the **Design window** or physical epoch: they
provide UT1–UTC, polar motion, and LOD to propagation stages together with
their published source and quality.

Attaching a local ERP from TIME remains optional: it pins an explicit,
reproducible snapshot for that design. The result retains the attached ERP's
name, provider, digest, UTC scale, and coverage limits; it never mixes an
already-loaded SP3 ERP into the manual orbit.

When an optional manual ERP validates successfully, TIME replaces the **Design window** with
the complete interval covered by the file:

$$
D=[t_{ERP,min},t_{ERP,max}].
$$

In that same explicit action, the physical **State-vector epoch** is anchored
to \(t_{ERP,min}\). This prevents an old draft epoch from surviving when the
new ERP does not cover it. It may be edited afterwards, but Earth-bound forces
using that explicit ERP require it to remain within its coverage.

It is not automatically clipped to an SP3/OEM layer already in the scene.
Clipping would hide the fact that the products have different coverages and
would change the manual design without an explicit operator action.

### Earth-orientation provider

`geopotential` and `drag` share the process-wide automatic IERS chain. For each
stage it uses C01 when a valid sample exists; otherwise it uses a compatible
`finals2000A.all` row and makes its `final`, `rapid`, or `predicted` quality
visible. After the actually usable end of `finals2000A.all`, only explicitly
labelled local linear extrapolation may be used for a maximum of 30 days.
Beyond that limit there is no automatic EOP and the visual route degrades to
nominal rotation. No manual ERP file is required for this operational route.

If no compatible sample or two end points for extrapolation are available, the
manual orbit may be created with the warning **“No ERP data available.
Geopotential and drag will use nominal Earth rotation.”** Its published
provenance then labels the route as nominal; it is not presented as a precise
EOP solution.

### Coverage preflight for long operations

Before submitting an Earth-orientation-dependent operation, Orbit evaluates
the **entire requested window** and its stages, not only the initial epoch. This
includes, for example, numerical propagation with geopotential or drag and
transformations that request EOP. The preflight publishes the subintervals that
will use C01, `finals2000A` with `final`/`rapid`/`predicted` quality, linear
extrapolation, or, where applicable, the `UTC≈UT1` visual fallback with
`approximate` quality.

Consequently, a window that starts inside C01 but ends outside its coverage is
not silently classified as “valid”. Before it runs, the UI states the transition
instant, the source used afterwards, and an elevated warning if it reaches a
prediction or extrapolation. The operator can shorten the window, update IERS
data, or continue knowing which interval is degraded. The warning neither
starts a download nor changes the orbit by itself.

An explicitly selected local ERP keeps its stricter contract: it must cover the
complete window and all its stages. In that case Orbit does not silently mix in
C01, `finals2000A`, or extrapolation to fill a gap; the operation is rejected
with the exact coverage boundary.

An optional local ERP must cover the full design window and physical epoch when
it is selected as the reproducible override:

$$
D\subseteq E_{ERP}.
$$

When that override is present but does not cover the full window, creation is
rejected with a coverage explanation. The EME2000↔ITRF route still requires the
local leap-second table and ERFA/SOFA; those requirements are independent of a
manual ERP. Rigorous ECI conversion for an SP3 product retains its separate
fail-closed contract: neither global C01 nor nominal fallback enables it.

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

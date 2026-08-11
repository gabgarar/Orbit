# Precise GNSS products

[Satellite](../satellite/index.md) · [Space formats](index.md) · [SP3](sp3.md) · [Import](../user-guide/import.md)

## Overview

Orbit imports precise GNSS products **previously downloaded by the operator**
through the **Import GNSS product** window. An SP3 is always the required
orbit source. CLK, ERP, SUM, ATT, and OSB can accompany it as versioned
ancillary products. The result is a tabulated state source with explicit frame,
terrestrial realization, time scale, and provenance.

This route is for inspecting and visualising published precise orbits; it does
not turn the product into a TLE or run SGP4. Position comes from SP3, and clock
data does not change the orbit geometry.

!!! note "External download, local import"

    Orbit does not sign in, retain credentials, or download products from
    CDDIS, IGS, or ESA on the operator's behalf. Download the file from its
    provider, verify its date, and then load it locally into Orbit.

## Products that can be imported

The reader interprets the product content, not a particular brand. Therefore,
the same local route accepts SP3/CLK profiles published by the following
providers when their headers and records meet the format contract.

| Distributor / series | Orbit | Clock | Use and provenance retained by Orbit |
| --- | --- | --- | --- |
| [NASA CDDIS — IGS](https://cddis.nasa.gov/Data_and_Derived_Products/GNSS/orbit_and_clock_products.html) | IGS Final, Rapid, and Ultra-Rapid SP3. | Associated IGS CLK when supplied. | Provider ID `cddis_igs`, IGS family, and detected product class. |
| [IGS MGEX](https://igs.org/mgex/data-products/) | Multi-GNSS SP3. | Associated multi-GNSS CLK. | ID `igs_mgex`; constellation identifiers from the file are retained. |
| [ESA Navigation Support Office](https://navigation-office.esa.int/GNSS_based_products.html) | Operational and MGEX series, including Final, Rapid, and Ultra-Rapid. | Corresponding CLK products when supplied. | ID `esa_nso`, series, and class detected from the published files. |

Satellite identifiers remain in the product form, such as `G01`, `E11`, `C19`,
or `R05`. A multi-GNSS entry is not reduced to GPS or reassigned to a NORAD
identifier.

Provider, family, and class are determined automatically from the published
file names and content. The window does not offer a manual selector: when
there is insufficient evidence, Orbit records `custom` and/or `unknown`
rather than asserting an unproven provider or quality. The SP3 header remains
authoritative for frame and time scale.

### Quality and latency

Final, Rapid, and Ultra-Rapid labels describe production process and latency;
they do not establish precision that Orbit can guarantee after reading a file.

| Class | Operational meaning | Interpretation in Orbit |
| --- | --- | --- |
| Final | Consolidated product, normally the highest-quality product in the series. | Preferable for retrospective and reproducible analysis together with the exact imported file. |
| Rapid | Available earlier than Final. | Appropriate for recent operations when Final is not yet available. |
| Ultra-Rapid | Very low-latency product; it may combine observed and predicted segments. | Orbit retains product provenance; the operator must treat the predicted segment accordingly. |

CDDIS and IGS publish the description and availability of these classes on
their [orbit and clock products](https://cddis.nasa.gov/Data_and_Derived_Products/GNSS/orbit_and_clock_products.html)
and [IGS products](https://www.igs.org/products/) pages. For Ultra-Rapid,
coverage by the file does not mean that a sample is observed: consult the
marking and documentation of the source product.

## Import window and files

The six fields in **Import GNSS product** are independent. The file name is
retained as provenance, but it never replaces product-header metadata. The
extensions in this table are accepted by each named window field. The legacy
drag-and-drop or multi-file flow retains ZIP compatibility for an SP3/CLK set;
the backend inspects its members under safety limits. A ZIP does not replace
any named ancillary field or bypass explicit product association.

For API compatibility with historical uploads, the generic flow can also
recognise SP3c/SP3d and legacy containers/compression. They do not appear in
the named fields or extend this window's canonical extension contract.

| Field | Required | Valid extensions | Role in Orbit |
| --- | --- | --- | --- |
| **SP3 — precise orbits** | Yes | `.SP3`, `.SP3.gz` | Position and, when present, velocity by epoch and satellite. It is the only source that creates orbital layers. |
| **CLK — precise clocks** | No | `.CLK`, `.CLK.gz` | Clock bias, rate, and precision when published. Retained with the SP3 without altering geometry. |
| **ERP — Earth rotation parameters** | No | `.ERP`, `.ERP.gz` | Product-associated EOP. It is retained at import time; a future inertial capability validates it when needed. |
| **SUM — metadata** | No | `.SUM`, `.SUM.gz` | Product summary or metadata retained for audit. |
| **ATT — satellite attitude** | No | `.ATT.OBX`, `.ATT.OBX.gz`; `.OBX`/`.ATT` aliases and `.gz` | Associated attitude product; retained as provenance and does not alter an SP3 orbit. |
| **OSB — observable-specific biases** | No | `.OSB.BIA`, `.OSB.BIA.gz`; `.BIA` alias and `.gz` | Associated observable biases; retained as ancillary product, not as a position correction. |

An import without an SP3 is rejected with the exact message:

```text
Debe proporcionar un fichero SP3.
```

CLK, SUM, ATT, and OSB cannot create a trajectory by themselves. ERP cannot
create one either: it completes the terrestrial-orientation traceability of the
same import. A load contains one logical SP3 and at most one file of every
ancillary type; do not mix revisions, dates, or analysis centres.

### Technical interpretation by file

In this section, **read** means that Orbit interprets records and converts them
to its internal contract; **retain** means that it stores the file, type, name,
size, compression/archive origin, and SHA-256 for provenance without claiming
that its values already take part in orbital computation. The distinction
matters: the six fields belong to one GNSS product, but only SP3 supplies a
Cartesian trajectory.

#### SP3 — precise orbits (required)

| SP3 part | Source parameters and units read by Orbit | Use, persistence, and visible effect |
| --- | --- | --- |
| `#`, `##`, `+`, and `%c` headers | Version; `P`/`V` record type; initial epoch; epoch count; nominal interval; satellite list and count; data used; coordinate system; orbit type; agency; and `TIME_SYSTEM`. | Validates the product and retains these as native frame, realization, agency, and time scale. An unknown scale is not silently treated as UTC: it is rejected when constructing the state source. |
| Epoch and position | `*` line followed by `P<id> X Y Z [clock]`. `X`, `Y`, `Z` are in **km**. | Every non-missing position creates a sample for the identified GNSS satellite and, after selection is confirmed, an SP3 layer. Positions are normalized to **m**; they are the source for the orbit, 2D/3D globe, ground track, range, and AOS/LOS. |
| Velocity | `V<id> VX VY VZ [clock-rate]`; `VX`, `VY`, `VZ` are in **dm/s**. | When present, it is normalized to **m/s** and accompanies the tabulated state. Orbit does not invent a velocity when the file does not publish one. |
| Embedded clock | Fourth component of `P`: clock bias in **µs**. Fourth component of `V`: clock rate in **10⁻⁴ µs/s**. | Converted to seconds and seconds/second and exposed as clock summary/provenance. It does not change position, velocity, frame, time scale, range, or visibility. |

The SP3 missing-component sentinel (`abs(value) >= 999999`) and a complete
`(0, 0, 0)` `P` position are legal absent states: they count for structural
validation, but never become a Cartesian sample or an Earth-centred
coordinate. They must not be confused with a malformed file. A non-numeric,
empty, `NaN`, or infinite position or velocity vector makes the import fail.
The fourth clock component is optional; when it is published, it must be
numeric and finite. Duplicate `P`/`V` records for the same epoch and satellite
also fail. Accuracy, correlation, event,
and extended records published by some SP3 files are not converted into a
covariance or an orbit correction in this route.

Orbit interpolates each selected series with a local Lagrange window of up to
ten samples (degree 9), falling back to the highest available degree for a
shorter series. It never extrapolates beyond SP3 epochs. During preflight it
reconstructs every usable knot and requires a strictly less than **`1e-9 m`**
per-component error; it also evaluates the midpoint of every usable interval
to reject non-finite or poorly conditioned interpolation. At those points it
requires a Lebesgue constant `≤ 512` and relative barycentric-denominator
magnitude `≥ 1e-5`; these are numerical protection limits, not a provider
accuracy bound. A one-epoch series is an exact lookup with no interpolable
interval, so it does not claim to use degree 9. The source file, its header,
interpreted samples, and checksum remain linked to the product and to each
satellite's details card.

#### CLK — precise clocks (optional)

| RINEX CLK part | Source parameters and units read by Orbit | Use, persistence, and visible effect |
| --- | --- | --- |
| Header | `RINEX VERSION / TYPE`, `TIME SYSTEM ID`, and agency from `PGM / RUN BY / DATE`. | Retains version, type, agency, and declared time scale. If no scale is declared, it does not assume UTC or shift SP3 epochs. |
| Satellite `AS` record | GNSS identifier, epoch, value count and, in order: bias (**s**), bias sigma (**s**), drift (**s/s**), drift sigma (**s/s**), drift rate (**s/s²**), and drift-rate sigma (**s/s²**) when present. | Groups samples by satellite as clock information and exposes coverage/summary in the product details. It is retained with SP3, but does not alter orbital geometry, orbital interpolation, rendering, AOS/LOS, or time-scale conversion. |

RINEX `AR`, `CR`, and `DR` records, and continuations containing only extra
diagnostics, are not yet modelled as satellite data. A CLK cannot create layers
without SP3 and is not a navigation, PPP, or clock-steering solution.

#### ERP — Earth rotation parameters (optional; conditional for ECI)

Orbit interprets **IGS ERP v2** tables that declare the following five required
columns. It accepts conventional header variants (`Xpole`/`Xp`, `Ypole`/`Yp`,
`UT1-UTC`/`UT1R-UTC`, and `LOD`/`LODR`).

| ERP column | Expected IGS ERP v2 unit | Conversion and use in Orbit |
| --- | --- | --- |
| `MJD` | days | Converted to the UTC epoch of every sample and defines finite ERP coverage. |
| `Xpole`, `Ypole` | microarcseconds (**µas**) | Converted to radians as `xp` and `yp` for polar motion. |
| `UT1-UTC` or `UT1R-UTC` | tenths of a microsecond (**0.1 µs**) | Converted to seconds as DUT1. Required for reproducible Earth rotation. |
| `LOD` or `LODR` | tenths of a microsecond (**0.1 µs**) | Converted to seconds and retained as length of day. |

ERP is persisted with its coverage, sample count, source, version, and
snapshot/checksum. Orbit linearly interpolates its samples within coverage and
never extrapolates them. The current ERP v2 reader does not take `dX`/`dY` from
an ERP file: it explicitly sets them to zero, so it is not a replacement for an
IERS C04 celestial-correction product.

An SP3 terrestrial → ECI query needs **all** of: ERP covering the requested
epoch, a leap-second table that can convert the declared time scale, a valid
terrestrial-realization route, and ERFA/SOFA (`pyerfa`) with IAU 2006/2000A.
If any is absent, Orbit blocks the conversion; the view's GMST fallback is not
reused as a precise GNSS result. ERP alone does not create a datum
transformation such as IGS20 → ITRF2020. Without ERP, the layer can still be
inspected in its native terrestrial frame, but it is labelled **Marco terrestre
aproximado (sin ERP)** and ECI conversion is blocked. Attaching ERP does not
itself change an SP3 position or create a new orbit; it enables and documents
the Earth orientation in use.

#### SUM — summary and metadata (optional)

Orbit **does not yet interpret internal SUM fields**. It retains the file as an
immutable SP3 companion — name, type, size, provenance, and SHA-256 — and
exposes its presence in the details card and manifest. It derives neither
position, velocity, clock, numerical quality, frame, rendering, nor ECI
capability from it. SUM is currently for audit and for keeping the provider's
published metadata together, not for overriding the SP3 header.

#### ATT / OBX — satellite attitude (optional)

The field accepts published attitude products named `ATT.OBX`, `OBX`, or
compatible `ATT`. Orbit identifies and retains the companion file, but **does
not yet decode attitude parameters**: quaternions, yaw/pitch/roll angles,
maneuvers, antenna phase centre, and attitude flags do not enter an internal
attitude state. It therefore does not alter orbital rendering or generate a
pointing cone, antenna footprint, or link correction. Its current value is
traceability of the exact product used.

#### OSB / BIA — observable-specific biases (optional)

The field accepts `OSB.BIA` and compatible BIA aliases. Orbit retains its
presence and checksum, but **does not yet interpret** observable codes,
validity intervals, biases, standard deviations, or code/phase BIA units. It
does not apply biases to CLK, SP3, range, AOS/LOS, SNR, or a PPP solution. Like
SUM and ATT, it is kept for provenance and so that a future observations chain
can use exactly the selected ancillary product.

#### Common upload and retention limits

- One logical product supports one required SP3 and at most one CLK, ERP, SUM,
  ATT, and OSB; the backend has an absolute limit of eight files for archived
  upload compatibility.
- Every uploaded file is limited to **32 MiB** and the binary set to **64 MiB**;
  the HTTP service reserves **90 MiB** for the base64-encoded JSON. After
  decompression, the aggregate cannot exceed **256 MiB**.
- `.gz` is decompressed under that limit. ZIP remains compatibility for legacy
  sets: at most 16 members, no encrypted or nested ZIP, and every member keeps
  its safe archive name and hash.
- SP3, CLK, and ERP are interpreted again when a product is rehydrated. SUM,
  ATT, and OSB are verified again as persisted sources, but do not gain new
  semantics merely because Orbit restarts.

### Safety gate before persistence

**Preview satellites** and **Import** run the same strict SP3 preflight before
creating a layer, runtime ID, manifest, or directory below
`config/precise-products/`. Preview never persists; import can persist only
after every check passes. A failure returns `422`, presents the detail in a
dialog, and leaves no partially registered product.

| Area | Checks that must pass |
| --- | --- |
| File and header | The content must decode within the upload limits; the main `#` header must be valid and declare an initial epoch and positive epoch count; exactly one `##` line must declare a positive finite cadence; and `+` lines must declare a unique member list whose size matches its count. |
| Epoch table | The observed epoch count must equal the header count; the first epoch must match the header; epochs must be strictly increasing; and every interval must match `##` within a **2 µs** rounding tolerance. Every epoch must contain one `P` record for every declared satellite, with no unexpected members or duplicates. A legal absent state still counts as that member's record. |
| Numeric values | Coordinate and velocity vectors must be complete, numeric, and finite. The fourth clock component is optional, but when published it must also be numeric and finite. Empty vectors, `NaN`, `Inf`, or an invalid satellite identifier are rejected instead of being turned into approximate geometry or time. |
| Time | `TIME_SYSTEM` is retained and must be a recognised scale. Orbit converts SP3 coverage explicitly to UTC with its local leap-second table; it does not read a GPS, TAI, or other epoch as UTC. If the table cannot represent the epoch, the product is rejected rather than introducing a silent one-second offset. |
| Interpolation | Every series with two or more samples uses local Lagrange of degree `min(9, N−1)`. Preflight reproduces every usable knot with error `< 1e-9 m`; at every interval midpoint it requires a finite position, Lebesgue constant `≤ 512`, and relative barycentric-denominator magnitude `≥ 1e-5`. These are numerical-stability limits, not a provider accuracy guarantee. There is no extrapolation outside coverage. |

Official absent-state sentinels are reported separately from usable samples.
For example, `P 0 0 0` or `999999…` never becomes an orbit at Earth's centre
and does not make an otherwise valid SP3 look corrupt. The product needs at
least one usable state before it can offer satellites for selection.

A successful response exposes its passed report at `product.sp3_validation`:
header counts and members, epoch count/cadence, usable/absent states, and the
interpolation contract. It is not a provider accuracy estimate; it attests
only to the parsing invariants that Orbit could check.

!!! warning "Limit of temporal validation"

    GPS/TAI/GAL/BDT ↔ UTC checking validates Orbit's configured conversion and
    the coverage of its leap-second snapshot. That snapshot and its provenance
    are part of the trust boundary: Orbit cannot independently prove that a
    provider labelled `TIME_SYSTEM` correctly, nor detect a stale local table
    that still covers the date. The operator must maintain and audit the
    leap-second source; see [Time, EOP, and ITRF](../operations/time-eop.md).

    A normal terrestrial import may use Orbit's bundled open-ended table. The
    product is then accepted, but the response marks
    `time_validation.leap_seconds.external_freshness` as `unverified`: it does
    not claim that the UTC relation is externally verifiable for that date.

### ECI-dependent validation

ERP remains optional for a normal terrestrial import, but **every attached ERP
is validated** before it is persisted: finite, valid MJD; strictly chronological
epochs without duplicates; and physically plausible values. Protection limits
are `|xp|, |yp| ≤ 1 arcsec`, `|UT1−UTC| ≤ 0.5 s`, and `|LOD| ≤ 0.010 s`. These
are sanity bounds that catch a corrupt file or misread unit; they are not an
accuracy guarantee or a replacement for the analysis centre's quality control.

The current UI does not activate ECI during import, but the service contract
`require_eci=true` is already a strict gate for the capability that requests
it. It requires ERP, full ERP coverage of the selected SP3 subset, a registered
terrestrial-realization route, and `pyerfa`/SOFA for IAU 2006/2000A reduction.
It also requires a **local** leap-second snapshot with a version, SHA-256, and
publisher-provided validity horizon that has not expired and covers the full
selected SP3 window. A bundled or open-ended table does not meet that
high-rigor guarantee. If ERP is absent, that operation stops with:

```text
Debe proporcionar un fichero ERP para convertir a ECI.
```

For a point ECI query, the requested epoch must also be covered by ERP. The
route applies `xp`/`yp` polar motion, `UT1−UTC` for UTC→UT1 and Earth rotation
angle, and ERFA/SOFA IAU 2006/2000A precession/nutation. The verified local
leap-second snapshot must cover that epoch as well. The visual GMST fallback is
never presented as a precise GNSS conversion. A product-bound SP3 orbit also
rejects a caller-supplied explicit `EarthOrientation`; it may use only the ERP
registered with that product. As a mathematical check, the rotation matrix must
be orthonormal (`RᵀR = I`), have determinant `+1`, and preserve the position
norm (`|r_ITRF| ≈ |r_ECI|`); any failure blocks the conversion.

There is no live propagator-comparison UI or dedicated route yet. The internal
error-mean/threshold metrics do not exist yet either. This gate only prevents
a future comparison from requesting ECI without the necessary data and model;
it does not claim that Orbit already compares propagators or validates a
product's scientific accuracy against another ephemeris.

!!! warning "Do not confuse clock with time scale"

    A CLK product describes satellite clock corrections. SP3/CLK
    `TIME_SYSTEM` defines how epochs are interpreted. Clock data does not
    convert GPS to UTC or replace the local leap-second table or ERP used for
    an ITRF-to-ECI transformation.

## What Orbit retains

For each imported product, Orbit retains at least the file name, provider and
product classification, included satellites, and the metadata published by the
format:

- coordinate system, terrestrial realization, and centre declared by SP3;
- time scale and epoch of every sample;
- agency, orbit type, and epoch coverage when available;
- source satellite identifier and the presence of positions, velocities, and
  clock samples;
- presence, name, type, and checksum of CLK, ERP, SUM, ATT, and OSB when
  supplied;
- provider, family, and class inferred automatically from the sources, together
  with the available evidence or `custom`/`unknown` when no classification can
  be substantiated;
- SHA-256 of the uploaded file and of every decompressed logical source.

Provenance follows the layer and import response. Orbit stores verified sources
and a manifest under `config/precise-products/` in a content-addressed
directory; at startup it verifies checksums again before rehydrating a product.
Also keep the original file and its checksum in the mission data repository: a
`Final` or `Rapid` label does not identify a specific product revision on its
own.

Persisted source files are not published through the static `/config/` route:
Orbit explicitly rejects `config/precise-products/`. Visible provenance is
provided through the API contract, not through an accidental download of the
uploaded binaries.

## Time, frames, and realization

SP3 defines its own coordinate system and time scale. Orbit retains that native
declaration in provenance and transforms a state only where the frame service
has an explicit route. It does not silently rename `IGS20`, `IGb20`, or `IGc20`
as `ITRF`.

The import window separates the **file's native frame** from its **terrestrial /
inertial output capability**. The latter is decided by the ERP associated with
the product:

| ERP and realization state | Operational label | Capabilities |
| --- | --- | --- |
| ERP associated, realization route available, ERFA/SOFA available, and ERP coverage overlaps | **ITRF (con ERP aplicado)** | The label covers only overlapping epochs. Complete conversion of the selected SP3 subset requires ERP coverage for its entire window; provenance includes UT1, polar motion, and the IAU 2006/2000A model used. |
| No | **Marco terrestre aproximado (sin ERP)** | The approximate terrestrial series can be inspected, but Orbit does not claim ITRF or enable conversion to ECI. |
| ERP associated, but coverage, realization route, or ERFA/SOFA is absent | Declared native frame | ERP does not invent IGS→ITRF and a visual model does not substitute IAU 2006/2000A. The diagnostic is retained and ECI remains blocked until all conditions are met. |

Every module that displays a frame —object details, ephemerides, telemetry,
AOS/LOS, export, and a future comparison—must use the operational label while
also retaining the frame declared by the SP3 header. An absent ERP is not
hidden behind `ECEF`, `ITRF`, or a generic scene name.

The Compose deployment enables the published zero-datum global operation by
default for satellite-orbit states declared as `IGS20`, `IGb20`, or `IGc20`.
The policy uses:

```text
ORBIT_TERRESTRIAL_REALIZATION=ITRF2020
ORBIT_ENABLE_IGS20_FAMILY_ITRF2020_ALIGNMENT=true
```

An operator can explicitly disable it with
`ORBIT_ENABLE_IGS20_FAMILY_ITRF2020_ALIGNMENT=false`. This is not relabelling:
the operation and source realization remain in provenance.

The operation retains the individual source realization in provenance; it is
not a station or antenna-coordinate correction. The legacy exact policy
`ORBIT_ENABLE_IGS20_ITRF2020_ALIGNMENT` must not be enabled at the same time.
Historical IGS realizations, including `IGS14`, remain diagnostic-only until
an explicit published operation is registered. See [Reference
frames](../engineering/reference-frames.md).

An SP3 state declared in a terrestrial realization remains native to that
realization. The fact that an Earth-fixed scene can draw it does not authorize
renaming, for example, `IGS20` as `ITRF2020`. A registered realization
transformation is a datum operation distinct from Earth orientation; ERP does
not replace it. Without ERP, Orbit does not present a complete terrestrial
rotation and uses the exact label **Marco terrestre aproximado (sin ERP)**.
ERP supplies Earth orientation —UT1 and polar motion among other published
values—but does not itself invent an IGS-to-ITRF realization transformation:
that datum operation must be registered and applied before Orbit shows
**ITRF (con ERP aplicado)**.

Queries convert from the requested scale to the native scale before looking up
a sample. A reproducible ITRF-to-ECI transformation needs the associated ERP,
leap seconds, and any applicable realization route in addition to SP3/CLK; see
[Time, EOP, and ITRF](../operations/time-eop.md).

ERP products are not inferred from an SP3 name. The operator selects the ERP
file from the same product revision and Orbit records its hash and coverage. A
local [IERS EOP 20u24 C04](time/iers-c04.md) snapshot remains the independent
operational reference for the common frame service. [IERS Bulletin A](time/bulletins.md)
can cover rapid operations; no remote source is downloaded or paired
automatically.

## Import workflow

1. Download the SP3 and, when available, the ERP from the same product revision
   from CDDIS/IGS/ESA. Add CLK, SUM, ATT, or OSB only when those ancillary
   products need to be retained.
2. Check the date, frame, `TIME_SYSTEM`, and whether Ultra-Rapid contains a
   predicted segment; Orbit derives provider and class automatically after load.
3. In **Layers → + → Add layer → Add satellite → Import GNSS product**, select
   the required SP3 and fill in the relevant optional fields. The dialog detects
   provider and class from the sources; it neither allows manual declarations nor
   activates ECI during import.
4. Choose **Preview satellites**. Orbit parses the product without persisting it
   and shows a table with GNSS identifier, constellation, coverage, and
   sampling. Mark the subset to use or **Select all**; cancelling creates no
   layers.
5. Confirm **Import N satellites**. Only the chosen members are registered,
   and each layer represents a tabulated ephemeris rather than a TLE object.
6. Orbit aligns the simulated timeline to the published common coverage. Keep
   any later query within the imported SP3 epochs.

The load is local and is durably registered in Orbit's precise-product store.
The runtime rehydrates it after restart, and a project can reference stable
product identifiers; the source binary is not copied into every project
document. This route is not an automatic remote-catalog synchronisation.

In the object panel, the product input tab shows provider, class, SP3,
ancillary products, coverage, declared frame, operational label, `TIME_SYSTEM`,
sample count, and clock summary. This is the file's provenance card, not an
independent accuracy estimate.

## Explicit limitations

- The import does not authenticate against or download from CDDIS Earthdata,
  IGS, or ESA.
- Authenticated remote download, scheduled refresh, and catalogue
  synchronization are future capabilities; importing a local file does not
  enable them.
- There is no product fusion, orbit fitting, smoothing, or automatic choice
  between Final, Rapid, and Ultra-Rapid.
- CLK samples are retained as clock metadata; they do not change SP3
  position/velocity or become a navigation solution.
- SUM, ATT, and OSB are retained as ancillary products and provenance. They do
  not enable PPP, navigation, orbit determination, attitude dynamics, or an
  SP3-position correction.
- ERP is used only when the operation requests ITRF-to-ECI. It is never
  downloaded or silently replaced by Bulletin A/B, C04, or another revision.
- Orbit interpolates each SP3 series through a local Lagrange window of up to
  ten samples (degree 9); with fewer records it explicitly degrades to the
  highest available degree. This bounded policy does not replace the
  provider's interpolation strategy, precision standards, or ancillary
  products.
- Time coverage is finite: a request outside the SP3 epochs is rejected rather
  than extrapolating a precise orbit.
- Precise-product import does not implement observation RINEX, PPP, orbit
  determination, clock steering, or bias estimation.

## API and references

The interface uses `POST /api/precise-products/import`; the endpoint, upload
contract, and responses are documented in [Precise-product API](../integrations/rest-api/orbit-operations.md#precise-gnss-products).
For the SP3 record contract, see [SP3](sp3.md).

Product sources:

- [CDDIS: IGS orbit and clock products](https://cddis.nasa.gov/Data_and_Derived_Products/GNSS/orbit_and_clock_products.html)
- [IGS: Products](https://www.igs.org/products/)
- [IGS: MGEX data products](https://igs.org/mgex/data-products/)
- [ESA Navigation Support Office: GNSS-based products](https://navigation-office.esa.int/GNSS_based_products.html)
- [IERS EOP 20u24 C04](https://datacenter.iers.org/products/eop/long-term/c04_20u24/)
- [IERS Bulletin A](https://maia.usno.navy.mil/products/bulletin-a)

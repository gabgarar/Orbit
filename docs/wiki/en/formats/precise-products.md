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

### ECI-dependent validation

ERP is optional in the current import window. There is no propagator-comparison
tool or ECI control in this window yet. When a future function requests an
ECI conversion, its capability must require ERP, a realization route, and
valid temporal coverage. If ERP is absent, that operation stops with:

```text
Debe proporcionar un fichero ERP para convertir a ECI.
```

There is no live propagator-comparison UI or dedicated route yet. The internal
`require_eci` capability contract is reserved as the guard for that future
feature; it is not part of the import form and does not enable comparison
today.

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
| ERP associated, used, and realization route applied | **ITRF (con ERP aplicado)** | SP3/ITRF → ECI is enabled; provenance includes UT1, polar motion, and the Earth-rotation parameters used. |
| No | **Marco terrestre aproximado (sin ERP)** | The approximate terrestrial series can be inspected, but Orbit does not claim ITRF or enable conversion to ECI. |
| ERP associated, but realization route absent | Declared native frame | ERP does not invent IGS→ITRF. The diagnostic is retained and ECI remains blocked until the corresponding datum transformation is registered. |

Every module that displays a frame —object details, ephemerides, telemetry,
AOS/LOS, export, and a future comparison—must use the operational label while
also retaining the frame declared by the SP3 header. An absent ERP is not
hidden behind `ECEF`, `ITRF`, or a generic scene name.

There is a published zero-datum global operation, but it is **optional and
disabled by default**, for satellite-orbit states declared as `IGS20`, `IGb20`,
or `IGc20`. Enable it only by setting both:

```text
ORBIT_TERRESTRIAL_REALIZATION=ITRF2020
ORBIT_ENABLE_IGS20_FAMILY_ITRF2020_ALIGNMENT=true
```

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
4. Review the provenance summary and layers created by source satellite ID. A
   layer represents a tabulated ephemeris, not a TLE object.
5. Orbit aligns the simulated timeline to the published common coverage. Keep
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

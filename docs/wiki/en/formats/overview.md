# Format overview

[Home](../index.md) · [Formats](index.md) · [Cartesian states](../engineering/cartesian-states.md) · [Propagation](../propagation/overview.md)

## Availability matrix

| Format | Catalog/UI Import | Python status reader | Propagation in runtime | Export |
| --- | --- | --- | --- | --- |
| [TLE](tle.md) | Yes. | TLE catalog upload. | Yes, SGP4. | TLE; CSV/JSON/OEM ephemeris sampled with SGP4. |
| [WMO](omm.md) | Yes, JSON/XML when it contains TLE. | There is no general status OMM reader. | Yes, like TLE extracted. | OMM JSON/XML minimal. |
| [OEM](oem.md) | The viewer can load a temporary local track; does not create a catalog object. The gateway only extracts embedded TLE. | Yes, segmented and interpolated. | Not integrated into `OrbitRuntime`. | OEM catalog header and OEM SGP4 anniversaries. |
| [SP3](sp3.md) and [precise GNSS products](precise-products.md) | Yes, through local SP3 import with optional CLK. | Yes, by satellite and interpolated. | Yes, as a runtime tabulated ephemeris. | No. |
| [OPM](opm.md), [CPF](cpf.md), and observation RINEX | No. | No. | No. | No. |

## Product boundaries

```mermaid
flowchart LR
    U[UI / Gateway] --> C[TLE or OMM-with-TLE catalogue]
    C --> R[OrbitRuntime / SGP4]
    U --> P[Local SP3 + optional CLK import]
    P --> T[Tabulated provider per satellite]
    T --> R
    V[Visor web] --> L[Track OEM local y transitorio]
    O[OEM Python] --> T[TabularStateProvider]
    S[SP3 Python] --> T
    T --> F[FrameTransformService]
    O -. no conectado al runtime .-> U
```

The web viewer has a local and temporary route to view a pure OEM. That route
does not register a catalogue object, go through Gateway/FastAPI, or supply an
ephemeris source to `OrbitRuntime`. By contrast, precise GNSS product import
registers a tabulated SP3 source per satellite with optional CLK clock data and
provenance metadata. The registration is retained in the local precise-product
store and rehydrated by the runtime on startup. It does not turn the product
into a TLE object or download files from a provider. See [Precise GNSS
products](precise-products.md).

## Common tabulated contract

OEM and SP3 become `TabularStateProvider`. Your samples must share
frame, realization, center and temporal scale within a series/segment; the
Epochs are strictly increasing and cannot be duplicated.

| Interpolation | Availability |
| --- | --- |
| Linear | Default when no OEM declaration exists. |
| Lagrangian | OEM declared, with grade and enough samples. |
| Hermite | Declared OEM, odd grade and speed on all chosen samples. |

Inquiries outside the coverage are rejected. The OEM covariance is not
interpolates; it is only attached to its exact solution epoch.

## Frames and scales

Readers preserve the origin. A transformation to ITRF requires a path
from the frame service; an IGS realization is not converted to ITRF without a
registered operation. GPS/TAI/TT/UT1 conversions use the same conversion table.
leap seconds and EOP than the associated transformer.

See [Temporary Systems](../engineering/time-systems.md) and
[Reference frames](../engineering/reference-frames.md).

## Simplified OCM

The gateway can export a JSON identified as OCM that contains name,
identifier, source format and the two TLE lines. There is no OCM reader or
an implementation of all OCM profiles; that departure should not be announced
as full support of the standard.

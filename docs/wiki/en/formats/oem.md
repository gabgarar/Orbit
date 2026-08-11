# OEM

[Home](../index.md) · [Formats](index.md) · [Cartesian states](../engineering/cartesian-states.md) · [Temporal systems](../engineering/time-systems.md)

## Split scope

Orbit has three different OEM routes that should not be confused.

| Route | Behavior |
| --- | --- |
| Catalog import via UI/gateway | Only extracts embedded `TLE_LINE1` and `TLE_LINE2`. A pure ephemeris OEM is rejected. |
| Local web viewer | You can load a pure OEM as a local and transient visual track. |
| Python `OemStateProvider` | Read tabulated OEM segments, interpolation and covariance part. It is not connected to UI, gateway, public API or `OrbitRuntime`. |

The three routes have independent contracts. The display may show an OEM
pure as a local and transient track, but that visualization does not go through
Gateway/FastAPI, does not create a catalog object and does not register a service provider
anniversaries in `OrbitRuntime`. `OemStateProvider` is a library capability
internal, not a conversion from file to layer, catalog satellite or source
product spread.

## Python segment reader

`OemStateProvider.from_text` requires `CCSDS_OEM_VERS` and one or more blocks
`META_START`/`META_STOP`. Each segment handles the following metadata;
`REF_FRAME` and `TIME_SYSTEM` are required:

| Metadata | Usage |
| --- | --- |
| `REF_FRAME` (required) | Native framework and, if applicable, realization. |
| `TIME_SYSTEM` (required) | Native time scale. |
| `OBJECT_NAME`, `OBJECT_ID`, `CENTER_NAME` | They are preserved when present; The default state center is `EARTH`. |
| `START_TIME`, `STOP_TIME`, `USEABLE_*` | Preserved segment metadata. |
| `INTERPOLATION`, `INTERPOLATION_DEGREE` | Optional; If declared, their grade and samples must be able to meet them. |

Segments maintain their metadata independently. If there are several,
a query must include `segment_index`; Orbit never interpolates through a
change of frame, realization or temporal system.

## Status records

The reader accepts a CCSDS epoch of calendar or year/day of the year, followed by:

```text
EPOCH X Y Z VX VY VZ
EPOCH X Y Z VX VY VZ AX AY AZ
```

Positions are in km, speeds in km/s and accelerations in km/s². The
Optional acceleration requires `CCSDS_OEM_VERS` 2.0 or later. The states are
convert to YES upon entering `StateVector`, but retain `REF_FRAME` and
`TIME_SYSTEM` of origin.

An unknown time scale or a segment with no usable states fails.
supplier construction.

## Interpolation

| Declaration | Rule applied |
| --- | --- |
| Without `INTERPOLATION` | Linear between the two adjacent samples. |
| `LINEAR` | Requires grade 1. |
| `LAGRANGE` | Requires grade ≥1 and `grado + 1` samples. |
| `HERMITE` | Requires odd degree, velocities and `(grado + 1)/2` samples. |

Hermite uses position and velocity constraints and derives acceleration from
polynomial. Lagrange and linear preserve acceleration only when the samples
corresponding ones contain it. Any out-of-coverage query fails; there is not
extrapolation.

## Viewer OEM: a separate route

The OEM load available in the web viewer does not yet use
`OemStateProvider`. It reads a local, transient point track, draws it as a
polyline, and moves the marker with piecewise-linear interpolation between
sample times. Therefore an OEM `INTERPOLATION = LAGRANGE` or `HERMITE` is not
applied on that visual route; it must not be interpreted as validation of the
producer-declared method.

The Python route in the table above does honour the segment declaration, but
it is not currently connected to catalogue OEM import or the runtime. For the
general distinction between state evaluation, sampling, and visual playback,
see [Ephemerides and interpolation](../orbit-service.md).

## OEM Covariance

For OEM 2.0 or later it reads `COVARIANCE_START`/`COVARIANCE_STOP` with:

- `EPOCH` followed by six lower triangular rows 1..6;
- `COV_REF_FRAME` optional; if missing, the `REF_FRAME` of the segment is used;
- comments associated with the matrix.

The matrix expands symmetrically to the 6x6 contract and the reader applies a
`1_000_000` factor to bring km-based values to your SI contract. If
appends only if the query exactly matches the navigation `EPOCH`;
a covariance is not interpolated.

The Cartesian frames that the transformer can convert can carry the
covariance to the state framework. `RTN`, `RSW` and `TNW` are rejected
explicit, as well as a terrestrial realization that cannot be transformed without
invent a datum operation.

## Post transformation

`native_state_at` returns the native state. `state_at` requests a
explicit transformation using the framework service. An IGS realization,
for example, it is not automatically converted to ITRF. Consult
[Reference frames](../engineering/reference-frames.md).

## Catalog export and import

The catalog importer detects `.oem` and only accepts the content when
find `TLE_LINE1` and `TLE_LINE2`; in this case register a TLE entry with
`sourceFormat=OEM`. An OEM without both lines returns an explicit error.

The catalog OEM export outputs a minimum profile header with the
TLE lines as comments, not a sampled ephemera. The export of
SGP4 ephemeris can issue separate OEM points. None of these outputs
implies full support of OEM profiles.

## Limits

- No OEM upload as catalog object, public REST/gateway provider
  o orbital runtime source; the display can only show a local track and
  transient.
- There is no extrapolation or mixing of segments.
- No local orbital covariance, interpolated covariance, OD or propagation
  of uncertainty.
- The reader is not a complete validator of all CCSDS OEM profiles.

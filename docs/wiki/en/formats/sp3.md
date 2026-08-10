# SP3

[Satellite](../satellite/index.md) · [Space formats](index.md) · [Precise GNSS products](precise-products.md) · [Reference frames](../engineering/reference-frames.md)

## Overview

SP3 is a tabulated precise GNSS-orbit format. Orbit uses it as a source of
states by epoch and satellite, not as a set of Keplerian elements, a TLE, or a
configurable force model.

An imported SP3 creates an ephemeris source for each satellite identifier in
the file. It can be accompanied by a RINEX CLK file to retain clock
information, but coordinates and velocity always come exclusively from SP3.

For providers, Final/Rapid/Ultra-Rapid classes, MGEX, compression, and import
workflow, see [Precise GNSS products](precise-products.md).

## Header and metadata contract

Orbit requires a meaningful SP3 header beginning with `#`—distinct from `##`—
that contains the required structural fields. It retains the following metadata
rather than inferring it from the file name:

| Field | Use in Orbit |
| --- | --- |
| SP3 version and record type | Validates whether the series carries positions (`P`) or positions/velocities (`V`). |
| Initial epoch and epoch count | Defines the series coverage. |
| Orbit type and agency | Product-declared provenance. |
| Coordinate system | Native frame of the states. |
| `%c` `TIME_SYSTEM` | Native time scale of epochs. |
| Satellite list | Determines selectable layers/series. |

`IGS20`, `IGb20`, and `IGc20` realizations are retained as the `IGS` family
with an explicit realization. They are not renamed as ITRF or a generic `ECEF`
label.

## State records

Epochs are introduced by `*` lines. `P` and `V` records are associated by epoch
and satellite identifier.

| Record | Source units | Internal conversion |
| --- | --- | --- |
| `P` | km | position in m. |
| `V` | dm/s | velocity in m/s. |

The missing-component sentinel (`abs(value) >= 999999`) is not interpreted as
a valid coordinate. Duplicate records of the same type, epoch, and satellite
are rejected: a tabulated series cannot have two different values for the same
sample.

The fourth column of an SP3 record is clock data in the source format. Orbit
retains it as clock metadata when available; it does not modify position,
velocity, frames, time scales, or visibility geometry.

## Selection and interpolation

An SP3 file can include many satellites. The query requires `satellite_id`
unless the series contains exactly one. Each satellite uses a bounded local
Lagrange interpolation in its `TabularStateProvider`. The window uses at most
ten samples (degree 9) and, when the file contains fewer records, explicitly
degrades to the highest available degree (`n - 1`). For example, a two-epoch
series retains a degree-1 polynomial; it is not presented as high-order
precise interpolation.
A one-epoch series only permits an exact query of that sample.

A query converts from its requested scale to the native scale before finding
and interpolating a sample. For example, a GPS series retains GPS epochs in its
metadata even when a request is expressed in UTC.

!!! warning "Orbit interpolation does not replace the provider's interpolation"

    Quality published by IGS or ESA belongs to their samples and production
    chain. Orbit applies a local Lagrange window up to degree 9, but does not
    reproduce the analysis centre's full strategy or ancillary products. Use
    suitable cadence, do not query outside coverage, and document EOP, leap
    seconds, and the applied transformation before assigning geodetic
    precision to a result.

## Time, frame, and realization

`native_state_at` returns the state in the frame and scale declared by the
file. Requesting ITRF for an IGS-family SP3 requires a registered realization
transformation. Orbit does not implicitly rename `IGS20`, `IGb20`, or `IGc20`.

The published global alignment for that family is optional: it requires
`ORBIT_TERRESTRIAL_REALIZATION=ITRF2020` and
`ORBIT_ENABLE_IGS20_FAMILY_ITRF2020_ALIGNMENT=true`. It applies only to
geocentric satellite-orbit states and retains the source-realization label. It
does not transform stations or antennas. The legacy exact
`ORBIT_ENABLE_IGS20_ITRF2020_ALIGNMENT` policy is incompatible with the family
policy; `IGS14` and other historical realizations need their own published
operation. See [Reference frames](../engineering/reference-frames.md).

A terrestrial-state transformation requires relevant auxiliary data. For a
reproducible run, load the local time and EOP products described in [Time, EOP,
and ITRF](../operations/time-eop.md).

The native frame and an Earth-fixed view are not the same claim. An SP3
coordinate declared as `IGS20` remains `IGS20` even if the viewer can place it
on the globe; it is not presented as `ITRF` without a registered
source→ITRF realization operation. If an inertial route creates an Earth-fixed
view using UTC≈UT1 and null EOP, the result is labelled **approximate
Earth-fixed (without EOP)**, not ITRF. Reproducible ITRF output requires the
explicit route, leap seconds, and versioned EOP — DUT1, `xp`, `yp`, and, for
modern reduction, `dX`/`dY`.

## Associated clock

A RINEX CLK file can be imported alongside the SP3 from the same series. It
provides clock biases and, where published, rates and precisions by epoch and
GNSS identifier. In Orbit its current role is product provenance and metadata:

- it cannot create an orbit without a valid SP3;
- it is not interpolated as a Cartesian state;
- it does not shift SP3 epochs;
- it does not calculate PPP, pseudorange corrections, or a navigation
  solution.

## Limitations

- Orbit does not export SP3/CLK or generate precise products.
- There is no authenticated download from CDDIS Earthdata or remote IGS/MGEX/
  ESA synchronisation; input is a local file.
- Products are not fused and Orbit does not infer whether Final, Rapid, or
  Ultra-Rapid is the right choice for a mission.
- An unrecognised time scale is retained when reading metadata, but rejected
  when constructing a convertible state provider.
- No terrestrial-realization transformation is invented.

# Engineering concepts

## Overview

Engineering concepts define which data may enter Orbit and which meaning must survive each operation. Orbit favours explicit labels over convenient aliases.

## Why it matters

A vector without time scale, frame, centre or units is not interoperable. Orbit rejects `ECI` and `ECEF` because they are ambiguous.

## State vector

`StateVector` is the shared SI contract: epoch, scale, frame, realization, centre, position in metres, velocity in m/s, optional acceleration and 6×6 covariance. It is immutable after validation.

```python
StateVector(epoch=epoch, time_scale="UTC", frame="TEME",
            frame_realization=None, center="EARTH", position_m=(...))
```

## Representations

Cartesian states are the interchange representation. Keplerian elements express intuitive geometry; equinoctial elements avoid singularities near circular or equatorial orbits. Derived parameters are labelled osculating when obtained from a state at an epoch.

## Frames and time

TEME, GCRF, ICRF, EME2000, CIRS, TIRS, PEF and ITRF are supported. `ITRF2020` is expressed through `frame=ITRF` and `frame_realization=ITRF2020`.

UTC, TAI, TT, GPS and UT1 are preserved. UTC is derived internally for IERS/ERFA; source scale remains on output. A leap-second table can be pinned per instance, preventing a global change from altering a scientific result.

## Earth and environment

Central gravity is always present. The numerical model can compose J2/J3/J4, geopotential, third bodies, drag, solar radiation pressure and relativity when declared by the propagator.

## Limits

- Only Earth-centred frames are transformed.
- Generic ITRF is not silently turned into a named realization.
- External labels such as IGS20 require a registered, published datum operation.
- Non-finite components, unknown scales and ambiguous frames fail at the input boundary.

## Next destinations

<div class="grid cards" markdown>

- :material-chart-timeline-variant: **Apply the models**

  Propagators, force models and numerical integration.

  [Open propagation →](propagation.md)

- :material-function-variant: **See the reduction**

  Time, EOP, realizations and internal mathematics.

  [Open internals →](internals.md)

</div>

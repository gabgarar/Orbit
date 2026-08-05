# SGP4: time and frames

[Propagation](../index.md) · [SGP4](../sgp4.md) · [Time and EOP](../../operations/time-eop.md) · [Reference frames](../../engineering/reference-frames.md)

## UTC to query the model

Orbit's API receives an instant and normalizes it to `UTC`. The instant is
converted to the Julian day and fraction consumed by SGP4. UTC is the query
and `StateVector` metadata scale; it does not by itself turn a native state
into an Earth-fixed state.

## TEME is the native frame

SGP4 direct output is labelled `TEME`. It must not be relabelled as GCRF,
`EME2000`, or “ECI”: although these are used in orbital contexts, they are not
interchangeable data contracts.

### Why TEME exists

`TEME` means *True Equator, Mean Equinox*. It is a historical NORAD convention
associated with SGP4 and with the way its analytical corrections were defined.
It is not a modern IAU celestial reference frame and is not a substitute for
GCRF or EME2000. Orbit retains it because it is the frame produced by SGP4,
and preserving it avoids silently changing the meaning of a TLE.

| Operation | Resulting frame |
| --- | --- |
| `native_state_at` | `TEME`. |
| `state_at(..., target_frame=ITRF)` | Explicitly requested `ITRF`. |
| `propagate_teme_datetime` | Legacy TEME adapter in km and km/s. |
| `propagate_datetime` | Legacy ITRF adapter in SI. |

## From TEME to ITRF

To show a ground track or evaluate a station, request `ITRF` through
`FrameTransformService`. The shared path applies model-compatible rotation and
uses the EOP policy for UT1 and polar motion. The propagator does not hide this
conversion or relabel TEME before applying it.

### UTC, UT1, and DUT1

SGP4 is queried at a UTC epoch, but Earth rotation is evaluated in UT1. The
EOP provider supplies \(\mathrm{DUT1}=\mathrm{UT1}-\mathrm{UTC}\): that
difference turns the civil query time into the scale that sets Earth's rotation
angle. The full chain is documented in [Time, EOP, and ITRF](../../operations/time-eop.md).

### TEME → PEF rotation

Orbit follows the classic `TEME → PEF → ITRF` path. The first step rotates
about Earth's axis with GMST82 evaluated in UT1, the mean-sidereal-time
convention compatible with the SGP4/Vallado context; it is not the IAU
2000/2006 rotation used by the GCRF/EME2000 route. The second step applies
polar motion to reach ITRF. See also [Reference frames](../../engineering/reference-frames.md).

### Position, velocity, and acceleration

Position is rotated with the matrix of the route above. Velocity cannot be
rotated as a static vector: Orbit includes the time derivative of the rotation
matrix, whose leading term is Earth's rotational velocity
\(\omega\times\mathbf r\). When acceleration or covariance is
present, the service also carries the corresponding derivatives. The general
explanation and equations are in [Cartesian states](../../engineering/cartesian-states.md).

A DUT1 constructor value is kept only for compatibility. The recommended path
is to provide versioned EOP to the shared transformer, so Earth-orientation
quality and provenance remain auditable.

The final precision of an ITRF state depends both on TLE quality and age and on
the EOP — especially UT1/DUT1 and polar motion — used in the transformation.
State provenance records this information so that the result can be reviewed
later.

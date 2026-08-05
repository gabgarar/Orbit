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

A DUT1 constructor value is kept only for compatibility. The recommended path
is to provide versioned EOP to the shared transformer, so Earth-orientation
quality and provenance remain auditable.

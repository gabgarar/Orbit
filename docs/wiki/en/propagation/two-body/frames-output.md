# Two-body: output and frames

[Propagation](../index.md) · [Two-body](../two-body.md) · [Reference frames](../../engineering/reference-frames.md)

## Native state

The analytical calculation produces an Earth-centred Cartesian state in
`EME2000`. Before crossing an API boundary, Orbit publishes it as a
`StateVector` in SI units with a `UTC` epoch, `EARTH` centre, and
`source=manual`, `propagator=two-body`, `native_frame=EME2000` provenance.

| Method | Result |
| --- | --- |
| `native_state_at` | `EME2000`/UTC/SI state without another transformation. |
| `state_at` | The same state explicitly converted to the requested frame. |
| `propagate_datetime` | Legacy six-component ITRF/SI renderer adapter. |

## Requesting terrestrial output

A ground station, map, or renderer normally needs an Earth-fixed frame.
`state_at(..., target_frame=ITRF)` asks `FrameTransformService` for that
transformation. Propagation does not become terrestrial: the state is computed
in `EME2000` first and transformed afterwards.

ITRF output quality depends on the Earth-orientation policy (EOP). In
particular, UTC, UT1, and polar motion belong to the frame transformation, not
to the Keplerian equation. See [Time and frames](time-and-frames.md) for the
complete explanation, including TT, EOP, and velocity.

## Historical compatibility

Some older paths are named `propagate_eci_datetime` or accept generic “ECI”.
They are compatibility aliases: the current contract interprets those manual
states as `EME2000`. Do not use `ECI` as a frame identifier in new integrations.

## Reading the result

The output answers “where would the object be if only ideal central gravity
acted?” It does not validate that a real satellite is still there. Two-body
dynamics and ITRF transformation are different responsibilities: one computes
ideal dynamics, the other expresses the result in the consumer's system.

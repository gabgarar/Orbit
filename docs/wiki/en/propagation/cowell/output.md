# Cowell: departure and origin

[Propagation](../index.md) · [Cowell](../cowell.md) · [Reference frames](../../engineering/reference-frames.md)

## Output methods

| Method | Result |
| --- | --- |
| `native_state_at` | `StateVector` EME2000/UTC/SI with `propagator=cowell-rk4`. |
| `state_at` | Explicit transformation to the requested framework. |
| `propagate_datetime` | Six-component ITRF SI adapter. |

## Origin

The provenance states that the terrestrial terms use the compatible model
of first order inertial axes. This avoids presenting the result as a
Complete ground force transformed at every step.

The `EME2000`-to-`ITRF` time and frame chain is explained separately in
[Time and frames](time-and-frames.md).

## Related references

- [Cartesian states](../../engineering/cartesian-states.md)
- [Reference frames](../../engineering/reference-frames.md)

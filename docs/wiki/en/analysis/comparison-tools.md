# Comparison of propagators

[Analysis](index.md){ .md-button } [Propagation](../propagation/overview.md){ .md-button }

Orbit does not include a dedicated tool that runs, aligns, compares, and
Automatically rate multiple propagators against the same reference.
The differences between SGP4, two bodies and Cowell must be interpreted from their
entry contracts, native frameworks, time scales, active forces and
temporary windows.

## Traceable manual comparison

A manual comparison must preserve, at a minimum, the following elements:

| Element | Requirement |
| --- | --- |
| Initial period | Same physical epoch, with declared time scale. |
| State or initial elements | Same definition and same units. |
| Frame | Explicit conversion to a common framework before calculating differences. |
| Model | List of forces, parameters and auxiliary data version. |
| Temporary mesh | Same moments of evaluation and interpolation policy. |
| Metric | Explicit definition of position, velocity or compared element. |

!!! warning "No equivalence of models"

    A TLE interpreted by SGP4 is not the same mathematical object as a
    manual osculating state integrated by Cowell. A difference between both
    models is not, in itself, a propagation error.

## Status

**Not available:** automated comparison tables, error statistics
versus ground truth, precision metrics per propagator and analysis of
systematic sensitivity.

## Related references

- [SGP4](../propagation/sgp4.md)
- [Two bodies](../propagation/two-body.md)
- [Cowell](../propagation/cowell.md)
- [Coordinate systems](../engineering/coordinate-systems.md)
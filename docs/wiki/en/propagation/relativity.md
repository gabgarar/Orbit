# Relativity

[Home](../index.md) · [Propagation](index.md) · [Force Models](force-models.md) · [Reference Frames](../engineering/reference-frames.md)

## Support status

Orbit does not implement relativistic accelerations in manual propagators or
Relativistic dynamics fixes for SGP4, OEM or SP3.

The availability of time scales such as TT does not imply that they are incorporated
post-Newtonian terms in the equation of motion. TT is used for
frame reduction where appropriate; It is a different responsibility than
dynamic.

## Explicit limits

- No Schwarzschild correction, Lense–Thirring, multipolar effects
  relativistic or relativistic variational integrator.
- There is no general time-space coordinate transformation or conversion
  automatic TDB/TCB/TCG.
- There is no satellite clock model as a propagation product.

Cases requiring relativity must be resolved with an external source and,
if applicable, provided to Orbit as a tabulated anniversary with its metadata
explicit.
# Cowell Propagation

[Home](../index.md) · [Propagation](index.md) · [Numerical Integrators](numerical-integrators.md)

`CowellPropagator` is the configurable numeric path for manual states
terrestrial. Directly integrate the equation of motion and deliver states
native `EME2000`. It is designed for limited manual views and studies.

## Sections

| Theme | Content |
| --- | --- |
| [Input and forces](cowell/input-and-forces.md) | Initial state, supported terms and presets. |
| [Integration and cache](cowell/integration.md) | RK4 fixed pitch and state reuse. |
| [Departure and origin](cowell/output.md) | Query methods, frameworks and metadata. |
| [Faults and limits](cowell/limits.md) | Boundaries of fidelity and conditions of rejection. |

$$
\frac{d}{dt}\begin{bmatrix}\mathbf r\\\mathbf v\end{bmatrix}
=\begin{bmatrix}\mathbf v\\\mathbf a_{central}+\sum\mathbf a_{término}\end{bmatrix}.
$$

See also [Force Models](force-models.md),
[Atmospheric drag](atmospheric-drag.md) and
[Gravity models](../engineering/gravity-models.md).
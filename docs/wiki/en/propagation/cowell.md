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
=\begin{bmatrix}\mathbf v\\\mathbf a_{\mathrm{central}}+\sum_{i\in\mathcal T}\mathbf a_i\end{bmatrix}.
$$

## Equation interpretation

The state given to Cowell is \(\mathbf y=[\mathbf r,\mathbf v]^T\). Its derivative has two parts: the derivative of position is velocity, and the derivative of velocity is total acceleration. Cowell builds that function, \(\mathbf f(t,\mathbf y)=\dot{\mathbf y}\); [RK4](rk4.md) only evaluates it to advance the state.

| Symbol | Meaning | Cowell internal units |
| --- | --- | --- |
| \(t\) | Integration instant. | s from the initial epoch. |
| \(\mathbf r\) | Object position vector. | km. |
| \(\mathbf v\) | Object velocity vector. | km/s. |
| \(\mathbf a_{\mathrm{central}}\) | Central-gravity acceleration, always present. | km/s². |
| \(\mathcal T\) | Set of optional terms requested in `force_terms`. | Not applicable. |
| \(\mathbf a_i\) | Acceleration contributed by optional term \(i\) in \(\mathcal T\). | km/s². |

The sum contains only selected terms. The equation expresses the propagator physics; it does not describe RK4 or impose an integration step by itself.

## Force evaluation frame

During integration, Cowell keeps the state and sums accelerations in `EME2000`, using km, km/s, and km/s². The later conversion to `ITRF` belongs to the frame-transformation service and occurs after the integrated native state is produced.

| Term | Frame used today | Interpretation |
| --- | --- | --- |
| Central gravity | `EME2000`. | It is invariant under a rotation of the coordinate system. |
| J2, J3, and J4 | `EME2000`. | They are zonal \(m=0\) terms; the compatibility implementation treats the `EME2000` \(Z\) axis as Earth's rotation axis. |
| Atmospheric drag | `EME2000`. | It computes \(\mathbf v_{rel}=\mathbf v-\boldsymbol\omega_\oplus\times\mathbf r\) for a co-rotating atmosphere and estimates WGS-84 altitude from the same coordinates. |

This choice keeps one derivative in the native frame and is sufficient for the current interactive-design scope. It is not equivalent to evaluating every Earth-bound term in an instantaneous ITRF realization: precession, nutation, Earth rotation, and polar motion are not applied within each force evaluation.

!!! warning "Frame architecture planned for future implementation"

    In a higher-fidelity propagator, the state would remain integrated in a celestial or inertial frame, while Earth-bound terms would be evaluated temporarily in a terrestrial frame:

    $$
    \mathbf a_{\mathrm{inertial}}=R_{\mathrm{ITRF}\rightarrow\mathrm{inertial}}(t)\;\mathbf a_{\mathrm{ITRF}}.
    $$

    | Element | Planned use |
    | --- | --- |
    | \(R_{\mathrm{ITRF}\rightarrow\mathrm{inertial}}(t)\) | Epoch-dependent Earth rotation based on EOP and appropriate time scales. |
    | \(\mathbf a_{\mathrm{ITRF}}\) | Acceleration evaluated in the terrestrial frame; applicable to drag, high-degree-and-order geopotential, tides, and albedo. |
    | \(\mathbf a_{\mathrm{inertial}}\) | Acceleration rotated to the frame in which the state is integrated. |

    This flow is not executed by Cowell yet. Full geopotential, tides, and albedo are also not implemented; their documentation does not enable those terms.

See also [Force Models](force-models.md),
[Atmospheric drag](atmospheric-drag.md) and
[Gravity models](../engineering/gravity-models.md).

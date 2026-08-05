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
| [Time and frames](cowell/time-and-frames.md) | UTC, TT, UT1, EOP, and EME2000-to-ITRF transformation. |
| [Output and provenance](cowell/output.md) | Query methods and published-state metadata. |
| [Recommended use](cowell/recommended-use.md) | Suitable use cases and situations that require another tool. |
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

## Cartesian formulation and analytical models

Cowell is a Cartesian-dynamics propagator: it integrates \(\mathbf r\) and \(\mathbf v\) directly through \(\ddot{\mathbf r}=\mathbf a(\mathbf r,\mathbf v,t)\) in `EME2000`. It may receive a manual orbit originally described with elements, but it does not use those elements as integration state variables.

Consequently, this path does not integrate Gauss or Lagrange equations, solve perturbed Kepler motion, or retain an orbital plane or nodal system as part of the numerical state. Those formulations belong to analytical or variational propagators; Cowell only needs total Cartesian acceleration at each evaluation.

## Force evaluation frame

During integration, Cowell keeps the state and sums accelerations in `EME2000`, using km, km/s, and km/s². The later conversion to `ITRF` belongs to the frame-transformation service and occurs after the integrated native state is produced.

| Term | Frame used today | Interpretation |
| --- | --- | --- |
| Central gravity | `EME2000`. | It is invariant under a rotation of the coordinate system. |
| J2, J3, and J4 | `EME2000`. | They are zonal \(m=0\) terms; the compatibility implementation treats the `EME2000` \(Z\) axis as Earth's rotation axis. |
| Atmospheric drag | `EME2000`. | It computes \(\mathbf v_{rel}=\mathbf v-\omega_\oplus\times\mathbf r\) for a co-rotating atmosphere and estimates WGS-84 altitude from the same coordinates. |

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

## How Cowell fits into Orbit

Cowell is not a single formula, and RK4 is not an orbit model. Each component has a separate responsibility:

| Component | Responsibility |
| --- | --- |
| `EME2000` state | Defines where the object is and how it moves in the inertial integration frame. |
| Force model | Defines total acceleration: mandatory central gravity plus selected terms. |
| Cowell | Converts the state and forces into the Cartesian derivative \(\mathbf f(t,\mathbf y)\). It is the physical propagator. |
| RK4 | Evaluates that derivative four times to advance one step. It is the numerical integrator. |
| State cache | Reuses the nearest integrated state so successive queries do not repeat the entire arc. It does not alter physics or improve accuracy. |
| Frame transformation | Converts the integrated native state to `ITRF` or another requested frame for consumption. |

For a query, Orbit starts from the manual `EME2000` state, Cowell builds acceleration from the force model, RK4 advances the state, and the native result is stored in cache. Only then is the state transformed to the frame requested by the renderer, API, or export. Keeping these responsibilities separate prevents confusing a force with an integrator or a coordinate transformation with physical propagation.

See also [Force Models](force-models.md),
[Atmospheric drag](atmospheric-drag.md) and
[Gravity models](../engineering/gravity-models.md).

# Cowell propagation

[Home](../index.md) · [Propagation](index.md) · [Numerical integrators](numerical-integrators.md)

`CowellPropagator` is the configurable numerical route for manual Earth
states. It integrates the equation of motion directly and delivers native
`EME2000` states. It is intended for design, visualization, and bounded
studies; it does not certify an operational ephemeris by itself.

## Sections

| Topic | Content |
| --- | --- |
| [Input and forces](cowell/input-and-forces.md) | Initial state, supported terms, and presets. |
| [Integration and cache](cowell/integration.md) | Fixed-step RK4 and state reuse. |
| [Time and frames](cowell/time-and-frames.md) | UTC, TT, UT1, EOP, and stage-wise terrestrial evaluation. |
| [Output and provenance](cowell/output.md) | Query methods and published-state metadata. |
| [Recommended use](cowell/recommended-use.md) | Suitable uses and cases that need another tool. |
| [Failures and limits](cowell/limits.md) | Fidelity boundaries and rejection conditions. |

$$
\frac{d}{dt}\begin{bmatrix}\mathbf r\\\mathbf v\end{bmatrix}
=\begin{bmatrix}\mathbf v\\\mathbf a_{\mathrm{central}}+
\sum_{i\in\mathcal T}\mathbf a_i\end{bmatrix}.
$$

## Equation interpretation

The state is \(\mathbf y=[\mathbf r,\mathbf v]^T\). Its derivative has two
parts: position to velocity and velocity to total acceleration. Cowell builds
\(\mathbf f(t,\mathbf y)=\dot{\mathbf y}\); [RK4](rk4.md) only evaluates that
function to advance the state.

| Symbol | Meaning | Internal units |
| --- | --- | --- |
| \(t\) | Integration instant. | s from initial epoch. |
| \(\mathbf r\), \(\mathbf v\) | Object position and velocity. | km, km/s. |
| \(\mathbf a_{\mathrm{central}}\) | Central gravity, always present. | km/s². |
| \(\mathcal T\) | Set of additional `force_terms`. | Not applicable. |
| \(\mathbf a_i\) | Acceleration of each optional term. | km/s². |

## Dynamics frame and force-evaluation frame

The state and final derivative remain in `EME2000`. That does not mean every
model is physically evaluated in that frame:

| Term | Evaluation frame | Status |
| --- | --- | --- |
| Central | `EME2000`. | Rotation invariant. |
| `j2`, `j3`, `j4` | Compatibility in `EME2000`. | Legacy; approximates Earth axis as fixed. |
| `drag` | Instantaneous `ITRF`, returned to `EME2000`. | Available; uses automatic IERS C01 or labelled nominal rotation, plus leap seconds and ERFA. |
| `geopotential` | Instantaneous `ITRF`, returned to `EME2000`. | Available with validated field and automatic IERS C01 or labelled nominal rotation, plus leap seconds and ERFA. |
| Sun, Moon, SRP, and relativity | Celestial/inertial frame coherent with `EME2000`. | Available with own epoch, coverage, and provenance contracts. |

For a high-fidelity terrestrial term, Cowell does not integrate in a rotating
frame. At each of the four RK4 stages it transforms position — and velocity
when the model needs it — to ITRF, evaluates the force, and rotates the free
acceleration to the inertial frame. See [Time and frames](cowell/time-and-frames.md).

## How Cowell fits into Orbit

| Component | Responsibility |
| --- | --- |
| `EME2000` state | Defines the integrated inertial state. |
| Force model | Builds total acceleration and declares its data/provenance. |
| Cowell | Converts state and forces into \(\mathbf f(t,\mathbf y)\). |
| RK4 | Evaluates the derivative four times to advance one step. |
| State cache | Reuses near states; it does not change physics or accuracy. |
| Frame service | Supplies epoch orientation required by terms and output. |

For a query, Orbit starts from the manual `EME2000` state, composes the valid
accelerations for every stage, integrates, keeps the native state in cache, and
only then publishes the frame requested by renderer, API, or export. Separating
these responsibilities prevents confusing a force, an integrator, and a
coordinate transformation.

See [Force models](force-models.md),
[Configurable geopotential](full-geopotential.md), and
[Atmospheric drag](atmospheric-drag.md).

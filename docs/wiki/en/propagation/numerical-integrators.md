# Numerical integrators

[Home](../index.md) · [Propagation](index.md) · [Propagators](overview.md) · [RK4](rk4.md)

## What an integrator does

A numerical integrator approximates the solution of:

$$
\dot{\mathbf y}=\mathbf f(t,\mathbf y),
\qquad
\mathbf y(t_0)=\mathbf y_0.
$$

It does not define physics: it receives Cowell's derivative and advances the
state. New force models must be evaluated at each stage epoch, but they do not
by themselves change the method or turn a fixed step into an adaptive one.

## Available integrator

Orbit uses classical fixed-step fourth-order Runge–Kutta (RK4) for
<code>CowellPropagator</code>. For step \(h\):

$$
\begin{aligned}
\mathbf k_1 &= \mathbf f(t_n,\mathbf y_n),\\
\mathbf k_2 &= \mathbf f\!\left(t_n+\frac{h}{2},\mathbf y_n+\frac{h}{2}\mathbf k_1\right),\\
\mathbf k_3 &= \mathbf f\!\left(t_n+\frac{h}{2},\mathbf y_n+\frac{h}{2}\mathbf k_2\right),\\
\mathbf k_4 &= \mathbf f(t_n+h,\mathbf y_n+h\mathbf k_3),\\
\mathbf y_{n+1} &= \mathbf y_n+\frac{h}{6}(\mathbf k_1+2\mathbf k_2+2\mathbf k_3+\mathbf k_4).
\end{aligned}
$$

| Symbol | Orbit use and units |
| --- | --- |
| \(t_n\) | Stage instant, s from integrated epoch. |
| \(h\) | Integration step, s; nominally 60 s. |
| \(\mathbf y_n\) | Cartesian state, km and km/s. |
| \(\mathbf f\) | Derivative, km/s and km/s². |
| \(\mathbf k_1\ldots\mathbf k_4\) | Derivative evaluations at their own epochs. |

The last step is shortened to reach requested instant exactly. Backward
propagation uses \(h<0\).

## What remains deferred

| Capability | Why it is not claimed yet |
| --- | --- |
| Adaptive Dormand–Prince / RKF45 | Needs tolerances, error estimator, step rejection, and performance contract. |
| Event location | Needs root finding for eclipse, impact, AOS/LOS, or maneuver. |
| Symplectic / multistep integrators | Need stability study and interaction with time-dependent forces. |
| STM and covariance | Need variational equations and uncertainty contract. |
| Maneuvers | Need events, frames, and explicit mass/impulse. |

In particular, cylindrical SRP eclipse is discontinuous. With fixed RK4, its
transition is resolved only at step granularity; a mission tool must add event
detection and adaptive control before claiming shadow-entry or exit timing
precision.

## Validation

Accuracy must be validated for each arc, step, and force composition. Tests must
check point reproduction, convergence when reducing step, expected conservation
for conservative models, and comparison against a reference ephemeris when
needed. Orbit publishes no general accuracy tolerance for Cowell/RK4.

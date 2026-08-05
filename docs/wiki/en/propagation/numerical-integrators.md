# Numerical integrators

[Home](../index.md) · [Propagation](index.md) · [Propagators](overview.md) · [RK4](rk4.md)

## Method description

A numerical integrator approximates the solution of an initial-value problem:

$$
\dot{\mathbf y}=\mathbf f(t,\mathbf y),
\qquad
\mathbf y(t_0)=\mathbf y_0.
$$

The integrator does not define dynamics or select physical terms. It receives the derivative \(\mathbf f\) from a propagator and advances the state between two instants. Orbit currently provides classical fixed-step fourth-order Runge–Kutta (RK4).

## RK4 equations

For a step \(h\), RK4 evaluates four slopes and forms a weighted average:

$$
\begin{aligned}
\mathbf k_1 &= \mathbf f(t_n,\mathbf y_n),\\
\mathbf k_2 &= \mathbf f\!\left(t_n+\frac{h}{2},\mathbf y_n+\frac{h}{2}\mathbf k_1\right),\\
\mathbf k_3 &= \mathbf f\!\left(t_n+\frac{h}{2},\mathbf y_n+\frac{h}{2}\mathbf k_2\right),\\
\mathbf k_4 &= \mathbf f(t_n+h,\mathbf y_n+h\mathbf k_3),\\
\mathbf y_{n+1} &= \mathbf y_n+\frac{h}{6}\left(\mathbf k_1+2\mathbf k_2+2\mathbf k_3+\mathbf k_4\right).
\end{aligned}
$$

| Symbol | Meaning | Orbit units |
| --- | --- | --- |
| \(t_n\) | Step start instant. | s from the integrated epoch. |
| \(h\) | Step magnitude and direction. | s. |
| \(\mathbf y_n\) | State at the start of the step. | For a Cartesian state: km and km/s. |
| \(\mathbf f\) | Derivative supplied by the propagator. | For a Cartesian state: km/s and km/s². |
| \(\mathbf k_1\ldots\mathbf k_4\) | Intermediate slopes. | Same units as \(\mathbf f\). |

For a Cartesian state, the first part of \(\mathbf f\) is velocity and the second is acceleration. This interpretation does not alter RK4: the method operates on any state vector and compatible derivative.

## Application in Orbit

`CowellPropagator` uses the RK4 core with `integration_step_seconds = 60`. The propagator builds its state derivative, and the integrator evaluates it without knowing the origin of its components.

The final step is reduced when needed to reach the requested instant exactly. For backward propagation, \(h\) is negative. The inspection route limits requests to an estimated 7200 internal 60 s steps, including distance from the epoch and requested samples. This is an inspector operational limit; it does not alter the RK4 method or define an accuracy tolerance.

## Limitations

Fixed-step RK4 does not provide:

- adaptive local or global error control;
- automatic step-size changes for rapid state changes;
- symplectic, multistep, or Gauss–Jackson integration;
- event location through root finding;
- state-transition-matrix or covariance propagation.

Accuracy depends on the integrated interval, fixed step, and derivative given to the integrator. It must be validated for each use case; Orbit publishes no general tolerance for this numerical path.

## Implementation notes

- The nominal step is expressed in seconds and preserves the interval sign.
- The four evaluations are computed sequentially for each RK4 step.
- No interpolation is performed between steps: a final reduced step is used when the target instant does not align with the nominal mesh.
- The integrator does not itself retain states, cache, or provenance; those responsibilities belong to the propagator that uses it.

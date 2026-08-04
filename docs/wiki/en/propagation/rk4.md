# RK4

[Home](../index.md) · [Propagation](index.md) · [Numerical integrators](numerical-integrators.md)

## Overview

Classical fourth-order Runge–Kutta (RK4) is the only numerical integrator currently available in Orbit. Cowell uses it to integrate the Cartesian state with the selected force composition.

## Applied step

For the system \(\dot y=f(t,y)\), with step \(h\), Orbit applies:

$$
\begin{aligned}
k_1 &= f(t,y),\\
k_2 &= f(t+h/2,y+hk_1/2),\\
k_3 &= f(t+h/2,y+hk_2/2),\\
k_4 &= f(t+h,y+hk_3),\\
y_{n+1} &= y_n+\frac{h}{6}(k_1+2k_2+2k_3+k_4).
\end{aligned}
$$

| Variable | Orbit use and units |
| --- | --- |
| \(y\) | Integrated state; Cowell stores position in km and velocity in km/s. |
| \(t\) | Integration instant, in seconds from the state epoch. |
| \(h\) | Integration step in s; 60 s by default. |
| \(f(t,y)\) | State derivative: velocity and acceleration, in km/s and km/s². |
| \(k_1\ldots k_4\) | Intermediate derivative evaluations, with the same units as \(f\). |

The last step is reduced when needed to reach the requested instant exactly. For backward propagation, \(h\) has a negative sign.

## Current use

`CowellPropagator.integration_step_seconds` is 60 s. The historical J2+J3+J4 preset uses the same RK4 core while retaining its own model identity. SGP4 and the analytical propagators do not use RK4.

## Limits

Fixed-step RK4 provides no adaptive error control, event location, symplectic integration, or STM/covariance propagation. Accuracy depends on the orbit, enabled forces, arc, and step, and must be validated for each use case.

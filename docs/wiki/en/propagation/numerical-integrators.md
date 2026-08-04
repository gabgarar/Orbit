# Numerical integrators

[Home](../index.md) · [Propagation](index.md) · [Cowell](cowell.md) · [Force Models](force-models.md)

## Integrator available

The only runtime numerical integrator is classical fourth-order Runge–Kutta
(RK4) fixed pitch. `CowellPropagator.integration_step_seconds` is worth 60s.
The historical preset J2+J3+J4 delegates to the same RK4 core and maintains its own
model identity.

For an \(\dot y=f(t,y)\) system, the applied step is:

$$
\begin{aligned}
k_1 &= f(t,y),\\
k_2 &= f(t+h/2,y+hk_1/2),\\
k_3 &= f(t+h/2,y+hk_2/2),\\
k_4 &= f(t+h,y+hk_3),\\
y_{n+1} &= y_n+\frac{h}{6}(k_1+2k_2+2k_3+k_4).
\end{aligned}
$$

The last step of an interval is reduced to exactly reach the instant
requested. Negative intervals are integrated with a negative sign.

## Application by propagator

| Propagator | Method | Step | Adaptation |
| --- | --- | ---: | --- |
| Two bodies | Analytical | Not applicable | Not applicable. |
| J2 Compatibility | Secular Analytics | Not applicable | Not applicable. |
| Cowell | Classic RK4 | 60s | Not available. |
| J2+J3+J4 | Classic RK4 | 60s | Not available. |
| SGP4 | Library SGP4 Engine | Does not expose Cowell step | Not applicable. |

## Inspection budget

Orbital parameter path limits numerical requests to 7200 steps
estimated internal values of 60 s, including distance from the manual epoch and the
cost of requested samples. Requests that exceed that budget will be
They reject with an actionable error instead of blocking the service.

This restriction is specific to the inspector. It does not convert the integrator into
a tool for arbitrarily long bows.

## Accuracy limitations

Fixed pitch RK4 does not provide:

- local or global error control;
- pitch change by perigee, drag or fast dynamics;
- symplectic, multistep, Gauss–Jackson or variational integrators;
- transition or covariance matrix propagation;
- location of events by searching for roots.

No general accuracy tolerances should be published for Cowell. The
Accuracy depends on orbit, activated terms, arc and fixed pitch, and must
be externally validated for each use case.
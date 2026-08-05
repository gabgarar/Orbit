# Cowell: failures and limits

[Propagation](../index.md) · [Cowell](../cowell.md) · [Numerical integrators](../numerical-integrators.md)

## In one sentence

Cowell can explore a trajectory by repeatedly computing its acceleration, but it is not yet a high-fidelity engine or an operational safety tool. Its output is a trajectory calculated with the available models and a fixed numerical step; it is not a guarantee of accuracy for every orbit.

## What happens when the trajectory crosses Earth

An orbit cannot physically continue through Earth's interior with the models used by this propagator. Central gravity is calculated as \(\mathbf a=-\mu\mathbf r/\lVert\mathbf r\rVert^3\). As the distance from the centre, \(\lVert\mathbf r\rVert\), approaches zero, the denominator becomes very small and the model acceleration grows without bound. That is the mathematical singularity of the point-mass model.

The problem begins before reaching the centre: inside Earth, point-mass gravity, WGS-84 altitude, and the exponential atmosphere no longer represent a physically valid situation. Orbit therefore checks intermediate RK4 states too. If one reaches a radius less than or equal to the WGS-84 polar radius, it stops the calculation and returns an error instead of inventing an underground trajectory.

This is not impact detection. Cowell does not calculate the exact second at which the surface is touched, interpolate the contact point, or apply rebound, fragmentation, or any collision physics. It only says: “this integration has left the domain in which the model makes sense.”

## Why 60 seconds does not work for everything

RK4 currently advances in 60 s jumps. Think of it as drawing a curve with points one minute apart: if the curve changes smoothly, the approximation can be useful; if it turns or changes very quickly between two points, detail is lost.

The integrator does not compare two solutions to decide whether a jump was too large. It also receives no tolerance such as “keep the error below X”, and it does not monitor whether energy remains constant. It always takes the next 60 s jump, even when that segment would deserve smaller steps.

| Situation | Why the fixed step matters |
| --- | --- |
| Long arc | A small error in each jump can accumulate over thousands of steps. |
| Highly eccentric orbit | Near perigee the object moves and changes direction much faster than near apogee. |
| Low perigee with drag | Atmospheric density changes rapidly with altitude; a coarse step can represent that change poorly. |
| Rapid or resonant dynamics | The relevant time scale can be shorter than 60 s and be sampled insufficiently. |

The inspector step budget prevents a very large request from blocking the service. It does not make the result more accurate. Addressing these cases would require an adaptive integrator with error estimation, such as Dormand–Prince or RKF45; neither is implemented in Orbit yet.

## What Cowell does not do yet

### It does not locate events

An event is something that happens between two instants, such as crossing an altitude, entering eclipse, or impacting. Cowell does not search for the root of a condition or automatically reduce the step to find the exact instant. It only evaluates its RK4 stages and applies the Earth-validity boundary described above.

### It does not include all orbital physics

Today it can compose only central gravity, J2, J3, J4, and exponential atmospheric drag. There are no third bodies, solar radiation pressure, relativity, full geopotential, tides, or high-fidelity atmosphere. If an absent effect matters for the studied arc, the trajectory will not reflect it; that does not mean the effect is zero in the real world.

### It does not calculate uncertainty

Cowell propagates one initial state. It does not propagate covariance or a state-transition matrix, so it cannot answer “how far might this position drift?” or produce an error ellipse. Its output must be read as a nominal trajectory.

## Recommended use of Cowell

Cowell is appropriate when the goal is to understand how a force composition affects a bounded arc, not to certify an operational trajectory. It is particularly useful for:

- LEO or MEO study orbits with a moderate arc and accuracy requirements compatible with the fixed step;
- preliminary dynamics studies and visualisation of manual trajectories;
- integration tests and checking that an individual force changes the trajectory in the expected direction;
- comparing numerical propagation with two-body or another simple analytical model;
- validating `force_terms` configurations, for example central gravity versus central gravity plus J2;
- qualitatively exploring LEO drag, while recognising that the current atmosphere model is not suitable for decay or re-entry prediction.

## When not to use Cowell

Do not use the current Cowell/RK4 path as a final result for:

- highly eccentric orbits, where perigee can require steps much shorter than 60 s;
- realistic GEO orbits, because without SRP, third bodies, and other effects the long-term behaviour is not representative;
- resonant or fast-time-scale dynamics;
- trajectories with strong drag, re-entry prediction, or detailed atmospheric analysis;
- long-period propagation, where fixed-step error and omitted effects accumulate;
- GNSS precision, orbit determination, covariance, risk assessment, or windows that require precise event location;
- complex manoeuvres, because Cowell includes no manoeuvre model or parameter estimation.

For these cases, use a validated external ephemeris when available or a higher-fidelity propagator outside Orbit's current scope.

## Related references

- [Cowell Cartesian dynamics](../cowell.md)
- [Recommended use](recommended-use.md)
- [Numerical integrators](../numerical-integrators.md)
- [Full geopotential](../full-geopotential.md)
- [Third bodies](../third-bodies.md)

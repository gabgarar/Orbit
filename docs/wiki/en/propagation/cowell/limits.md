# Cowell: failures and limits

[Propagation](../index.md) · [Cowell](../cowell.md) · [Numerical integrators](../numerical-integrators.md)

## Earth intersection

Cowell rejects an integration when an RK4 stage reaches the interior of Earth. The central point-mass term, \(\mathbf a=-\mu\mathbf r/\lVert\mathbf r\rVert^3\), is singular at \(\lVert\mathbf r\rVert=0\); moreover, Orbit's gravity and atmosphere models are not physically valid inside the terrestrial body.

The implementation checks each intermediate RK4 state and fails at a radius less than or equal to the WGS-84 polar radius. This is a validity boundary, not collision detection: it does not locate the exact impact instant, interpolate the trajectory, or solve surface contact. Rejection prevents an invalid physical state from being published or advanced toward the model singularity.

## Why the fixed step is a limit

RK4 uses a fixed 60 s step. It does not adapt the step to a tolerance, estimate local error, or control energy conservation. If dynamics change on a time scale shorter than the step, the four evaluations may not resolve that variation sufficiently.

This is particularly relevant for low perigees, long arcs, highly eccentric orbits, and regimes with rapid variations or resonances. The inspector step budget protects service operation, but does not improve numerical accuracy. Such cases would require an adaptive integrator with error estimation, such as a Dormand–Prince or RKF45 family; neither is implemented in Orbit today.

## Fidelity limits

- There is no adaptive error control, local tolerance, or energy estimator.
- There is no event detection or root location.
- There are no third bodies, SRP, relativity, full geopotential, tides, high-fidelity atmosphere, or covariance propagation.

## Related references

- [Cowell Cartesian dynamics](../cowell.md)
- [Numerical integrators](../numerical-integrators.md)
- [Full geopotential](../full-geopotential.md)
- [Third bodies](../third-bodies.md)

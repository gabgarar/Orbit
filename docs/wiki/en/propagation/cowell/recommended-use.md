# Cowell: recommended use

[Propagation](../index.md) · [Cowell](../cowell.md) · [Failures and limits](limits.md)

## When to use Cowell

Cowell is appropriate when the goal is to understand how a force composition changes a trajectory over a bounded arc. It is a design and exploration tool, not an operational certification.

- LEO or MEO study orbits with a moderate arc and requirements compatible with the 60 s fixed step.
- Preliminary dynamics studies and visualisation of manual trajectories.
- Integration tests and checking that an individual force changes a trajectory in the expected direction.
- Comparing Cowell with two-body or another simple analytical model.
- Validating `force_terms`, for example central gravity versus central gravity plus J2.
- Qualitatively exploring LEO drag. The current atmosphere model must not be used for decay or re-entry prediction.

## When to choose another tool

Do not use the current Cowell/RK4 path as a final result for:

- highly eccentric orbits, where perigee can require steps much shorter than 60 s;
- realistic GEO orbits, because without SRP, third bodies, and other effects the long-term behaviour is not representative;
- resonant or fast-time-scale dynamics;
- trajectories with strong drag, re-entry prediction, or detailed atmospheric analysis;
- long-period propagation, where fixed-step error and omitted effects accumulate;
- GNSS precision, orbit determination, covariance, risk assessment, or windows that require precise event location;
- complex manoeuvres, because Cowell includes no manoeuvre model or parameter estimation.

In these cases, use a validated external ephemeris when available or a higher-fidelity propagator outside Orbit's current scope.

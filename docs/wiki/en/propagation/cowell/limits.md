# Cowell: failures and limits

[Propagation](../index.md) · [Cowell](../cowell.md) · [Numerical Integrators](../numerical-integrators.md)

## Bugs

- The integration fails if a stage crosses the Earth, instead of returning a
  physically disabled state.

## Loyalty limits

- There is no error control, adaptive step size, local tolerances or
  energy estimator.
- There are no third bodies, SRP, relativity, full geopotential, tides,
  high-fidelity atmosphere or covariance propagation.
- The fixed pitch can accumulate error in long arcs, very eccentric orbits or
  dynamics that require scales less than 60 s.

## Related references

- [Numerical integrators](../numerical-integrators.md)
- [Full Geopotential](../full-geopotential.md)
- [Third bodies](../third-bodies.md)
# Cowell: integration and cache

[Propagation](../index.md) · [Cowell](../cowell.md) · [Numerical Integrators](../numerical-integrators.md)

## Integration

The integrator available is a classic Runge–Kutta fourth-order, fixed-pitch integrator.
of 60s. The instance maintains states calculated by displacement with respect to
of the time. For a new query, integrate from the saved state plus
next.

## Cache

Repeated queries for the same offset reuse the cached value.
The cache is protected for concurrent access within the instance.

There is no interpolation between cached states: the engine integrates the interval that
remains until the requested displacement. Integrations to the past
they use negative RK4 steps.

## Related references

- [Numerical integrators](../numerical-integrators.md)
- [Cowell limits](limits.md)
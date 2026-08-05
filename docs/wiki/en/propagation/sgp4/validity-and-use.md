# SGP4: recommended use and limits

[Propagation](../index.md) · [SGP4](../sgp4.md) · [Cowell](../cowell.md)

## When to use SGP4

SGP4 is appropriate for following Earth satellites published as TLEs: for
catalogue use, visualisation, pass pre-screening, and operations whose required
accuracy is compatible with TLE age and quality. It is particularly useful
when a NORAD TLE is the authorised orbit source.

## Validity regime

- It is designed for Earth-orbiting satellites represented by TLEs.
- It is not an interplanetary propagator or a model for bodies without a NORAD
  TLE.
- It should not be treated as a general model for highly eccentric orbits
  outside the usual operational TLE regime, especially with rapid perigee
  dynamics.
- Frequent manoeuvres, stale TLEs, or configuration changes degrade prediction
  because SGP4 does not estimate those events.
- Long-term extrapolation is not recommended. As an operational rule, more
  than roughly 30 days from the TLE epoch requires an updated TLE or a
  validated ephemeris.

These are use rules, not a binary quality switch: a poor TLE can fail earlier,
while a recent one can be very useful for a short-arc catalogue task.

## When to choose another source

Choose a validated OEM/SP3, or an external higher-fidelity propagator, for
GNSS precision, orbit determination, manoeuvre planning, conjunction work,
re-entry analysis, or long arcs that depend on specific forces and events.

## SGP4 compared with Cowell

| Aspect | SGP4 | Cowell in Orbit |
| --- | --- | --- |
| Input | TLE | Cartesian state and epoch |
| Native frame | `TEME` | `EME2000` |
| Type | Analytical | Numerical: Cartesian dynamics with RK4 |
| Forces | Fixed NORAD model | Explicit available-force composition |
| Accuracy | Good short-term result with a recent TLE | Depends on forces, step, and arc |
| Main use | TLE catalogue and tracking | Simulation and force validation |

There is no universal winner. SGP4 continues a catalogue product; Cowell lets
you study configured dynamics. Neither should be presented as a high-fidelity
ephemeris outside its valid regime.

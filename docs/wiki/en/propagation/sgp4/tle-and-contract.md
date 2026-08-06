# SGP4: TLE and state contract

[Propagation](../index.md) · [SGP4](../sgp4.md) · [TLE](../../formats/tle.md)

## The TLE is the input

SGP4 receives the two complete TLE lines and Orbit constructs it through
`Satrec.twoline2rv`. A TLE is neither a configurable force list nor a
high-fidelity ephemeris: it is a set of mean elements encoded for NORAD's
SGP4 model.

The manual-orbit editor does not transform its `EME2000` elements into a TLE
or use SGP4 as a manual engine. A future synthetic TLE would be the result of
a fit to a reference ephemeris, not a direct frame conversion.

The epoch written in the TLE matters. As a query moves away from it, prediction
usually degrades because of real spacecraft changes and the limits of the
model itself.

## Querying

For every requested epoch, Orbit normalizes the instant to UTC, forms Julian
day and fraction, and calls `Satrec.sgp4`. The library returns position in km
and velocity in km/s; Orbit converts them to SI when it publishes the common
state.

| Aspect | Orbit contract |
| --- | --- |
| Input | Two valid TLE lines. |
| Query epoch | UTC. |
| Native state | Position and velocity from the SGP4 model. |
| Published units | m and m/s in `StateVector`. |
| Centre | `EARTH`. |
| Provenance | `source=TLE`, `propagator=sgp4`, `native_frame=TEME`. |

## Result and errors

`native_state_at` returns a `TEME`/UTC/SI `StateVector`. By default, an SGP4
error code stops the query and is returned to the caller. A non-strict internal
compatibility mode retains a warning, but is not the recommended contract for
a scientific result.

An error does not automatically mean the software is broken. It can mean that
the TLE, requested epoch, or orbital regime has taken the model beyond a valid
evaluation. Always check the age and provenance of the TLE before interpreting
a result.

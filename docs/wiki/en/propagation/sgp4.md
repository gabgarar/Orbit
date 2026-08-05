# SGP4

[Home](../index.md) · [Propagation](index.md) · [TLE](../formats/tle.md) · [Reference Frames](../engineering/reference-frames.md)

## Purpose

`SGP4Propagator` propagates a two-line set using `sgp4.api.Satrec`.
It is the default registered engine for catalog objects and retains
that the native state of SGP4 is expressed in `TEME`.

## What SGP4 is

SGP4 is an **analytical** propagator designed to work with TLEs. It is based
on Brouwer-Lyddane theory and includes the operational NORAD corrections of
the model. It therefore propagates the elements published in a TLE; it does
not calculate a new trajectory from a user-selected set of accelerations.

It is not a numerical integrator and it has no force selector. The effects
considered by SGP4 belong to its fixed NORAD model; `force_terms`, Cowell J2,
SRP, or configurable drag do not alter an SGP4 propagation.

## Entry and exit

| Appearance | Contract |
| --- | --- |
| Entry | Two valid TLE lines for `Satrec.twoline2rv`. |
| Consultation period | UTC; It is used to construct the Julian date of SGP4. |
| Native State | Position km and speed km/s of SGP4, converted to SI in `StateVector`. |
| Native framework | `TEME`. |
| renderer output | ITRF requested via `FrameTransformService`. |
| Origin | `source=TLE`, `propagator=sgp4`, `native_frame=TEME`. |

## Calculation flow

```mermaid
flowchart LR
    T[TLE] --> S[Satrec.twoline2rv]
    Q[Época UTC] --> J[Julian day + fracción]
    J --> P[Satrec.sgp4]
    S --> P
    P --> N[StateVector TEME]
    N --> X[TEME → PEF → ITRF]
```

If SGP4 returns an error code, `native_state_at` fails by default. The
non-strict internal mode retains a compatibility warning, but does not
is the recommended contract for a scientific application.

## Time and frame

SGP4 production uses the UTC query epoch. For land departure, the
TEME route uses model-compatible GMST rotation and polar motion.
A legacy DUT1 value can be injected into the constructor, but the path
recommended is a versioned EOP provider on the shared transformer.

A TEME state should not be labeled as GCRF, EME2000 or ECI. See
[Reference frames](../engineering/reference-frames.md).

## Manual use

The manual orbit interface can select SGP4 using a TLE
synthetic generated from its fields. That path is useful to compare the output
SGP4 operational; does not convert manual elements into a physical model
equivalent to two bodies, J2 or Cowell.

## Validity regime

SGP4 is intended for Earth-orbiting satellites represented by a recent TLE.
Its result is a prediction consistent with the catalogue, not an unlimited
precision ephemeris.

- It is not a propagator for interplanetary trajectories or bodies that are
  not described by a NORAD TLE.
- It should not be used as a general model for highly eccentric orbits outside
  the usual operational TLE regime, especially where perigee or dynamics vary
  rapidly.
- Frequent manoeuvres, a stale TLE, or configuration changes degrade the
  prediction because the model does not estimate those events.
- It is not recommended for long-term propagation. As an operational rule,
  results more than roughly 30 days from the TLE epoch require an updated TLE
  or a validated ephemeris source.

## SGP4 compared with Cowell

| Aspect | SGP4 | Cowell in Orbit |
| --- | --- | --- |
| Input | TLE | Cartesian state and epoch |
| Native frame | `TEME` | `EME2000` |
| Type | Analytical | Numerical: Cartesian dynamics integrated with RK4 |
| Forces | Fixed NORAD model | Explicit composition of available forces |
| Accuracy | Good over the short term when the TLE is recent | Depends on physical model, step, and arc |
| Main use | TLE catalogue and object tracking | Physical simulation and force validation |

The choice is not about which is universally "better": use SGP4 to continue
a catalogue TLE, and Cowell when you need control of the initial state and
dynamics model. See also [Cowell](cowell.md).

## Accuracy and limitations

- Fidelity depends on the quality, period and regime of use of the TLE of
  origin; Orbit does not reconstruct a TLE history or adjust its parameters.
- There is no force selection, configurable drag, propagated covariance or
  events associated with SGP4.
- The catalog ephemeris export endpoint currently accepts
  only `sgp4`.
- The TEME→ITRF transformation is conditioned by the EOP policy; the
  visual fallback is marked as approximate.

For the input format and its validations, see [TLE](../formats/tle.md).

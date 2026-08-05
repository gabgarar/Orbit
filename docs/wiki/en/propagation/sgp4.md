# SGP4

[Home](../index.md) · [Propagation](index.md) · [Propagators](overview.md) · [TLE](../formats/tle.md)

## Overview

`SGP4Propagator` propagates a TLE with `sgp4.api.Satrec`. It is the default
engine for Orbit catalogue objects, and its native state is always declared in
`TEME`.

SGP4 is an **analytical** propagator for TLEs. It is based on
Brouwer-Lyddane theory and NORAD operational corrections. It is not a
numerical integrator and does not recalculate a trajectory from user-selected
forces.

## Why use SGP4

- It is the practical standard for continuing a catalogue TLE.
- It is fast: each request evaluates the TLE's analytical model, without RK4
  integration steps.
- It retains the correct native frame (`TEME`) and delegates terrestrial
  conversion to the shared frame and EOP service.

## Module guide

| Topic | What you will learn |
| --- | --- |
| [TLE and state contract](sgp4/tle-and-contract.md) | What a TLE represents, how it is queried, and what Orbit returns. |
| [Time and frames](sgp4/time-and-frames.md) | Why queries use UTC, why TEME is native, and how to request ITRF. |
| [Recommended use and limits](sgp4/validity-and-use.md) | The useful TLE regime, expected errors, and a comparison with Cowell. |

## Fundamental rule

SGP4 has no `force_terms`: Cowell J2, configurable drag, SRP, or a custom
force composition do not alter an SGP4 result. Use [Cowell](cowell.md) when
you need control of the initial state and dynamics; use SGP4 to continue an
object represented by a recent TLE.

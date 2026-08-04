# Analytical J2 propagator

[Home](../index.md) · [Propagation](index.md) · [Propagators](overview.md) · [J2 force model](j2.md)

## Overview

This compatibility path is an **analytical propagator**, not the J2 force model used by Cowell. It starts from manual Keplerian elements and applies first-order secular rates.

It preserves semi-major axis, eccentricity, and inclination, while updating RAAN, argument of periapsis, and mean anomaly. Its native state is `EME2000`, with internal km and km/s units.

## Relation to the J2 force model

The [J2](j2.md) page under **Force models** describes a separate implementation: Cowell evaluates the zonal acceleration at every RK4 stage and can combine it with J3, J4, and drag. The two mechanisms must not be treated as the same propagator.

| Path | Type | Input | Integrator |
| --- | --- | --- | --- |
| `j2` | Analytical secular propagator | Keplerian elements | Not applicable. |
| `cowell-rk4` with `j2` | Numerical force model | Cartesian state | [RK4](rk4.md). |

## Limits

It does not model drag, energy changes, full geopotential, tesseral or sectorial terms, tides, or time-varying coefficients. Use [Cowell](cowell.md) to combine forces.

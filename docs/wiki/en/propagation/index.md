# Propagation

[Home](../index.md) · [Engineering](../engineering/index.md) · [Formats](../formats/index.md)

Orbit distinguishes between the model generating a native state and the later
transformation for a terrestrial view. The catalogue uses SGP4; manual orbits
have analytical and numerical routes with explicit frame, time, data, and limit
contracts.

## Propagator and model map

| Topic | Status |
| --- | --- |
| [Overview](overview.md) | Common contract and engine selection. |
| [SGP4](sgp4.md) | Catalogue TLE; not a manual-orbit engine. |
| [Two body](two-body.md) | Manual analytical Keplerian model. |
| [Cowell](cowell.md) | RK4 integration of selected forces. |
| [Numerical integrators](numerical-integrators.md) | Fixed RK4; adaptive, events, and covariance deferred. |
| [Force models](force-models.md) | Composition, frames, and provenance. |
| [Point mass](point-mass.md) | Central gravity. |
| [J2](j2.md), [J3](j3.md), [J4](j4.md) | Compatibility zonal terms. |
| [Configurable geopotential](full-geopotential.md) | Available with local ICGEM, degree/order, strict ITRF. |
| [Third bodies](third-bodies.md) | Available for approximate Sun (`eraEpv00`) and Moon (`eraMoon98`). |
| [Atmospheric drag](atmospheric-drag.md) | First-order exploratory Cowell term. |
| [Solar radiation pressure](solar-radiation-pressure.md) | Available: cannonball and cylindrical umbra. |
| [Relativity](relativity.md) | Available: Earth Schwarzschild. |
| [Tides](tides.md), [albedo](albedo.md), [attitude](attitude.md) | Deferred and documented without claiming availability. |

!!! warning "Scientific scope"

    Manual engines are not a high-fidelity chain or an orbit-determination
    system. Selecting a propagator or seeing a documentation section does not
    enable a force: runtime must report capability, validate auxiliary data, and
    record effective provenance.

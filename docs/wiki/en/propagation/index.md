# Propagation

[Home](../index.md) · [Engineering](../engineering/index.md) · [Formats](../formats/index.md)

Orbit distinguishes between the model that generates the native state and the transformation
back for a terrestrial view. Engine availability depends on
origin: catalog registers SGP4; manual orbits have routes
analytical and numerical delimited.

## Map of propagators and models

| Theme | State |
| --- | --- |
| [Overview](overview.md) | Common contract and engine selection. |
| [SGP4](sgp4.md) | Catalogue TLE; it is not a manual-orbit engine. |
| [Two bodies](two-body.md) | Manual analytical Keplerian model. |
| [Cowell](cowell.md) | RK4 integration of selected forces. |
| [Numerical integrators](numerical-integrators.md) | Fixed RK4 and usage limits. |
| [Force Models](force-models.md) | Composition available. |
| [Point mass](point-mass.md) | Central gravity. |
| [J2](j2.md) | Analytical path and numerical term. |
| [J3](j3.md) | Cowell numerical zonal term. |
| [J4](j4.md) | Cowell numerical zonal term. |
| [Full Geopotential](full-geopotential.md) | Support status: not available. |
| [Third bodies](third-bodies.md) | Support status: not available. |
| [Atmospheric drag](atmospheric-drag.md) | First-order Cowell term. |
| [Solar radiation pressure](solar-radiation-pressure.md) | Support status: not available. |
| [Relativity](relativity.md) | Support status: not available. |

!!! warning "Scientific field"

    Manual motors are not a hi-fi chain or a transmission system.
    orbit determination. Selecting a propagator does not activate forces
    that are not expressly indicated in your contract.

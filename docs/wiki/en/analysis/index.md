# Orbital analysis

[Home](../index.md){ .md-button }

Orbit's analysis capabilities are limited to results derived from
the propagated trajectories, the inspection of orbital parameters and the
visual tools available in the workspace. This section
separates those capabilities from the navigation and determination products
orbit that Orbit does not implement.

## Areas

| Area | State | Page |
| --- | --- | --- |
| Scope and limits of the analysis | Available derived capacities and product limits. | [Overview](overview.md) |
| Propagated orbital parameters and associated graphs | Available for TLE flows and manual orbits. | [Charts](plots.md) |
| Comparison of propagators | No dedicated comparison tool. | [Comparison](comparison-tools.md) |
| Events | AOS/LOS of stations available by sampling; there is no generic event engine. | [Events](events.md) |
| Fleet statistics | Not available. | [Statistics](statistics.md) |
| Measurements and tracking | Not available as an observation string. | [Measurements](measurements.md) and [tracking](tracking.md) |
| Orbit determination | Not available. | [Orbit determination](orbit-determination.md) |

## Interpretation principle

A display result, graph, or AOS/LOS step represents the
configured model, data and sampling resolution. They do not constitute a
estimation of uncertainty, a validation against measurements or a solution of
navigation.

## Related references

- [Spread](../propagation/overview.md)
- [Ground Stations](../user-guide/ground-stations.md)
- [Export](../user-guide/export.md)
- [Validation](../operations/validation.md)
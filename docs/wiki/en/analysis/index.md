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
| Fleet statistics | Not available. | [Statistics](statistics.md) |

## Interpretation principle

A display result or graph represents the configured model, data and sampling
resolution. They do not constitute an uncertainty estimate, a validation
against measurements or a navigation solution.

## Ground operations

AOS/LOS passes, measurements, tracking and future orbit determination are
organised under [Ground Segment](../ground-segment/index.md). This avoids
mixing trajectory analysis with the operation of a station and its observation
chain.

## Related references

- [Spread](../propagation/overview.md)
- [Passes and visibility](events.md)
- [Export](../user-guide/export.md)
- [Validation](../operations/validation.md)

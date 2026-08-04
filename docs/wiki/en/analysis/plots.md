# Orbital graphs and parameters

[Analysis](index.md){ .md-button } [Export](../user-guide/export.md){ .md-button }

Orbit presents propagated orbital parameters and graphs associated with the
TLE flows and manual orbits. The objective is to inspect the evolution of
a trajectory calculated by the selected model, not providing a
general platform for scientific analysis of time series.

## Data represented

| Set | Source | Usage |
| --- | --- | --- |
| Position and speed | Spread States | Trajectory inspection and telemetry. |
| Osculating parameters | Orbital parameters endpoint | Tracking the derived orbital geometry. |
| Visual path | Orbit samples | Spatial context and ground track. |

## Export

Interface graphics can be exported as PNG. The SGP4 anniversaries
can be exported in the formats exposed by the export flow. one
Export does not modify the propagator or convert an unused source format.
supported on a high fidelity source.

## Limits

- There is no notebook API or public Python graphics library.
- Confidence intervals, uncertainty bands or
  inferential statistics.
- The availability of parameters depends on the origin and the model; an OEM
  tabulated does not acquire TLE parameters by interface conversion.

## Related references

- [Orbital representations](../engineering/orbit-representations.md)
- [Propagation](../propagation/overview.md)
- [Statistics](statistics.md)
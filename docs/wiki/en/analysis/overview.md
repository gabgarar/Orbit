# Scope of analysis

[Analysis](index.md){ .md-button } [Home](../index.md){ .md-button }

Orbit offers analysis associated with a specific trajectory: propagated states,
derived orbital parameters, visualization of orbits and terrain, and access to
AOS/LOS windows. The scope focuses on interpreting the result of a
existing model; it does not estimate a state from observations.

## Results available

| Result | Source | Considerations |
| --- | --- | --- |
| Cartesian state | Propagator or tabulated ephemeris | It must preserve frame, time scale and units. |
| Propagated osculating parameters | Orbital Parameters Service | They depend on the model and the declared native framework. |
| Trajectory and ground track | Viewer Spread Samples | The resolution and the time window determine the representation. |
| AOS/LOS Windows | Visibility sampling from a station | Precision is limited by the sampling step. |

## Exclusions

Fleet statistical indicators are not provided, detection of
conjunctions, reentry analysis, collision probabilities, Monte Carlo,
constellation optimization or uncertainty propagation.

## Related references

- [Propagator Comparison](comparison-tools.md)
- [Graphics](plots.md)
- [Events](events.md)
- [Force models](../propagation/force-models.md)
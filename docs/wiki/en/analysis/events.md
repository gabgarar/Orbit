# Passes and visibility

[Ground Segment](../ground-segment/index.md){ .md-button } [Ground Stations](../user-guide/ground-stations.md){ .md-button }

Orbit does not include a generic orbital event detection engine. The
event-related available capacity is the AOS/LOS calculation for
a ground station, obtained by sampling the geometry of
visibility over a temporal window.

## AOS and LOS

| Term | Operational definition |
| --- | --- |
| AOS | Refined instant at which an object starts meeting the configured elevation mask and link criterion. |
| LOS | Later refined instant at which it no longer meets either criterion. |
| Sampling step | Discovery cadence used to locate candidate pass intervals. |

!!! warning "Event precision"

    Orbit first scans the time window at the configured step. When two
    consecutive samples bracket a visibility change, it refines that interval
    by bisection to approximately 0.5 s. An AOS or LOS is therefore not
    limited to the exact coarse-sample time, but its accuracy still depends on
    the trajectory, EOP, mask and RF model.

    This is not a generic root-finding engine: a pass that both begins and
    ends between two discovery samples is not bracketed and can be missed.
    Reduce the step for very short windows or restrictive masks/envelopes.

## Status

**Not available:** eclipse detection, node crossings, perigee/apogee,
maneuvers, conjunctions, reentry, lighting events or event rules
defined by the user.

## Related references

- [Tracking](tracking.md)
- [Earth Models](../engineering/earth-models.md)
- [Cowell](../propagation/cowell.md)

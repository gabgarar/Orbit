# Orbital events

[Analysis](index.md){ .md-button } [Ground Stations](../user-guide/ground-stations.md){ .md-button }

Orbit does not include a generic orbital event detection engine. The
event-related available capacity is the AOS/LOS calculation for
a ground station, obtained by sampling the geometry of
visibility over a temporal window.

## AOS and LOS

| Term | Operational definition |
| --- | --- |
| OSA | First sample of a window in which the object meets the configured elevation mask. |
| THE | First subsequent sample in which that mask is no longer fulfilled. |
| Sampling step | Temporal resolution that limits the temporal precision of the result. |

!!! warning "Event precision"

    The current calculation does not refine the crossover by root search. AOS or
    LOS must be interpreted with an uncertainty linked to the configured step
    and the trajectory model used.

## Status

**Not available:** eclipse detection, node crossings, perigee/apogee,
maneuvers, conjunctions, reentry, lighting events or event rules
defined by the user.

## Related references

- [Tracking](tracking.md)
- [Earth Models](../engineering/earth-models.md)
- [Cowell](../propagation/cowell.md)
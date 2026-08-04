# Measurements

[Analysis](index.md){ .md-button }

Orbit does not incorporate a navigation measurement model or a data store.
observations. Ground stations allow you to view geometry,
visibility and a simplified link budget, but they do not produce or
process calibrated range, Doppler, angle or GNSS observations.

## Status

**Not available:** simulation of measurements, instrumental noise, biases,
calibration, format of observations, association of measurements to objects and
persistence of tracking campaigns.

## Consequence for interpretation

The AOS/LOS, footprint and link budget values are results of
geometry and visualization model. They should not be used as inputs to a
navigation solution nor as substitutes for station telemetry.

## Related references

- [Ground Stations](../user-guide/ground-stations.md)
- [Tracking](tracking.md)
- [Orbit Determination](orbit-determination.md)
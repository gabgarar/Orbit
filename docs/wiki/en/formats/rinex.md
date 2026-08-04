# RINEX

[Home](../index.md) · [Formats](index.md) · [Unsupported formats](unsupported-formats.md) · [SP3](sp3.md)

## Support status

Orbit does not implement observation, navigation, meteorology or clock RINEX.

There is no parser, measurement preprocessing, receiver model, ephemeris of
navigation, clock estimation, orbit determination or integration with
ground stations from RINEX.

## Relationship with SP3

SP3 and RINEX are different formats. The existence of a reader
[SP3](sp3.md) does not provide compatibility with RINEX nor does it allow rebuilding an SP3
from RINEX observations within Orbit.

## Alternatives

To display an externally calculated trajectory, use an ephemeris
tabulation compatible with available Python readers and keep in the
provenance that comes from external GNSS processing. Orbit doesn't run that
processing.
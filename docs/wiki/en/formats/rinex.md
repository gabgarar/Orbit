# RINEX

[Home](../index.md) · [Formats](index.md) · [Unsupported formats](unsupported-formats.md) · [SP3](sp3.md)

## Support status

Orbit supports **RINEX CLK** as clock data associated with a precise SP3
import. It reads `AS` satellite-clock records and retains bias and, when
present, rate, rate-of-rate, and their sigmas in CLK-published units. A CLK is
not a Cartesian ephemeris and cannot create an orbital layer without SP3.

Observation, navigation, and meteorological RINEX remain unimplemented. There
is no measurement preprocessing, receiver model, navigation ephemeris, PPP,
clock estimation, orbit determination, or ground-station integration from
RINEX observations.

## Relationship with SP3

SP3 and RINEX are different formats. A CLK product accompanies SP3 states by
GNSS identifier and epoch, but does not modify coordinates or velocity. The
existence of an [SP3](sp3.md) reader does not allow rebuilding SP3 from RINEX
observations inside Orbit.

See [Precise GNSS products](precise-products.md) for SP3+CLK pairing,
providers, provenance, time scales, and limitations.

## Alternatives

To display an externally calculated trajectory, use an ephemeris
tabulation compatible with available Python readers and keep in the
provenance that comes from external GNSS processing. Orbit doesn't run that
processing.

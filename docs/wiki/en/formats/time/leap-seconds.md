# Leap-second table

[Home](../../index.md) · [Time formats](index.md)

## Accepted format

`LeapSecondTable` reads an ASCII IERS/NTP `leap-seconds.list` snapshot,
including its identity and expiry date. The table enables UTC↔TAI conversion and
the scales depending on that relationship.

## Integrity

Deployment can pin a local path, expected SHA-256, and presence or freshness
requirements. A global update therefore cannot silently alter a reproducible
scientific result.

See [time systems](../../engineering/time-systems.md) for conversions and
constraints.

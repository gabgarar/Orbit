# IERS Bulletins A and B

[Home](../../index.md) · [Time formats](index.md)

## Support status

Orbit has no direct reader for Bulletin A or Bulletin B. It does not interpret
their predictions, revisions, or conventions as a replacement for a compatible
C04 file.

!!! warning "Format planned for future implementation"

    Support must publish accepted fields, the distinction between observed and
    predicted data, its interpolation policy, and provenance accompanying the
    result.

## Current alternative

Use a compatible C04-14/C04-20 file and a local leap-second table.

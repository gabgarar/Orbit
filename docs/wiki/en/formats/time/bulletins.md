# IERS Bulletins A and B

[Home](../../index.md) · [Time formats](index.md)

## Support status

Orbit has no direct reader for Bulletin A or Bulletin B, nor for IGS ERP
files. It does not interpret predictions, revisions, or conventions from those
sources as a silent replacement for a compatible C04 snapshot.

!!! warning "Format planned for future implementation"

    Future integration must be local and versioned. It must declare accepted
    fields, the distinction between observed and predicted data, interpolation
    policy, coverage, publication date, provider, and the SHA-256 snapshot
    identity accompanying every result.

## Planned future routes

- [IERS Bulletin A](https://maia.usno.navy.mil/products/bulletin-a) can
  provide rapid EOP and predictions. A future import must preserve whether a
  value is rapid or predicted; a prediction is never promoted to final.
- [IGS products](https://igs.org/products/) publish ERP files alongside some
  Final, Rapid, and Ultra-Rapid series. A future ERP input must be explicitly
  paired with the SP3 from the same revision; Orbit does not currently import,
  download, or pair `*.ERP` files.

## Current alternative

Use a local [IERS EOP 20u24 C04](iers-c04.md) snapshot and a local leap-second
table.

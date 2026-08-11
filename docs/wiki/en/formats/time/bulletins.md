# IERS Bulletins A and B

[Home](../../index.md) · [Time formats](index.md)

## Support status

The **Import GNSS product** window accepts a local ERP from the same product as
the SP3 through `.ERP` or `.ERP.gz`. The file is retained with its hash,
coverage, and provenance and is used when an ITRF-to-ECI conversion is
requested. It is not downloaded, inferred, or paired from the SP3 name.

Without ERP, Orbit labels output **Marco terrestre aproximado (sin ERP)** and
blocks conversion to ECI. With ERP and an applied realization route, the
operational label is **ITRF (con ERP aplicado)**. ERP supplies Earth
orientation, not an IGS-to-ITRF datum transformation. See [Precise GNSS
products](../precise-products.md) for window fields and exact validation
messages.

## Routes not integrated yet

- [IERS Bulletin A](https://maia.usno.navy.mil/products/bulletin-a) can
  provide rapid EOP and predictions. A future import must preserve whether a
  value is rapid or predicted; a prediction is never promoted to final.
- [IGS products](https://igs.org/products/) publish ERP files alongside some
  Final, Rapid, and Ultra-Rapid series. Orbit accepts the ERP explicitly
  selected by the operator in the same import; it does not download or choose
  a remote revision automatically.

## Current alternative

Use a local [IERS EOP 20u24 C04](iers-c04.md) snapshot and a local leap-second
table.

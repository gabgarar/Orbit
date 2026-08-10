# IERS EOP C04

[Home](../../index.md) · [Time formats](index.md)

## Recommended source

For current operations, use the official [IERS EOP 20u24 C04 with IAU 2000A
`dX`/`dY`](https://datacenter.iers.org/products/eop/long-term/c04_20u24/)
product. It is the current continuation of the C04 series and publishes DUT1,
polar motion, `dX`, `dY`, and LOD for the frame-transformation route. Keep the
exact revision, download date, and SHA-256 locally; the [IERS metadata
record](https://datacenter.iers.org/versionMetadata.php?filename=latestVersionMeta%2F254_EOP_C04_20u24.62-NOW254.txt)
identifies the published version.

## Accepted format

Orbit reads the C04-20 ASCII layout with IAU 2000A `dX`/`dY` corrections. The
reader also retains replay compatibility for historical C04-14 snapshots, but
C04-14 is no longer the recommended operational source and must not be chosen
for new data.

## Rejections

An IAU 1980 C04 declaring `dPsi`/`dEps` is rejected when its header identifies
it. Strict mode also requires coverage for the requested epoch, allowed EOP
quality, and a verifiable snapshot identity.

Configuration and provenance are described in [local time and EOP
files](../../operations/time-eop/data-files.md).

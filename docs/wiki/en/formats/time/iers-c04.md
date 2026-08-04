# IERS EOP C04

[Home](../../index.md) · [Time formats](index.md)

## Accepted format

Orbit reads ASCII IERS EOP C04-14 or C04-20 files with IAU 2000A `dX`/`dY`
corrections. The provider supplies DUT1, polar motion, dX, dY, and LOD to the
frame-transformation route.

## Rejections

An IAU 1980 C04 declaring `dPsi`/`dEps` is rejected when its header identifies
it. Strict mode also requires coverage for the requested epoch and permitted
EOP quality.

Configuration and provenance are described in [local time and EOP
files](../../operations/time-eop/data-files.md).

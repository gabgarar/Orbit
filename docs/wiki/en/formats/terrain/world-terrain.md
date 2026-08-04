# Cesium World Terrain

[Home](../../index.md) · [Terrain formats](index.md)

## Availability

At startup, the viewer requests `Cesium.createWorldTerrainAsync()`. When the
provider resolves, Cesium delivers remote relief; Orbit does not download,
convert, or version its tiles.

## Fallback

If the request fails, the viewer uses `EllipsoidTerrainProvider`. The
application remains available, but the fallback contains no topographic height.

## Limits

This source is only used for rendering. It does not modify propagated states,
computed visibility, or frame and time contracts.

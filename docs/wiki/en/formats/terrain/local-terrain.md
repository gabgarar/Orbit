# Local terrain files

[Home](../../index.md) · [Terrain formats](index.md)

## Support status

Orbit does not ingest local terrain files. There is no reader, catalogue, or
persistence for GeoTIFF, DEM, DTED, quantized-mesh, 3D Tiles, or equivalent
elevation models.

!!! warning "Format planned for future implementation"

    Local support must declare the format, reference system, vertical datum,
    resolution, coverage and cache policy. These cannot be inferred from an
    image or an external Cesium provider.

## Current alternative

Use Cesium World Terrain when available, or the visual ellipsoid fallback.
Neither path creates a terrain asset in a project.

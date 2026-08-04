# Terrain formats

[Home](../../index.md) · [Formats](../index.md)

## Overview

Orbit consumes terrain for Cesium visualisation. It does not interpret it as
an orbital-science product or store it in the Python backend.

| Source | Status | Use |
| --- | --- | --- |
| [Cesium World Terrain](world-terrain.md) | Available at boot if the remote provider responds. | Globe relief. |
| [Local files](local-terrain.md) | Unavailable. | No terrain ingestion or catalogue. |

A remote-provider failure does not block the application: Orbit uses Cesium's
local ellipsoid as a visual fallback.

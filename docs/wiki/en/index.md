# Orbit

## Overview

Orbit is a local environment for importing, propagating, analysing and visualising Earth-centred orbital states. It combines a Node.js gateway, a private Python orbital service and a Cesium workspace.

Every state retains epoch, time scale, frame, centre, SI units and provenance. A presentation conversion never silently changes the native state.

## Why Orbit

- Preserve native data while serving viewer-ready states.
- Share one transformation boundary for TLE, analytical propagation, Cowell, OEM and future SP3 products.
- Use local, versioned and reproducible EOP and leap-second data.
- Provide persistent local projects, layers, bodies and a timeline.

## Quick example

```text
TLE / OEM / manual definition → native StateVector → requested transform
                                            → viewer, analysis or export
```

## Modules

| Module | Purpose |
| --- | --- |
| [Engineering concepts](modules/engineering.md) | States, elements, frames, time and Earth models. |
| [Time, EOP and ITRF](time.md) | Scales, UT1, GMST, terrestrial reduction and covariance. |
| [Propagation](modules/propagation.md) | Propagators, forces, integration and cache. |
| [Orbit service](orbit-service.md) | Formats, catalogue, analysis and export. |
| [Gateway](gateway.md) | Node runtime, routes, persistence and supervision. |
| [Workspace](workspace.md) | Projects, layers, bodies, time and 3D view. |
| [API reference](api.md) | HTTP, WebSocket and integration contracts. |
| [Internals](internals.md) | Mathematics, provenance, strict mode and limits. |

!!! note "Local runtime"

    Orbit is distributed as one Docker image. Python stays private inside the container; Node is the public boundary.

The former topic pages are retained as detailed technical source material. This module structure is the canonical navigation layer and does not retire their contracts or limits.

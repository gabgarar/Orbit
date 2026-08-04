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

## Explore Orbit

<div class="grid cards" markdown>

- :material-orbit: **Engineering concepts**

  States, elements, frames, time and Earth models.

  [Open engineering →](engineering.md)

- :material-chart-timeline-variant: **Propagation**

  SGP4, two-body, Cowell, force models, integration and cache.

  [Open propagation →](propagation.md)

- :material-satellite-variant: **Orbit service**

  Formats, catalogue, analysis and export boundaries.

  [Open service →](orbit-service.md)

- :material-server-network: **Gateway**

  Node runtime, routes, persistence and process supervision.

  [Open gateway →](gateway.md)

- :material-layers-triple: **Workspace**

  Projects, layers, bodies, time modes and 3D visualisation.

  [Open workspace →](workspace.md)

- :material-api: **API reference**

  HTTP, WebSocket and public integration contracts.

  [Open API →](api.md)

- :material-function-variant: **Internals**

  Mathematics, reference data, strict mode and explicit limits.

  [Open internals →](internals.md)

</div>

!!! note "Local runtime"

    Orbit is distributed as one Docker image. Python stays private inside the container; Node is the public boundary.

The former topic pages are retained as detailed technical source material. This module structure is the canonical navigation layer and does not retire their contracts or limits.

# User Guide

[Home](../index.md) · [Quick Start](../getting-started/quick-start.md)

The user guide describes the local Orbit workspace. Each page
is limited to interactions implemented in the current runtime and declares the
limits affecting data retention and technical interpretation.

## Usage map

| Area | Purpose |
| --- | --- |
| [Projects](projects.md) | Create, open, save and download local project documents. |
| [Workspace](workspace.md) | Identify panels, selection and actions of the work environment. |
| [Layers](layers.md) | Organize layers and folders, and control their visibility. |
| [Manual orbits](manual-orbits.md) | Design, preview, and confirm an Earth-centred orbit. |
| [Visualization](visualization.md) | Configure the appearance of objects, orbits, map and scene. |
| [3D View](three-d-view.md) | Change projection, navigation, camera and local recording. |
| [Timeline](timeline.md) | Work in static, real-time or range simulation mode. |
| [Master Time Range](master-time-range.md) | Keep one coherent UTC window for finite-coverage objects. |
| [Built-In Test](built-in-test.md) | Inspect published runtime health and local scene state. |
| [Ground Stations](ground-stations.md) | Configure stations and view sampled visibility. |
| [Import](import.md) | Incorporate orbital data and GeoJSON, Orbit JSON, or CSV stations within available limits. |
| [Export](export.md) | Download projects, elements, ephemerides, and stations. |

## Principles of use

- Workspace and projects are local to the browser and file
  that the operator saves. There is no remote synchronization or collaboration.
- A visual layer does not replace your orbital contract: TLE/SGP4, OEM and orbits
  manuals have different origins and limits.
- The generic ECI and ECEF labels do not identify a sufficient framework for
  precision results. Time and frame settings are managed
  outside the interface in [Time Operation and EOP](../operations/time-eop.md).
- Available actions depend on the type of item. The context menu
  of a project, folder, layer, or station displays only applicable operations.

!!! warning "Scope not available"

    Orbit does not incorporate users, roles, collaboration, remote storage,
    orbit determination, measurement ingestion or a plugin system
    installable. Don't use local persistence as a substitute for a system
    mission documentary control.

Use the [quick start](../getting-started/quick-start.md) to start a
new session.

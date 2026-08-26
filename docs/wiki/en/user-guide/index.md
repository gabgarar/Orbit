# User Guide

[Home](../index.md) · [Quick Start](../getting-started/quick-start.md)

The user guide describes the local Orbit workspace. Each page
is limited to interactions implemented in the current runtime and declares the
limits affecting data retention and technical interpretation.

## Usage map

| Area | Purpose |
| --- | --- |
| [Local identity and linked projects](identity-projects.md) | Local access, an encrypted vault per account, and a project library; remote synchronization still requires an explicit adapter. |
| [Local user administration](local-user-administration.md) | Per-installation bootstrap, roles, account lock, and reset requests without a backend. |
| [Projects](projects.md) | Create, open, save and download local project documents. |
| [Workspace](workspace.md) | Identify panels, selection and actions of the work environment. |
| [Layers](layers.md) | Organize layers and folders, and control their visibility. |
| [Manual orbits](manual-orbits.md) | Design, preview, and confirm an Earth-centred orbit. |
| [Visualization](visualization.md) | Configure the appearance of objects, orbits, map and scene. |
| [3D View](three-d-view.md) | Change projection, navigation, camera and local recording. |
| [Timeline](timeline.md) | Work in static, real-time or range simulation mode. |
| [Ephemerides inspector](ephemerides.md) | Inspect provenance, Cartesian states, derived columns, project propagation history, and exports of an orbital series. |
| [Event planner](planner.md) | Inspect passes, validity boundaries, and manual events in day, week, or month views. |
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

!!! warning "Local-persistence limits"

    Orbit now includes local accounts, an encrypted vault, and a per-user
    project library. It does not include collaboration, remote storage, or
    active calendar synchronization: linkage and a sync preference make no
    transfer until an explicit adapter exists. Do not use local persistence as
    a substitute for a mission document-control system.

Use the [quick start](../getting-started/quick-start.md) to start a
new session.

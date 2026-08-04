# Quick start

[Start](../index.md) · [Installation](installation.md) · [Requirements](requirements.md)

This procedure creates a local project, checks in a catalog object, and
prepare a visual session. It does not configure precision EOP products or publish
data outside the local computer.

## Operational sequence

~~~mermaid
flowchart LR
    A[Iniciar Orbit] --> B[Crear proyecto]
    B --> C[Buscar o importar catálogo]
    C --> D[Activar una capa]
    D --> E[Inspeccionar en 3D]
    E --> F[Guardar o exportar proyecto]
~~~

1. Start Orbit by following [Installation](installation.md) and open the local URL.
2. In the project welcome, select **New Project** and assign a
   name. The project begins empty and the Earth remains as a body of
   permanent reference.
3. Open the catalog, find an object, and add it to the workspace. The
   Standard catalog source is TLE, which is propagated with SGP4.
4. Use the layer tree to show, hide, organize, or select the
   object. See [Layers](../user-guide/layers.md).
5. Adjust the camera and visual options from the workspace. The
   view and its limits are documented in [3D View](../user-guide/three-d-view.md).
6. Save the project document or download a JSON copy from the
   project actions.

## Choose temporary mode

The temporary selector offers three modes:

| Mode | Behavior |
| --- | --- |
| Static | Keeps the working time fixed. |
| Real-time | Follow the wall clock while it is playing; can be paused. |
| Simulated | Uses a range defined by start, end, speed and timeline cursor. |

The full simulation bar is only displayed in **Simulated**. in time
real slow the last sampled epoch is preserved. The use of the bar,
OEM speeds and restrictions described in
[Timeline](../user-guide/timeline.md).

## Save the result

The project document is a JSON in orbit-project, version 1 format.
Save name, active catalog layers, manual orbits
authorized, celestial bodies, folders, ground and state stations
temporary. See [Projects](../user-guide/projects.md).

!!! warning "Local OEM trajectories"

    Locally loaded OEM samples are not reliably restored when
    reopen a project. Keep the original OEM along with the project JSON and
    Recharge it when necessary.

## Upcoming operations

- [Workspace](../user-guide/workspace.md) for panels, selection and
  project actions.
- [Import data](../user-guide/import.md) for TLE, OMM and limitations
  OEM.
- [Export data](../user-guide/export.md) for documents, items and
  anniversaries.
- [Ground Stations](../user-guide/ground-stations.md) to create a
  station and review sampled visibility.
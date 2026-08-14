# Projects

[Home](../index.md) · [User Guide](index.md) · [Workspace](workspace.md) · [Import](import.md) · [Export](export.md)

An Orbit project is a local JSON document. It represents the composition of the
workspace, not a remote catalog or a multi-user session.

## Life cycle

~~~mermaid
flowchart LR
    N[Nuevo proyecto] --> W[Espacio de trabajo]
    O[Abrir JSON Orbit] --> W
    W --> S[Guardar en el archivo elegido]
    W --> E[Descargar copia JSON]
    E --> A[Archivo de proyecto]
~~~

Project actions are found in the project control and its menu
contextual:

| Action | Result |
| --- | --- |
| New project | Clear the user layers and create an empty named document. |
| Import project | Open an Orbit project JSON file. If there is another open project, ask for confirmation before replacing it. |
| Save project | Writes to the chosen file when the browser provides write access. |
| Export project | Downloads a separate JSON copy of the opened file. |

When the browser does not support the modern file picker, Orbit uses
a reading file selector and allows downloading the export. The
Ability to directly overwrite a file depends on the File API
of the browser.

## Startup readiness gate

Immediately after Orbit starts, **New project** and **Open/Import project** can
be disabled while the service validates critical local time and gravity data.
This is intentional: replacing or restoring a project before that contract is
ready could make its manual-orbit and force settings appear usable when they
are not. The controls become available only when the startup diagnostics publish
`projectReady: true` (normally `readiness.state: ready`, or
`degraded-ready` with an explicit visible warning); a responsive gateway or a
generic `healthy` indicator is not sufficient.

Use the compact **Startup status** panel to see the active step and any NGA
download percentage. A first run without a valid cache can take longer because
it downloads and validates gravity data. A later run normally validates the
persistent cache locally and finishes sooner. If the percentage is not known,
the panel shows indeterminate progress rather than a made-up value. You may
continue to inspect the scene and Built-In Test while waiting, but should not
try to bypass a displayed blocker.

## Document contract

The current version of the document declares format orbit-project and version 1.
Preserves serializable data, not Cesium live objects or Cesium subscriptions.
network.

| Field | Preserved content |
| --- | --- |
| name | Display name of the project. |
| satellites | Identifiers for active catalog layers. |
| manualOrbits | Manual orbit definitions to regenerate them when opening. |
| heavenlyBodies | Optional Sun and Moon layers, including their visibility. |
| layerNames and layerTree | Presentation names, folders and layer membership. |
| groundStations | Ground station parameters. |
| simulation | Mode, range, current era, playback and speed. |

## Restoration

When you open a document, Orbit first restores the name, catalog layers
and the temporary state; then restores bodies, manual orbits, stations and
layer tree. A manual orbit that is invalid or whose propagator does not
is available does not prevent opening the rest of the document: the application informs
of incomplete restoration.

!!! warning "Data not restorable"

    A locally loaded tabulated OEM trajectory is not preserved permanently.
    reliable within the project. Archive the source OEM along with the JSON and re-enter
    import it when work reopens.

## Good practices

1. Export a copy before replacing an open project.
2. Keep the JSON, local OEMs, and input files together that
   justify the layers of the catalog.
3. Use stable folder and layer names before sharing the file with
   another operator.
4. Check the saved mode and temporal epoch before comparing a view
   reproduced with a previous session.

The visual structure of the document is managed in [Layers](layers.md); the
The content of the formats is incorporated using [Import](import.md).

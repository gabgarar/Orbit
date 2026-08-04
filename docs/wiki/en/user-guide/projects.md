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
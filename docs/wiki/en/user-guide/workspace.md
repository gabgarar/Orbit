# Workspace

[Home](../index.md) · [User Guide](index.md) · [Projects](projects.md) · [Layers](layers.md) · [3D View](three-d-view.md)

The workspace brings together the Cesium viewer, the layers sidebar, the
object panels and temporary controls. The project tree is
session organization reference; It is not a mission catalog nor a
remote database.

## Components

| Area | Responsibility |
| --- | --- |
| Vertical Sidebar | Access to layer panels, camera and session recording. |
| Layers Panel | Project, folders, layers, bodies and their contextual actions. |
| Central area | 3D orbital viewer, selection and representation of active layers. |
| Object panels | Information, propagated parameters and actions specific to the selected element. |
| Layers panel footer | Visible UTC date and time and temporary mode selector. |
| Simulation bar | Playback and timeline controls, only for a simulated range. |
| Help | The `?` button opens the complete navigable Orbit documentation without leaving the workspace. |

## Work with the tree

The project acts as the root folder. Folders can contain other
folders and layers; The bodies appear in their own section at the end of the
panel. The counter for each folder includes its descendant layers, while
that the body counter belongs to its own section.

One click selects the corresponding layer or element. A right click opens
the item type's context menu. Visibility and deletion actions
are applied to the chosen element; bulk panel operations are reserved
for active user layers.

!!! note "Earth"

    The Earth is the persistent reference body of the workspace.
    It can be hidden from the visibility control, but the operation of
    Generic deletion does not remove it.

## Recommended workflow

1. Create or open a [project](projects.md).
2. Check in objects using the catalog, a manual orbit, or an import
   compatible.
3. Group the layers into folders and confirm their visibility.
4. Select an object to see the applicable controls.
5. Choose temporary mode before comparing positions or passes.
6. Save or export the project.

## Dashboards and status

Closing the layers panel does not delete its contents. Runtime preserves the tree
and can be reopened from the sidebar. The session state is
saved in the project document only when a save action is executed.
save or export.

There is no concurrent editing mode, layer locking, or history
sharing of changes. To audit changes, retain exported versions of the
Project JSON outside of Orbit.

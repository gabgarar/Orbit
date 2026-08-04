# Layers and folders

[Home](../index.md) · [User Guide](index.md) · [Workspace](workspace.md) · [Projects](projects.md) · [Display](visualization.md)

Layers represent the active visual objects in the workspace. The
tree supports nested folders and saves only presentation structure:
a folder does not modify the propagator or source data of a layer.

## Operations available

| Element | Organization operations | Visual operations |
| --- | --- | --- |
| Root project | New, open, save and export project using menu or project control | Expand or collapse the tree. |
| Folder | Create child folder, rename, move, collapse or delete using applicable actions | Show or hide the layers it represents. |
| Layer | Move between folders, rename when layer allows and delete | Select, show or hide; The menu adds actions of its type. |
| Bodies | Sun and Moon are optional layers; Earth is persistent | Show or hide. |

The tree keeps empty folders out of a search filter so they can
used as structure or drag destinations. During a search,
the matching folders, their ancestors, and the parents of matching layers.

## Deleting folders

Deleting a folder **does not delete its operational contents**. Its direct layers
and child folders are returned to the project root; the deepest branches
They are kept under the relocated child folder. This rule prevents an action
organization delete objects from the workspace.

!!! warning "Delete a layer"

    Deleting a layer does remove it from the current workspace. If your
    definition comes from a local or OEM file, preserve the source before
    delete it. The tree does not replace a backup copy of the project.

## Visibility

Visibility controls the representation in the viewer. Hide a layer
changes its catalog data, the status of a station, or the parameters of
a manual orbit. Global show/hide controls are enabled
when active user layers exist; The Earth does not count as a layer of
mission for that condition.

## Search and counters

Dashboard search supports matching options such as uppercase,
whole word and regular expression. Folder counters include
layers located in all its descendants. This convention allows us to know the
scope of a branch even if it is collapsed.

## Relationship to the project

Folder structure, display names, and relationships
parent-child are included in a [Project](projects.md) export. The
objects are maintained by their identifier and origin; move them from folder no
duplicates the object or creates a new propagation.
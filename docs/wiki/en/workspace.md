# Workspace and visualisation

## Overview

The workspace manages projects, layers, bodies, camera and timeline. It presents orbital results without redefining their source frame or dynamics.

## Projects and layers

A project is the root folder. Folders organise objects, keep their body count and expose visibility, delete and context-menu actions. Bodies remain separate at the bottom of the tree; Earth and Moon are display bodies, not imported orbital layers.

## Time

| Mode | Behaviour |
| --- | --- |
| Static | Keeps selected epoch. |
| Real time | Follows current UTC. |
| Simulated | Advances, pauses, seeks and scales a selected epoch. |

Simulation bar appears only in simulated mode. UI labels do not alter source time scale stored by a state.

## 3D view

Cesium renders Earth, bodies, layers, tracks and camera. Recording is a UI feature, not an ephemeris export or scientific product.

## Limits

- WebGL is required for 3D view.
- Viewer may use labelled visual EOP; strict analysis/export requires pinned data.
- No shared project or realtime collaboration.

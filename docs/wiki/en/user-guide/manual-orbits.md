# Manual orbits

[Home](../index.md) · [User Guide](index.md) · [Propagation](../propagation/index.md) · [Workspace](workspace.md)

## Overview

The **Create manual orbit** button opens an isolated design mode for defining
and previewing an Earth-centred orbit. Earth is the current workflow's fixed
central body: there is no body selector and Orbit cannot yet design a manual
orbit around the Moon, Sun, or another object.

## Design scene

On entry, Orbit saves the visual state of existing layers and hides them
temporarily. The **Layers** panel and button disappear as well, so the form and
3D view do not compete with the project tree. Earth is always shown as the
visual design reference, even if it was hidden before the editor opened.

The **Overview** tab explicitly identifies the central body as **Earth /
WGS-84**. Opening the editor resets the camera to Cesium's Earth Home view;
cancelling also restores the workspace's previous camera view.

On cancellation or confirmation, Orbit restores exactly the visibility that
layers and Earth had before entry. Design mode does not delete layers or modify
the project until creation is confirmed.

## What is defined

1. Orbit name and metadata.
2. UTC preview interval.
3. Keplerian elements or initial Cartesian state.
4. Propagator: two-body, synthetic SGP4, or Cowell/RK4.
5. Cowell force terms when applicable.

The preview is drawn around Earth and is not yet a project layer. On
confirmation, Orbit creates the manual orbit and it reappears in **Layers**.

## Important limits

- All current manual orbits are centred on `EARTH`.
- Two-body and Cowell produce native `EME2000` states; SGP4 produces `TEME`.
  See [Propagators](../propagation/overview.md).
- Design mode temporarily switches to a paused simulation range. Its own time
  controls avoid confusing design with the normal workspace clock.
- Hiding Layers in this mode is an interface choice, not data removal or a
  permanent layer deactivation.

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
3. Keplerian elements or an initial Cartesian state in `EME2000`.
4. Physical propagator: two-body or Cowell/RK4.
5. Cowell force terms when applicable.

The preview is drawn around Earth and is not yet a project layer. On
confirmation, Orbit creates the manual orbit and it reappears in **Layers**.

## TIME: design window, preview, and ERP

The **TIME** tab separates three decisions which must not be conflated:

| Control | Function |
| --- | --- |
| **Design window** | UTC interval propagated and saved with the manual orbit. |
| **Orbit preview frame** | View of the same ephemeris in `EME2000` or through its terrestrial route; it does not change integration. |
| **Manual ERP** | Local Earth-orientation file and UTC coverage for Earth-bound forces. |

When a valid ERP is attached, the window is initially set to the file's
coverage start and end. If **Full geopotential** or **Atmospheric drag** is
enabled, preview and creation cannot run outside that coverage. An
inertial-force-only orbit may omit ERP, but that does not thereby obtain a
rigorous terrestrial transformation.

If the project already contains SP3, OEM, or a simulation range, it is not
mixing clocks: all instants are UTC. However, comparing or analysing multiple
layers must use the overlap shown by TIME. If there is no overlap, the manual
orbit remains valid in its own interval, but no valid joint operation exists
with those finite ephemerides. See [Time, EOP and ITRF](../operations/time-eop.md)
for the complete contract.

## Preview frames

The manual definition and its physical propagation use the `EME2000` inertial
frame. The view provides two explicit ways to inspect the same ephemeris:

- **EME2000 — inertial trajectory** shows the trajectory produced by the
  propagator.
- **ITRF — Earth-fixed path** shows that ephemeris after transformation into
  the Earth-fixed frame. It is the view used for 2D projection and the trace
  on the globe.

Switching to ITRF does not propagate the orbit again or change its forces; it
is a subsequent transformation of the state calculated in EME2000. The
interface does not use the generic `ECI` or `ECEF` labels: the visible name
always identifies the frame being displayed.

## SGP4 and synthetic TLEs

SGP4 is not a selectable propagator for a manual orbit. It is reserved for a
catalogue TLE, whose native states are `TEME`. A manual state or manual
elements in EME2000 cannot be converted into a TLE with a simple frame
rotation.

In the future, Orbit may provide **Export/Fit synthetic TLE** as an explicit
operation: it will start from a reference manual ephemeris, transform it to
TEME, and fit an SGP4/TLE model over an interval. The product will need to
declare the interval, samples, residuals, and provenance. This is not part of
current manual propagation.

## AOS/LOS tables

After confirming the layer, you can select it in
[Ground Stations](ground-stations.md) to calculate its passes against a
station. The table uses the authored manual definition —epoch, state or
elements, propagator, and force options— and the UTC design interval saved
when it was propagated. To change the interval, edit and propagate the orbit
again; this prevents the elevation profile from querying states outside the
designed ephemeris.

Dynamics are solved in `EME2000`, and each position is transformed to `ITRF`
before the station's WGS-84/ENU geometry. The pass response declares `ITRF`
and UTC, but it neither creates a catalogue entry nor converts the layer into
a TLE: the manual name only labels the result.

## Important limits

- All current manual orbits are centred on `EARTH`.
- Manual input and dynamics remain in `EME2000`; an Earth-fixed view or
  ephemeris is obtained afterwards in `ITRF`. SGP4 produces `TEME` only for
  catalogue TLE sources. See [Propagators](../propagation/overview.md).
- Design mode temporarily switches to a paused simulation range. Its own time
  controls avoid confusing design with the normal workspace clock.
- Hiding Layers in this mode is an interface choice, not data removal or a
  permanent layer deactivation.

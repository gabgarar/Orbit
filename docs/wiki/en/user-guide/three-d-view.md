# 3D view and camera

[Home](../index.md) · [User Guide](index.md) · [Display](visualization.md) · [Workspace](workspace.md) · [Timeline](timeline.md)

The orbital display is built on Cesium. Represents the active layers in
the time selected by the time control and offers projections and viewing modes.
explicit navigation.

## Projections

The camera menu allows you to select the following projections:

| Option | Usage |
| --- | --- |
| 3D View | Three-dimensional view of the globe and orbital layers. |
| 2D View | Two-dimensional projection of Cesium. |
| Columbus | Oblique view of Cesium. |
| Reset view | Retrieves the view defined by the runtime. |

Transitions between projections are animated by Cesium. change
projection alters the navigation and appearance of the scene, not the frame,
time scale or layer data.

### Orbits in 2D view

In **2D View**, Orbit does not draw the elevated spatial trajectory. The
**Show future** option becomes the trajectory projected onto Earth from the
ephemeris ITRF/ECEF samples. The map line therefore preserves Earth-relative
motion; it is not an ECI ellipse flattened by the viewer.

In 2D, **Ground Track** controls the satellite's geometric visibility circle.
When enabled, Orbit draws the zero-elevation horizon around the sub-satellite
point. When disabled, the reprojected trajectory may remain visible, but that
circle is not shown. The footprint is not a station mask, a radio link, or a
sensor-coverage calculation.

In 3D View and Columbus, **Show future** restores the spatial trajectory;
Ground Track continues to show or hide the surface trace and footprint. The
same rule applies to the manual-orbit editor: even when a design is inspected
in ECI, its 2D projection uses the propagated ITRF samples.

## Navigation

| Mode | Behavior |
| --- | --- |
| Camera centered | Preserves the navigation model centered on the reference body. |
| Free camera | Enables free navigation of the viewer. |

Selecting a body can activate a camera centered on its position
translational. This camera maintains local interaction without inferring a
additional physical orientation of the body.

## Selection and monitoring

Clicking on an entity in the viewer can select it and synchronize its
controls with the side panel. Selection is an interface interaction:
does not imply that the object is determined, filtered or followed by a
ground station.

Use [Timeline](timeline.md) to set the epoch before interpreting
the selected position. In real time, an object can change while it is
See if playback is still active.

## Local recording

The record button in the sidebar starts or stops a capture of the
canvas session in the browser. Configuration offers quality and format
requested output.

!!! warning "Recording limits"

    Recording depends on MediaRecorder and the codecs that the browser
    exposes. Orbit does not incorporate server-side video rendering,
    encryption or remote storage. Check the generated file in
    the target browser before using it in an operational flow.

## Best Practices

1. Adjust the projection before capturing or comparing a scene.
2. Freeze the epoch in Static or pause Real time for visual inspection.
3. Do not use camera or recording as a data export mechanism;
   use [Export](export.md) for items and ephemeris.
4. Keep viewing enabled only for layers relevant to
   reduce noise and graphic cost.

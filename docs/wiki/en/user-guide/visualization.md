# Display

[Home](../index.md) · [User Guide](index.md) · [3D View](three-d-view.md) · [Layers](layers.md) · [Settings](../operations/configuration.md)

The Orbit display is configured from the settings panel and is
applies to the Cesium viewer and active layers. These settings determine the
presentation; they do not change the orbital source or convert the reference frame
of the data.

## Scene options

| Group | Available settings |
| --- | --- |
| Orbits | Visual propagation horizon, future line, ground track, width and colors. |
| Satellites | Label size, model scale, 3D model usage, size mode, and perigee alert threshold. |
| Rendering | Antialiasing, background color, atmosphere, globe lighting, stars and basemap. |
| Recording | Quality and output format requested by local recording. |
| Interface and logs | Language, theme, log level and top clock. |

Available basemaps are Natural Earth local, Earth 2 km local when
its tiles, OpenStreetMap and Esri's World Imagery, have been generated. both
The latter depend on the corresponding remote map service.

## Objects and traces

The visualization can show catalog objects propagated with SGP4, orbits
manuals, ground stations and celestial bodies. The origin remains
part of the contract: a TLE is natively propagated in TEME, while a
analytical manual orbit or Cowell uses his own model. A similar appearance
on the screen it does not make those results equivalent.

The Sun and Moon layers are optional. The Earth remains a body of
Reference and lighting, atmosphere, or basemap options apply to
the scene, not the scientific document of an orbit.

## Render quality

Orbit supports off, FXAA and MSAA antialiasing modes. When selected
antialiasing, the runtime preserves a full resolution scale for
preserve fine lines; without antialiasing you can apply adaptive reduction
resolution in small viewports.

!!! warning "Analytical use"

    The viewer is an inspection tool. Do not use the thickness of a trace,
    the color, projection or density of the heat map as evidence of
    orbital precision, link availability or statistical uncertainty.

## Local maps Earth 2 km

Local tiles can be generated from the server folder:

~~~powershell
npm run tiles:earth2km
~~~

The process creates a pyramid under front/assets/earth2km_tiles/. If it does not exist
the initial tile, Orbit retains its base local map. Generation increases
disk usage and setup time.

Navigation and projections are described in [3D View](three-d-view.md); the
Saving these settings is explained in [Settings](../operations/configuration.md).
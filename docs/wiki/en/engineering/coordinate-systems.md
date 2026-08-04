# Coordinate systems

[Home](../index.md) · [Engineering](index.md) · [Cartesian states](cartesian-states.md) · [Reference frames](reference-frames.md)

## Scope implemented

Orbit uses three-dimensional Cartesian coordinates for orbital states.
The axes and the origin are defined by the declared reference frame, not by
the word "coordinates." The center of transformable states is the Earth.

| Type | State | Convention |
| --- | --- | --- |
| Geocentric Cartesian | Available | \((x,y,z)\) in m; \((v_x,v_y,v_z)\) in m/s. |
| Cartesian internal work of propagators | Available | km and km/s only within the engines; becomes the border. |
| Geodetic WGS-84 | Partial and internal | Only used to estimate height in Cowell's drag. |
| Topocentric ENU/NED | Not available as orbital contract | There is no state transformer or general output format. |
| RSW/RTN/TNW | Not available | They are rejected as local OEM covariance frames. |

## Axes and origin

The meaning of the axes depends on the framework. For example, `TEME` is not
interchangeable with `GCRF`, and `ITRF` is not equivalent to a generic tag
"Earth-fixed." See the route table at
[Reference frames](reference-frames.md).

`StateVector.center` is normalized to upper case. The built-in transformer
rejects frame changes for centers other than `EARTH`; does not perform
barycentric or planetocentric translations.

## Altitude used by Cowell

When drag is enabled, Cowell estimates geodetic height using the
WGS-84 ellipsoid and use that height to select a layer of the atmosphere
exponential. This operation does not convert the native `EME2000` state to a
complete Earth state nor does it implement a geodetic API.

## Units

| Border | Position | Speed ​​| Acceleration |
| --- | --- | --- | --- |
| `StateVector` | m | m/s | m/s² |
| SGP4 and internal classic elements | km | km/s | — |
| Text OEM | km | km/s | km/s² when the version allows acceleration |
| Text SP3 | km | dm/s in registers `V` | — |

!!! note "Unit conversion is not frame transformation"

    Going from km to m preserves the coordinates. Going from TEME to ITRF requires a
    time-dependent transformation and EOP.
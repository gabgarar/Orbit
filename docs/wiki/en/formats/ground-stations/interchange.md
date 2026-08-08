# External interchange: GeoJSON

[Home](../../index.md) · [Ground-station formats](index.md) · [Ground stations](../../user-guide/ground-stations.md) · [Project JSON](project-json.md)

## Overview

Orbit exports workspace ground stations as an **RFC 7946 GeoJSON** file. It is a
configuration export: it retains position, identity, and authored parameters so
they can be inspected or reused in geospatial tools. It does not export pass
results, coverage meshes, derived RF values, or renderer state.

GeoJSON is the recommended initial interchange format because it is one UTF-8
file, native to the web ecosystem, and read directly by QGIS, GDAL, PostGIS, and
many mapping APIs. It is a better fit here than Shapefile: Shapefile needs
coordinated sidecar files (<code>.shp</code>, <code>.shx</code>,
<code>.dbf</code>, ...), restricts field names, and does not represent
structured RF configuration or Unicode text well. Orbit does not change geometry
or datum merely to fit a legacy format.

!!! info "Interchange, not a project copy"

    Use GeoJSON to share and inspect stations. To reopen the workspace with
    folders, layers, visualisation, and other Orbit state, use
    [Project JSON](project-json.md). GeoJSON station import is not implemented
    yet.

## Exporting stations

Use **Export GeoJSON** on a station to download that layer, or the equivalent
project action to download every workspace ground station. The result is a
<code>FeatureCollection</code>.

Export is made from the station's authored contract. It does not depend on the
active instant, a selected satellite, or a prior AOS/LOS request. This makes it
safe to share configuration without turning a planning envelope into an
availability or SNR claim.

## Geometry and reference system

Each station is written as a <code>Feature</code> with <code>Point</code>
geometry:

~~~json
{
  "type": "Point",
  "coordinates": [-3.70379, 40.41678, 667.0]
}
~~~

The order is always **<code>[longitude, latitude, altitude_m]</code>**, never
latitude-longitude. The first two components are WGS-84 geographic coordinates
in degrees. The third is the WGS-84 ellipsoidal height in metres used by the
Orbit station.

RFC 7946 fixes GeoJSON to WGS-84. Orbit therefore does not add the obsolete
<code>crs</code> member used by older GeoJSON dialects. An application needing
orthometric height must convert it with a known geoid; it must not silently
interpret <code>altitude_m</code> as height above mean sea level.

## Collection schema

The root is a <code>FeatureCollection</code>. <code>Feature.id</code> and
<code>properties.station_id</code> identify the same layer. Properties QGIS is
likely to need as columns are flat; complete RF and visual configuration are
retained in namespaced objects.

~~~json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": "ground-station:1",
      "geometry": {
        "type": "Point",
        "coordinates": [-3.70379, 40.41678, 667.0]
      },
      "properties": {
        "station_id": "ground-station:1",
        "name": "Madrid Station",
        "altitude_m": 667.0,
        "time_zone": "Europe/Madrid",
        "min_elevation_deg": 10.0,
        "frequency_mhz": 2200.0,
        "polarization": "RHCP",
        "operation_mode": "tracking",
        "station_schema_version": 2,
        "orbit:rf": {
          "antenna_diameter_m": 2.4,
          "antenna_efficiency": 0.62,
          "tx_power_dbm": 38.0,
          "receiver_bandwidth_hz": 1000000
        },
        "orbit:visual": {
          "coverage_visible": true,
          "point_color": "#3cc4ff"
        },
        "monitor_satellite_ids": []
      }
    }
  ]
}
~~~

### Flat properties

| Property | Type | Meaning |
| --- | --- | --- |
| <code>station_id</code> | string | Persistent layer identifier; matches <code>Feature.id</code>. |
| <code>name</code> | string | Station display name. |
| <code>altitude_m</code> | number | WGS-84 ellipsoidal height in metres; repeated for easy tabular queries. |
| <code>time_zone</code> | string | IANA presentation zone, such as <code>Europe/Madrid</code>; it does not alter physical UTC calculations. |
| <code>min_elevation_deg</code> | number | Operational elevation mask, in degrees. |
| <code>frequency_mhz</code> | number | Normalised physical frequency, in MHz. |
| <code>polarization</code> | string | <code>RHCP</code>, <code>LHCP</code>, or linear according to the Orbit contract. |
| <code>operation_mode</code> | string | <code>tracking</code>, <code>scan</code>, or <code>stationary</code>. |
| <code>station_schema_version</code> | integer | Version of the Orbit station contract. |
| <code>monitor_satellite_ids</code> | array of strings | Identifiers stored by the project; they do not create a mandatory pass association. |

### RF and visual configuration

<code>orbit:rf</code> contains the **authored** RF parameters that must not be
lost during interchange: aperture and efficiency, frequency and unit,
polarisation and tilt, power and unit, gain modes/overrides, pattern, HPBW, side
lobes, RX threshold, system temperature, bandwidth, required SNR, losses,
pointing RMS, boresight, and mechanical limits. Its keys follow
[Project JSON](project-json.md), for example <code>antenna_diameter_m</code>,
<code>tx_power_dbm</code>, <code>pattern_type</code>, or
<code>mechanical_elevation_max_deg</code>.

<code>orbit:visual</code> contains presentation preferences only, such as
symbol, size, colour, and coverage visibility. When present,
<code>monitor_satellite_ids</code> preserves project context, but does not filter
AOS/LOS tables: in Orbit, any compatible satellite can be selected freely for
pass analysis.

The <code>orbit:rf</code> and <code>orbit:visual</code> objects are not GIS
geometries or results. Tools that only accept flat fields can retain them as JSON
or ignore them while still using the point geometry and flat properties.

## Opening the file in QGIS

1. Select **Layer → Add Layer → Add Vector Layer**.
2. Choose the <code>.geojson</code> file exported by Orbit and open it.
3. Check that QGIS reads it as a WGS-84 geographic <code>Point</code> layer.
4. Open the attribute table to inspect <code>name</code>,
   <code>frequency_mhz</code>, <code>min_elevation_deg</code>, and the remaining
   flat fields.

The Z height is retained in the geometry. To view it in a QGIS 3D scene,
configure layer elevation from its Z value; do not treat that display as an RF
visibility model. The pattern mesh, footprint, terrain, refraction, and passes
are not part of the GeoJSON.

## Limits and compatibility

- Export is one-way in the current version: Orbit does not yet import GeoJSON
  ground stations.
- The file describes point stations and configuration, not dynamic satellite
  geometry or calculated coverage.
- It does not export RF range, <code>G/T</code>, SNR, received power, AOS, LOS,
  or results dependent on a remote layer; those are derived values that Orbit
  recalculates.
- Orbit's simplified pattern is not a measured antenna pattern. Its presence in
  <code>orbit:rf</code> does not certify physical station performance.
- The IANA zone is only a local-label preference. Operational instants and
  AOS/LOS must still be exchanged in UTC.

For an integration that needs geodetic-network stations, IGS logs, SINEX, KML,
or orthometric height, explicitly define vertical datum, epoch, units, and
attribute mapping before converting data. Orbit does not infer them from a
column name.

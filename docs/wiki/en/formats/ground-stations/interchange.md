# Ground-station interchange

[Home](../../index.md) · [Ground-station formats](index.md) · [Ground Stations](../../user-guide/ground-stations.md) · [Project JSON](project-json.md)

## Overview

Orbit can export and import ground stations as independent files. Interchange
preserves the WGS-84 position and authored station configuration; it does not
reuse calculation results, Cesium entities, or scene-derived geometry.

| Format | Extension | Use it for | Import and export |
| --- | --- | --- | --- |
| **GeoJSON** | `.geojson` | GIS, QGIS, PostGIS, and mapping APIs. | Yes. |
| **Orbit JSON** | `.json` | A native, versioned copy of stations for reopening in Orbit. | Yes. |
| **CSV** | `.csv` | Reviewing or editing a table in a spreadsheet. | Yes. |
| **KML** | `.kml` | Station points for Google Earth and KML viewers. | Export only. |
| **KMZ** | `.kmz` | Compressed KML for sharing with Google Earth. | Export only. |
| **GeoPackage** | `.gpkg` | Professional Point layer for QGIS, ArcGIS, and technical GIS. | Export only. |
| **WKT** | `.wkt` | Point Z/MultiPoint Z geometry for SQL and PostGIS. | Export only. |
| **WKB** | `.wkb` | Binary Point Z/MultiPoint Z geometry for spatial APIs. | Export only. |

GeoJSON is the recommended choice for geographic interoperability. Orbit JSON
is the native route for preserving the station contract supported by Orbit.
CSV is a convenient tabular profile: it must not be treated as a lossless copy
when an external tool changes types, encoding, or columns.

## Using the interchange selector

To add a file, select **Import** in the **Ground Stations** panel or **Import
stations** from project actions. To download one station, open its **Export**
action; project actions can export every ground station in the workspace. The
dialogue displays GeoJSON, KML, KMZ, GeoPackage, WKT, WKB, Orbit JSON, and
CSV before starting a download.

Import adds layers to the current project. It does not replace the project or
delete existing stations. When a file identifier cannot be used in the current
workspace, Orbit assigns a valid layer identifier without changing the shown
name or station configuration.

!!! info "Import validation"

    The UI accepts files up to **5 MiB**. It validates every GeoJSON feature or
    CSV row separately. Records without a valid position, outside WGS-84
    bounds, or with an incompatible structure are skipped and Orbit reports
    both imported and rejected counts. An unknown format or malformed document
    creates no layers.

## GeoJSON RFC 7946

Each station is a `Feature` with `Point` geometry. Coordinates are always
**`[longitude, latitude, altitude_m]`**: WGS-84 longitude and latitude in
degrees, followed by ellipsoidal height in metres.

~~~json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": "gst:1",
      "geometry": {
        "type": "Point",
        "coordinates": [-3.70379, 40.41678, 667.0]
      },
      "properties": {
        "station_id": "gst:1",
        "name": "Madrid Station",
        "station_schema_version": 2,
        "altitude_m": 667.0,
        "time_zone": "Europe/Madrid",
        "min_elevation_deg": 10.0,
        "frequency_mhz": 2200.0,
        "polarization": "RHCP",
        "operation_mode": "tracking",
        "orbit:rf": {
          "antenna_diameter_m": 2.4,
          "antenna_efficiency": 0.62,
          "tx_power_dbm": 38.0,
          "receiver_bandwidth_hz": 1000000
        },
        "orbit:visual": {
          "coverage_visible": true,
          "visible": true,
          "point_color": "#3cc4ff"
        },
        "monitor_satellite_ids": []
      }
    }
  ]
}
~~~

Flat properties support GIS queries. Complete RF configuration is kept in
`properties["orbit:rf"]`; authored presentation preferences, including layer
visibility, are in `properties["orbit:visual"]`. The importer accepts that
Orbit-exported profile and compatible flat properties, but the `Point` geometry
is the source of position.

The file contains no `crs` member: RFC 7946 fixes GeoJSON to WGS-84. Height is
ellipsoidal, not orthometric height or height above terrain.

### Opening GeoJSON in QGIS

1. Select **Layer → Add Layer → Add Vector Layer**.
2. Open the `.geojson` file exported by Orbit.
3. Verify that QGIS interprets it as a WGS-84 geographic `Point` layer.
4. Inspect flat fields such as `name`, `frequency_mhz`, and
   `min_elevation_deg` in the attribute table.

The Z component remains available to a QGIS 3D scene. That visualisation is
not an RF model or a visibility calculation.

## Orbit JSON

Orbit JSON is a native interchange container for a list of stations. It is
versioned and intended to import the Orbit-supported contract again without
depending on GIS attribute conventions. Orbit identifies the document from its
envelope, so a downloaded `.json` file and a compatible
`.orbit-ground-stations.json` name are both accepted.

~~~json
{
  "format": "orbit-ground-stations",
  "version": 1,
  "stations": [
    {
      "id": "gst:1",
      "name": "Madrid Station",
      "station_schema_version": 2,
      "latitude_deg": 40.41678,
      "longitude_deg": -3.70379,
      "altitude_m": 667.0,
      "time_zone": "Europe/Madrid",
      "min_elevation_deg": 10.0,
      "antenna_diameter_m": 2.4,
      "frequency_mhz": 2200.0,
      "coverage_visible": true
    }
  ]
}
~~~

`format` identifies the container and `version` identifies the interchange
contract, not the application version. Each object in `stations` uses the
station contract described in [Project JSON](project-json.md), without the
folder tree, time mode, other layers, or rendering handles.

## CSV

CSV holds one row per station with stable headers including `station_id`,
`name`, `latitude_deg`, `longitude_deg`, `altitude_m`,
`min_elevation_deg`, and the scalar RF/visual fields known to Orbit.
`monitor_satellite_ids` is written as a JSON array in its cell.

A manually authored CSV must include `latitude_deg` and `longitude_deg`.
Missing fields use station defaults; empty numeric or Boolean cells from the
exported profile represent optional null values. Keep comma separation and
UTF-8 encoding when the file is intended for re-import.

## Additional spatial exports

The **Export stations** dialog shows a yellow contextual card whenever the
format changes. It explains the destination and retained information before a
download begins. Stations are always represented as WGS-84 points: they are
not orbits, ground tracks, TLEs, OEMs, or ephemerides.

| Format | Geometry | Attributes | Use and boundary |
| --- | --- | --- | --- |
| KML / KMZ | `Point` with authored height. | KML keeps a readable station summary. | Open in Google Earth. KMZ contains the same compressed KML. |
| GeoPackage | `Point Z` in EPSG:4979. | Name, feature kind, and authored properties as JSON. | A real SQLite/GPKG product generated by the local service for professional GIS. |
| WKT / WKB | `Point Z` for one station, `MultiPoint Z` for several. | None: geometry only. | Insert into SQL, PostGIS, or a spatial API; use GeoJSON or Orbit JSON for the complete RF contract. |

KML, KMZ, GeoPackage, WKT, and WKB are export products and cannot yet be
imported back into Orbit. Re-import is supported only for **GeoJSON**,
**Orbit JSON**, and **CSV**. GeoJSON and Orbit JSON are the preferred choices
when RF parameters, elevation mask, mechanical limits, or visual preferences
must survive the interchange.

!!! warning "Orbit does not fabricate orbital data"

    A ground station is a fixed WGS-84 point. Orbit does not offer TLE or OEM
    exports for stations, and it does not add a trajectory, derived coverage,
    Cesium mesh, AOS/LOS result, or link data to these files.

## Data recalculated by Orbit

None of the formats exports or accepts as a source of truth:

- 2D/3D meshes, footprint, discrete pattern, or viewer entities;
- derived RF range, `G/T`, aggregate losses, SNR, or received power;
- elevation samples, AOS, LOS, pass tables, or an API response;
- a mandatory association between a station and a satellite;
- folders, other layers, selection, camera, or project time mode.

After import, Orbit recalculates RF models, coverage, and AOS/LOS results using
the currently selected instant, satellite, and configuration.

## Compatibility

All station interchange formats represent WGS-84 point stations. When an external system
uses another datum, orthometric height, geodetic epoch, or units, convert and
document that information before import. Orbit does not infer vertical datum,
time zone, or RF semantics from a column name.

Use [Project JSON](project-json.md), not a station-interchange file, to restore
the complete workspace including its layer tree and project state.

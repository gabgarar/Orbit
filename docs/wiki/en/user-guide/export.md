# Export data

[Home](../index.md) · [User Guide](index.md) · [Projects](projects.md) · [Import](import.md) · [Time and EOP Operation](../operations/time-eop.md)

Orbit distinguishes between a project copy, the reduced product it can derive
from a catalog entry, and an ephemeris calculated over an interval. An export
does not turn the runtime into a complete implementation of every CCSDS profile
or reconstruct an input file that Orbit does not retain.

## Export a project

**Export project** downloads a standalone `orbit-project` JSON file rather than
the open file itself. It includes the serializable state described in
[Projects](projects.md). Use it to move the workspace composition; do not
assume that it contains tabulated local OEMs or transient viewer results.

## Export ground stations

The station picker provides GeoJSON, KML, KMZ, GeoPackage, WKT, WKB, Orbit
JSON, and CSV. A station is a fixed WGS-84 point, so none of these products
creates a TLE, OEM, ephemeris, ground track, calculated coverage, or AOS/LOS
result.

| Format | Use | Downloaded file |
| --- | --- | --- |
| GeoJSON | GIS interchange with WGS-84 points and RF/visual properties. | `.geojson` |
| KML | Station points with authored height for Google Earth. | `.kml` |
| KMZ | Compressed KML for sharing with Google Earth. | `.kmz` |
| GeoPackage | SQLite/GPKG Point Z layer in EPSG:4979 for professional GIS. | `.gpkg` |
| WKT / WKB | Point Z geometry for spatial databases and APIs. | `.wkt` / `.wkb` |
| Orbit JSON | Versioned native copy for importing the station back into Orbit. | `.json` |
| CSV | Editable table with scalar station fields. | `.csv` |

KML, KMZ, GeoPackage, WKT, and WKB are export-only products. Re-import is
available through GeoJSON, Orbit JSON, and CSV. Export is built from the
authored contract, not from the active instant or an AOS/LOS analysis: it
contains no Cesium entities, coverage meshes, RF caches, SNR, derived ranges,
or workspace tree.

See [Ground-station interchange](../formats/ground-stations/interchange.md)
for the schema, preserved fields, and import limits.

## Export a catalog item

The dialog presents products compatible with the layer provenance. Only a real
TLE retains its two original lines; all other catalog products are explicitly
identified as derived products.

| Provenance | Shown product | Contract |
| --- | --- | --- |
| TLE | **TLE** | Downloads the two imported TLE lines. It does not recalculate elements or fabricate a TLE from a state vector. |
| OMM | **OMM JSON/XML derived from the catalog entry** | A normalized, reduced profile containing the fields Orbit retains. It is not a byte-for-byte copy of the uploaded OMM and does not guarantee every CCSDS field or extension. |
| OEM | **OEM profile derived from the catalog entry** | The UI keeps this disabled: Orbit does not currently retain the samples, frame, time scale, and metadata required to re-export a usable OEM. Preserve the source OEM outside Orbit. |
| Manual | **Synthetic TLE** | Shown as a limit, but disabled. It would require fitting SGP4 to the manual trajectory and publishing residuals and quality criteria. |

!!! warning "A derived product is not the source file"

    OMM and OEM products derived from a catalog entry must not be represented as
    a recovered copy of the received file. Orbit does not retain arbitrary raw
    documents or their full profiles. Keep the source file when traceability or
    interchange fidelity matters.

## Export ephemerides and tracks

A sampled export accepts a start, end, and interval in seconds. For TLE and OMM
catalog layers, Orbit uses SGP4; for a manual orbit, it uses the same
propagator, integrator, and force model selected in the designer. An OEM catalog
entry is not silently reprocessed by SGP4: its sampled products remain disabled
until an OEM sample adapter can preserve a verifiable frame and time scale.

| Format | Content | Use |
| --- | --- | --- |
| CSV | Cartesian samples, epoch, frame, time scale, provenance, and propagator. | Spreadsheets and numerical analysis. |
| JSON | Orbit's structured ephemeris response. | Consumers of the Orbit contract. |
| CCSDS OEM | A sampled ephemeris with a simplified OEM header. | Interchange of generated samples; not a high-fidelity source OEM. |
| GeoJSON | 2D longitude/latitude ground track. | Web viewers and 2D GIS. |
| KML / KMZ | 3D sampled trajectory with altitude per sample. | Google Earth and KML viewers. |
| GeoPackage | LineString Z with provenance, propagator, and interval attributes. | QGIS, ArcGIS, and technical GIS. |
| WKT / WKB | 2D terrestrial geometry for SQL, PostGIS, and spatial APIs. | Databases and spatial services. |

The interface initializes a one-day range and a ten-second step. Adjust both
values to the arc and resolution you need, within the limits accepted by the
backend.

### Segments at the anti-meridian

A track that goes from `+180°` to `-180°` is not exported as a fictitious
straight line through the opposite side of the map. Orbit splits it into
`LineString` segments at the anti-meridian. The split point is an interpolated
interchange boundary for display; it is not a propagated sample and does not
invent an epoch or new dynamics.

| Format | Result when a crossing occurs |
| --- | --- |
| GeoJSON | A `FeatureCollection` with one 2D longitude/latitude `LineString` per segment. |
| KML / KMZ | One `Placemark` and `LineString` per segment, with ellipsoidal height per sample. |
| GeoPackage | One `LineString Z` feature per segment in EPSG:4979. |
| WKT / WKB | A `GEOMETRYCOLLECTION` / `GeometryCollection` of 2D `LineString` objects, without an artificial map crossing. |

KML uses `altitudeMode=absolute` and GeoPackage uses WGS-84 ellipsoidal height.
Google Earth can show a visual difference relative to its vertical datum or
geoid; do not interpret that difference as a change to the propagated track.
The current orbital GeoJSON, WKT, and WKB geometries intentionally omit
altitude.

## Ephemeris OEM contract

Sampled OEM products use kilometres and kilometres per second. The backend
requires the points in one export to declare compatible frame and time-scale
values; it does not silently combine points from different frames or scales.

!!! warning "Standards coverage"

    Orbit's OMM, OCM, and OEM outputs must not be interpreted as complete
    implementations of each CCSDS profile. Review fields, comments, frame, and
    time scale before giving an export to another system.

## Reproducibility

For a precision ephemeris, record alongside the exported file:

1. The TLE, OEM, or other source that originated the layer, plus its original file when retained outside Orbit.
2. The requested range, step, and propagator.
3. The frame and time scale declared by the output.
4. The EOP snapshot and leap-second table used by the backend.

The final item is essential whenever the output requires terrestrial reduction.
See [Time and EOP operation](../operations/time-eop.md).

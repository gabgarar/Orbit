"""Small, dependency-free geospatial serializers used by product exports.

The module deliberately owns the *interchange geometry* only.  Callers are
responsible for choosing a physically meaningful coordinate source.  Orbit
uses it for terrestrial orbital samples (ITRF -> WGS-84) and ground-station
features; it does not silently relabel an inertial state as longitude and
latitude.
"""

from __future__ import annotations

import io
import json
import math
import sqlite3
import struct
import zipfile
from collections.abc import Iterable, Mapping, Sequence
from datetime import UTC, datetime
from xml.sax.saxutils import escape as xml_escape


WGS84_SEMI_MAJOR_AXIS_M = 6_378_137.0
WGS84_FLATTENING = 1.0 / 298.257223563
WGS84_ECCENTRICITY_SQUARED = WGS84_FLATTENING * (2.0 - WGS84_FLATTENING)

GEOSPATIAL_EXPORT_FORMATS = frozenset({"geojson", "kml", "kmz", "gpkg", "wkt", "wkb"})

_FORMAT_METADATA = {
    "geojson": ("geojson", "application/geo+json; charset=utf-8"),
    "kml": ("kml", "application/vnd.google-earth.kml+xml; charset=utf-8"),
    "kmz": ("kmz", "application/vnd.google-earth.kmz"),
    "gpkg": ("gpkg", "application/geopackage+sqlite3"),
    "wkt": ("wkt", "text/plain; charset=utf-8"),
    "wkb": ("wkb", "application/vnd.ogc.wkb"),
}

_GEOMETRY_TYPE_CODES = {"POINT": 1, "LINESTRING": 2, "GEOMETRYCOLLECTION": 7}


class GeospatialExportError(ValueError):
    """Raised when an export would create an invalid spatial product."""


def geospatial_extension(format_name: str) -> str:
    """Return the canonical filename extension for a supported format."""

    return _format_metadata(format_name)[0]


def geospatial_content_type(format_name: str) -> str:
    """Return the HTTP content type for a supported format."""

    return _format_metadata(format_name)[1]


def _format_metadata(format_name: str) -> tuple[str, str]:
    format_key = str(format_name or "").strip().lower()
    try:
        return _FORMAT_METADATA[format_key]
    except KeyError as exc:
        supported = ", ".join(sorted(GEOSPATIAL_EXPORT_FORMATS))
        raise GeospatialExportError(f"Formato geoespacial no admitido: {format_name!r}. Usa {supported}.") from exc


def itrf_position_to_wgs84(position: Mapping[str, object]) -> tuple[float, float, float]:
    """Convert an Earth-fixed Cartesian position in metres to WGS-84.

    Returns ``(longitude_deg, latitude_deg, ellipsoidal_height_m)``.  The
    algorithm is intentionally local and dependency-free because these
    product exports only need a WGS-84 geographic rendering path; frame
    realization choices remain the responsibility of the propagation chain.
    """

    try:
        x = float(position["x"])
        y = float(position["y"])
        z = float(position["z"])
    except (KeyError, TypeError, ValueError) as exc:
        raise GeospatialExportError("Una posición ITRF debe contener x, y y z finitos en metros.") from exc
    if not all(math.isfinite(value) for value in (x, y, z)):
        raise GeospatialExportError("Una posición ITRF debe contener x, y y z finitos en metros.")

    horizontal = math.hypot(x, y)
    longitude = math.atan2(y, x)
    if horizontal < 1e-9:
        latitude = math.copysign(math.pi / 2.0, z) if z else 0.0
        polar_radius = WGS84_SEMI_MAJOR_AXIS_M * (1.0 - WGS84_FLATTENING)
        return math.degrees(longitude), math.degrees(latitude), abs(z) - polar_radius

    # Bowring-style fixed-point update.  Five iterations converge well below
    # a millimetre for terrestrial positions and remain stable for orbital
    # altitudes.
    latitude = math.atan2(z, horizontal * (1.0 - WGS84_ECCENTRICITY_SQUARED))
    altitude = 0.0
    for _ in range(6):
        sine = math.sin(latitude)
        radius = WGS84_SEMI_MAJOR_AXIS_M / math.sqrt(1.0 - WGS84_ECCENTRICITY_SQUARED * sine * sine)
        altitude = horizontal / math.cos(latitude) - radius
        latitude = math.atan2(
            z,
            horizontal * (1.0 - (WGS84_ECCENTRICITY_SQUARED * radius / (radius + altitude))),
        )
    sine = math.sin(latitude)
    radius = WGS84_SEMI_MAJOR_AXIS_M / math.sqrt(1.0 - WGS84_ECCENTRICITY_SQUARED * sine * sine)
    altitude = horizontal / math.cos(latitude) - radius
    return math.degrees(longitude), math.degrees(latitude), altitude


def orbital_geospatial_feature(
    name: str,
    points: Iterable[Mapping[str, object]],
    properties: Mapping[str, object] | None = None,
) -> dict:
    """Build one WGS-84 LineString feature when it does not cross ±180°.

    Use :func:`orbital_geospatial_features` for arbitrary ground tracks.  A
    single LineString cannot cross the anti-meridian without creating a false
    chord around the world in ordinary GIS viewers, so crossing tracks are
    deliberately returned as separate LineStrings by the plural API.
    """

    features = orbital_geospatial_features(name, points, properties)
    if len(features) != 1:
        raise GeospatialExportError(
            "La trayectoria cruza el anti-meridiano; usa orbital_geospatial_features "
            "para conservar sus segmentos LineString."
        )
    return features[0]


def orbital_geospatial_features(
    name: str,
    points: Iterable[Mapping[str, object]],
    properties: Mapping[str, object] | None = None,
) -> list[dict]:
    """Build anti-meridian-safe WGS-84 LineString features from ITRF samples.

    ``GeoJSON``, WKT and WKB consumers receive the corresponding 2-D ground
    track.  KML, KMZ and GeoPackage retain each sample's ellipsoidal altitude
    so they can render the sampled 3-D path.  This function rejects non-
    terrestrial samples instead of treating EME2000 or TEME coordinates as
    latitude/longitude.
    """

    coordinates: list[tuple[float, float, float]] = []
    first_time = ""
    last_time = ""
    for point in points:
        frame = str(point.get("reference_frame") or "").strip().upper()
        if not frame.startswith("ITRF") and frame not in {"ITRS", "WGS84"}:
            raise GeospatialExportError(
                "La exportación geoespacial requiere muestras terrestres ITRF/ITRS; "
                f"se recibió {frame or 'un marco no declarado'}."
            )
        longitude, latitude, altitude = itrf_position_to_wgs84(point.get("position") or {})
        coordinates.append((longitude, latitude, altitude))
        timestamp = str(point.get("epoch") or point.get("time") or "").strip()
        if timestamp:
            first_time = first_time or timestamp
            last_time = timestamp

    if len(coordinates) < 2:
        raise GeospatialExportError("Una órbita requiere al menos dos muestras para exportar una línea.")

    feature_properties = dict(properties or {})
    feature_name = str(name or "Orbit").strip() or "Orbit"
    feature_properties.setdefault("name", feature_name)
    feature_properties.setdefault(
        "coordinate_reference_system",
        "WGS 84 geographic longitude/latitude; ellipsoidal height where the output supports Z",
    )
    feature_properties.setdefault("sample_count", len(coordinates))
    if first_time:
        feature_properties.setdefault("start_time", first_time)
    if last_time:
        feature_properties.setdefault("end_time", last_time)
    segments = _split_antimeridian(coordinates)
    if len(segments) == 1:
        return [{
            "name": feature_name,
            "geometry_type": "LineString",
            "coordinates": segments[0],
            "properties": feature_properties,
        }]

    segment_count = len(segments)
    return [
        {
            "name": f"{feature_name} ({index}/{segment_count})",
            "geometry_type": "LineString",
            "coordinates": segment,
            "properties": {
                **feature_properties,
                "segment_index": index,
                "segment_count": segment_count,
            },
        }
        for index, segment in enumerate(segments, start=1)
    ]


def _split_antimeridian(
    coordinates: Sequence[tuple[float, float, float]],
) -> list[list[tuple[float, float, float]]]:
    """Split a geographic track into LineStrings that never wrap at ±180°.

    The splitting point is linearly interpolated in the exported sample
    coordinates.  It is a display/interchange boundary rather than an extra
    propagated state; no source epoch or dynamics are fabricated.
    """

    segments: list[list[tuple[float, float, float]]] = [[coordinates[0]]]
    for previous, current in zip(coordinates, coordinates[1:]):
        raw_delta = current[0] - previous[0]
        if -180.0 <= raw_delta <= 180.0:
            segments[-1].append(current)
            continue

        if raw_delta < -180.0:
            # 170° -> -170° travelled eastward through +180°.
            boundary_from, boundary_to = 180.0, -180.0
            unwrapped_current = current[0] + 360.0
        else:
            # -170° -> 170° travelled westward through -180°.
            boundary_from, boundary_to = -180.0, 180.0
            unwrapped_current = current[0] - 360.0
        denominator = unwrapped_current - previous[0]
        if abs(denominator) < 1e-12:
            # +180° and -180° denote the same meridian.  Keep the existing
            # side of the seam instead of attempting an undefined split.
            segments[-1].append((previous[0], current[1], current[2]))
            continue
        fraction = (boundary_from - previous[0]) / denominator
        latitude = previous[1] + fraction * (current[1] - previous[1])
        altitude = previous[2] + fraction * (current[2] - previous[2])
        segments[-1].append((boundary_from, latitude, altitude))
        segments.append([(boundary_to, latitude, altitude), current])
    return segments


def geospatial_export_bytes(format_name: str, features: Iterable[Mapping[str, object]]) -> bytes:
    """Serialize Point/LineString features as a portable spatial product.

    A feature has ``geometry_type`` (``Point`` or ``LineString``),
    ``coordinates``, an optional display ``name``, and optional ``properties``.
    The public API is intentionally reusable by ground-segment exporters.
    """

    format_key = str(format_name or "").strip().lower()
    _format_metadata(format_key)
    normalized_features = [_normalize_feature(feature) for feature in features]
    if not normalized_features:
        raise GeospatialExportError("La exportación geoespacial requiere al menos una geometría.")

    if format_key == "geojson":
        payload = {
            "type": "FeatureCollection",
            "features": [_geojson_feature(feature) for feature in normalized_features],
        }
        return (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    if format_key == "kml":
        return _kml_document(normalized_features).encode("utf-8")
    if format_key == "kmz":
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("doc.kml", _kml_document(normalized_features).encode("utf-8"))
        return output.getvalue()
    if format_key == "gpkg":
        return _geopackage_bytes(normalized_features)
    if format_key == "wkt":
        return (_wkt_collection(normalized_features) + "\n").encode("utf-8")
    if format_key == "wkb":
        return _wkb_collection(normalized_features, include_altitude=False)
    raise AssertionError(f"Formato validado pero no serializado: {format_key}")


def _normalize_feature(feature: Mapping[str, object]) -> dict:
    if not isinstance(feature, Mapping):
        raise GeospatialExportError("Cada geometría de exportación debe ser un objeto.")
    geometry_type = str(feature.get("geometry_type") or feature.get("geometryType") or "").strip().upper()
    if geometry_type not in {"POINT", "LINESTRING"}:
        raise GeospatialExportError("Solo se admiten geometrías Point y LineString.")
    raw_coordinates = feature.get("coordinates")
    if geometry_type == "POINT":
        coordinates: object = _normalize_coordinate(raw_coordinates)
    else:
        if not isinstance(raw_coordinates, Sequence) or isinstance(raw_coordinates, (str, bytes)):
            raise GeospatialExportError("Una LineString debe contener una lista de coordenadas.")
        coordinates = [_normalize_coordinate(value) for value in raw_coordinates]
        if len(coordinates) < 2:
            raise GeospatialExportError("Una LineString debe contener al menos dos coordenadas.")
    properties = feature.get("properties")
    if properties is not None and not isinstance(properties, Mapping):
        raise GeospatialExportError("Las propiedades de la geometría deben ser un objeto.")
    return {
        "name": str(feature.get("name") or (properties or {}).get("name") or "Orbit").strip() or "Orbit",
        "geometry_type": geometry_type,
        "coordinates": coordinates,
        "properties": dict(properties or {}),
    }


def _normalize_coordinate(value: object) -> tuple[float, float, float]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)) or len(value) < 2:
        raise GeospatialExportError("Cada coordenada debe contener longitud y latitud.")
    try:
        longitude = float(value[0])
        latitude = float(value[1])
        altitude = float(value[2]) if len(value) >= 3 and value[2] is not None else 0.0
    except (TypeError, ValueError) as exc:
        raise GeospatialExportError("Las coordenadas deben contener valores numéricos finitos.") from exc
    if not all(math.isfinite(component) for component in (longitude, latitude, altitude)):
        raise GeospatialExportError("Las coordenadas deben contener valores numéricos finitos.")
    if not -180.0 <= longitude <= 180.0 or not -90.0 <= latitude <= 90.0:
        raise GeospatialExportError("Las coordenadas WGS-84 deben estar dentro de longitud ±180° y latitud ±90°.")
    return longitude, latitude, altitude


def _geojson_feature(feature: Mapping[str, object]) -> dict:
    geometry_type = _display_geometry_type(feature["geometry_type"])
    coordinates = feature["coordinates"]
    if feature["geometry_type"] == "POINT":
        geometry_coordinates = [coordinates[0], coordinates[1]]
    else:
        geometry_coordinates = [[coordinate[0], coordinate[1]] for coordinate in coordinates]
    return {
        "type": "Feature",
        "properties": _json_properties(feature["properties"], feature["name"]),
        "geometry": {"type": geometry_type, "coordinates": geometry_coordinates},
    }


def _display_geometry_type(geometry_type: str) -> str:
    return "LineString" if geometry_type == "LINESTRING" else "Point"


def _json_properties(properties: Mapping[str, object], name: str) -> dict:
    # Convert unknown property values to strings instead of letting one UI
    # object make an otherwise valid spatial export fail JSON serialization.
    result = {"name": name}
    for key, value in properties.items():
        if value is None or isinstance(value, (str, int, float, bool)):
            result[str(key)] = value
        else:
            result[str(key)] = str(value)
    return result


def _kml_document(features: Sequence[Mapping[str, object]]) -> str:
    placemarks = "\n".join(_kml_placemark(feature) for feature in features)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<kml xmlns="http://www.opengis.net/kml/2.2">\n'
        "  <Document>\n"
        f"{placemarks}\n"
        "  </Document>\n"
        "</kml>\n"
    )


def _kml_placemark(feature: Mapping[str, object]) -> str:
    name = xml_escape(str(feature["name"]))
    description = _kml_description(feature["properties"])
    coordinates = feature["coordinates"]
    if feature["geometry_type"] == "POINT":
        body = (
            "      <Point><altitudeMode>absolute</altitudeMode>"
            f"<coordinates>{_kml_coordinate(coordinates)}</coordinates></Point>"
        )
    else:
        linestring_coordinates = " ".join(_kml_coordinate(coordinate) for coordinate in coordinates)
        body = (
            "      <LineString><tessellate>0</tessellate><altitudeMode>absolute</altitudeMode>"
            f"<coordinates>{linestring_coordinates}</coordinates></LineString>"
        )
    description_element = f"\n      <description>{xml_escape(description)}</description>" if description else ""
    return f"    <Placemark>\n      <name>{name}</name>{description_element}\n{body}\n    </Placemark>"


def _kml_description(properties: Mapping[str, object]) -> str:
    values = [f"{key}: {value}" for key, value in _json_properties(properties, "").items() if key != "name"]
    return "\n".join(values)


def _kml_coordinate(coordinate: Sequence[float]) -> str:
    return f"{coordinate[0]:.9f},{coordinate[1]:.9f},{coordinate[2]:.3f}"


def _wkt_collection(features: Sequence[Mapping[str, object]]) -> str:
    geometries = [_wkt_geometry(feature, include_altitude=False) for feature in features]
    return geometries[0] if len(geometries) == 1 else f"GEOMETRYCOLLECTION ({', '.join(geometries)})"


def _wkt_geometry(feature: Mapping[str, object], include_altitude: bool) -> str:
    suffix = " Z" if include_altitude else ""
    coordinates = feature["coordinates"]
    if feature["geometry_type"] == "POINT":
        return f"POINT{suffix} ({_wkt_coordinate(coordinates, include_altitude)})"
    joined = ", ".join(_wkt_coordinate(coordinate, include_altitude) for coordinate in coordinates)
    return f"LINESTRING{suffix} ({joined})"


def _wkt_coordinate(coordinate: Sequence[float], include_altitude: bool) -> str:
    values = coordinate if include_altitude else coordinate[:2]
    return " ".join(f"{value:.9f}" for value in values)


def _wkb_collection(features: Sequence[Mapping[str, object]], include_altitude: bool) -> bytes:
    geometries = [_wkb_geometry(feature, include_altitude) for feature in features]
    if len(geometries) == 1:
        return geometries[0]
    dimension_offset = 1000 if include_altitude else 0
    return struct.pack("<BII", 1, _GEOMETRY_TYPE_CODES["GEOMETRYCOLLECTION"] + dimension_offset, len(geometries)) + b"".join(geometries)


def _wkb_geometry(feature: Mapping[str, object], include_altitude: bool) -> bytes:
    geometry_type = feature["geometry_type"]
    dimension_offset = 1000 if include_altitude else 0
    header = struct.pack("<BI", 1, _GEOMETRY_TYPE_CODES[geometry_type] + dimension_offset)
    coordinates = feature["coordinates"]
    if geometry_type == "POINT":
        return header + _wkb_coordinate(coordinates, include_altitude)
    return header + struct.pack("<I", len(coordinates)) + b"".join(
        _wkb_coordinate(coordinate, include_altitude) for coordinate in coordinates
    )


def _wkb_coordinate(coordinate: Sequence[float], include_altitude: bool) -> bytes:
    values = coordinate if include_altitude else coordinate[:2]
    return struct.pack("<" + ("d" * len(values)), *values)


def _geopackage_bytes(features: Sequence[Mapping[str, object]]) -> bytes:
    """Create a compact, valid GeoPackage using only the Python stdlib.

    The table uses a generic geometry column so a caller can export a station
    Point collection as well as an orbital LineString collection.  It stores
    EPSG:4979 longitude/latitude/ellipsoidal-height coordinates and each
    feature's JSON properties as an auditable attribute column.
    """

    all_coordinates = [
        coordinate
        for feature in features
        for coordinate in ([feature["coordinates"]] if feature["geometry_type"] == "POINT" else feature["coordinates"])
    ]
    min_x = min(coordinate[0] for coordinate in all_coordinates)
    max_x = max(coordinate[0] for coordinate in all_coordinates)
    min_y = min(coordinate[1] for coordinate in all_coordinates)
    max_y = max(coordinate[1] for coordinate in all_coordinates)
    now = datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    connection = sqlite3.connect(":memory:")
    try:
        connection.execute("PRAGMA application_id = 1196444487")  # 0x47504B47 / GPKG
        connection.execute("PRAGMA user_version = 10300")
        _create_geopackage_schema(connection)
        connection.executemany(
            "INSERT INTO gpkg_spatial_ref_sys (srs_name, srs_id, organization, organization_coordsys_id, definition, description) VALUES (?, ?, ?, ?, ?, ?)",
            [
                ("Undefined Cartesian", -1, "NONE", -1, "undefined", "undefined"),
                ("Undefined geographic", 0, "NONE", 0, "undefined", "undefined"),
                ("WGS 84 geodetic", 4326, "EPSG", 4326, _EPSG_4326_WKT, "longitude/latitude WGS 84"),
                ("WGS 84 3D", 4979, "EPSG", 4979, _EPSG_4979_WKT, "longitude/latitude/ellipsoidal height WGS 84"),
            ],
        )
        connection.execute(
            "INSERT INTO gpkg_contents (table_name, data_type, identifier, description, last_change, min_x, min_y, max_x, max_y, srs_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("orbit_features", "features", "orbit_features", "Orbit geospatial export", now, min_x, min_y, max_x, max_y, 4979),
        )
        connection.execute(
            "INSERT INTO gpkg_geometry_columns (table_name, column_name, geometry_type_name, srs_id, z, m) VALUES (?, ?, ?, ?, ?, ?)",
            ("orbit_features", "geom", "GEOMETRY", 4979, 1, 0),
        )
        connection.executemany(
            """
            INSERT INTO orbit_features (
                geom, name, geometry_type, source_format, propagator,
                reference_frame, time_scale, start_time, end_time,
                sample_count, station_id, feature_kind, properties
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    _gpkg_geometry_blob(feature),
                    feature["name"],
                    _display_geometry_type(feature["geometry_type"]),
                    _feature_property_text(feature, "source_format"),
                    _feature_property_text(feature, "propagator"),
                    _feature_property_text(feature, "reference_frame"),
                    _feature_property_text(feature, "time_scale"),
                    _feature_property_text(feature, "start_time"),
                    _feature_property_text(feature, "end_time"),
                    _feature_property_integer(feature, "sample_count"),
                    _feature_property_text(feature, "station_id"),
                    _feature_property_text(feature, "feature_kind") or _display_geometry_type(feature["geometry_type"]),
                    json.dumps(_json_properties(feature["properties"], feature["name"]), ensure_ascii=False, sort_keys=True),
                )
                for feature in features
            ],
        )
        connection.commit()
        return connection.serialize()
    finally:
        connection.close()


def _create_geopackage_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE gpkg_spatial_ref_sys (
            srs_name TEXT NOT NULL,
            srs_id INTEGER NOT NULL PRIMARY KEY,
            organization TEXT NOT NULL,
            organization_coordsys_id INTEGER NOT NULL,
            definition TEXT NOT NULL,
            description TEXT
        );
        CREATE TABLE gpkg_contents (
            table_name TEXT NOT NULL PRIMARY KEY,
            data_type TEXT NOT NULL,
            identifier TEXT UNIQUE,
            description TEXT DEFAULT '',
            last_change DATETIME NOT NULL,
            min_x DOUBLE,
            min_y DOUBLE,
            max_x DOUBLE,
            max_y DOUBLE,
            srs_id INTEGER,
            CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
        );
        CREATE TABLE gpkg_geometry_columns (
            table_name TEXT NOT NULL,
            column_name TEXT NOT NULL,
            geometry_type_name TEXT NOT NULL,
            srs_id INTEGER NOT NULL,
            z TINYINT NOT NULL,
            m TINYINT NOT NULL,
            CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name),
            CONSTRAINT fk_gc_tn FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name),
            CONSTRAINT fk_gc_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
        );
        CREATE TABLE orbit_features (
            fid INTEGER PRIMARY KEY AUTOINCREMENT,
            geom BLOB NOT NULL,
            name TEXT NOT NULL,
            geometry_type TEXT NOT NULL,
            source_format TEXT,
            propagator TEXT,
            reference_frame TEXT,
            time_scale TEXT,
            start_time TEXT,
            end_time TEXT,
            sample_count INTEGER,
            station_id TEXT,
            feature_kind TEXT,
            properties TEXT NOT NULL
        );
        """
    )


def _feature_property_text(feature: Mapping[str, object], key: str) -> str | None:
    value = feature.get("properties", {}).get(key)
    if value is None:
        return None
    return str(value)


def _feature_property_integer(feature: Mapping[str, object], key: str) -> int | None:
    value = feature.get("properties", {}).get(key)
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _gpkg_geometry_blob(feature: Mapping[str, object]) -> bytes:
    coordinates = [feature["coordinates"]] if feature["geometry_type"] == "POINT" else feature["coordinates"]
    min_x = min(coordinate[0] for coordinate in coordinates)
    max_x = max(coordinate[0] for coordinate in coordinates)
    min_y = min(coordinate[1] for coordinate in coordinates)
    max_y = max(coordinate[1] for coordinate in coordinates)
    min_z = min(coordinate[2] for coordinate in coordinates)
    max_z = max(coordinate[2] for coordinate in coordinates)
    # Little endian + XYZ envelope indicator (2): GeoPackageBinaryHeader.
    header = b"GP" + bytes((0, 5)) + struct.pack("<i", 4979)
    envelope = struct.pack("<6d", min_x, max_x, min_y, max_y, min_z, max_z)
    return header + envelope + _wkb_geometry(feature, include_altitude=True)


_EPSG_4326_WKT = (
    'GEOGCS["WGS 84",DATUM["World Geodetic System 1984",'
    'SPHEROID["WGS 84",6378137,298.257223563]],'
    'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]'
)

_EPSG_4979_WKT = (
    'GEOGCRS["WGS 84",DATUM["World Geodetic System 1984",'
    'ELLIPSOID["WGS 84",6378137,298.257223563]],'
    'PRIMEM["Greenwich",0],CS[ellipsoidal,3],'
    'AXIS["geodetic latitude (Lat)",north],'
    'AXIS["geodetic longitude (Lon)",east],'
    'AXIS["ellipsoidal height (h)",up],UNIT["degree",0.0174532925199433],'
    'LENGTHUNIT["metre",1]]'
)

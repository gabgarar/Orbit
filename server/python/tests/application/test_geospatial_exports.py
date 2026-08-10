"""Tests for browser-independent GIS export products."""

from __future__ import annotations

import io
import json
import math
import sqlite3
import struct
import zipfile

import pytest

from orbit_api.application.geospatial_exports import (
    GeospatialExportError,
    geospatial_export_bytes,
    itrf_position_to_wgs84,
    orbital_geospatial_feature,
    orbital_geospatial_features,
)


LINE = {
    "name": "Orbit test",
    "geometry_type": "LineString",
    "coordinates": [
        (-3.703790, 40.416775, 550_000.0),
        (-3.103790, 40.816775, 551_000.0),
    ],
    "properties": {"source_format": "TLE", "propagator": "sgp4"},
}


def test_itrf_position_to_wgs84_returns_geodetic_longitude_latitude_and_height():
    longitude, latitude, height = itrf_position_to_wgs84({"x": 6_378_137.0, "y": 0.0, "z": 0.0})

    assert longitude == pytest.approx(0.0)
    assert latitude == pytest.approx(0.0)
    assert height == pytest.approx(0.0)


def test_geojson_ground_track_is_explicitly_two_dimensional():
    payload = json.loads(geospatial_export_bytes("geojson", [LINE]))

    assert payload["type"] == "FeatureCollection"
    feature = payload["features"][0]
    assert feature["geometry"]["type"] == "LineString"
    assert feature["geometry"]["coordinates"] == [[-3.70379, 40.416775], [-3.10379, 40.816775]]
    assert feature["properties"]["source_format"] == "TLE"


def test_kml_and_kmz_keep_sampled_altitude_for_three_dimensional_viewers():
    kml = geospatial_export_bytes("kml", [LINE]).decode("utf-8")
    kmz = geospatial_export_bytes("kmz", [LINE])

    assert "<altitudeMode>absolute</altitudeMode>" in kml
    assert "-3.703790000,40.416775000,550000.000" in kml
    with zipfile.ZipFile(io.BytesIO(kmz)) as archive:
        assert archive.namelist() == ["doc.kml"]
        assert "Orbit test" in archive.read("doc.kml").decode("utf-8")


def test_wkt_and_wkb_are_two_dimensional_lines_for_spatial_databases():
    wkt = geospatial_export_bytes("wkt", [LINE]).decode("utf-8")
    wkb = geospatial_export_bytes("wkb", [LINE])

    assert wkt.startswith("LINESTRING (")
    assert "550000" not in wkt
    byte_order, geometry_type, count = struct.unpack("<BII", wkb[:9])
    assert byte_order == 1
    assert geometry_type == 2  # OGC LineString, not Z.
    assert count == 2


def test_geopackage_is_a_real_sqlite_product_with_attributes_and_xyz_geometry():
    product = geospatial_export_bytes("gpkg", [LINE])
    connection = sqlite3.connect(":memory:")
    try:
        connection.deserialize(product)
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert connection.execute("PRAGMA application_id").fetchone() == (1196444487,)
        assert connection.execute("SELECT table_name, srs_id FROM gpkg_contents").fetchone() == ("orbit_features", 4979)
        assert connection.execute("SELECT srs_id, z FROM gpkg_geometry_columns").fetchone() == (4979, 1)
        assert connection.execute("SELECT srs_id, description FROM gpkg_spatial_ref_sys WHERE srs_id IN (-1, 0) ORDER BY srs_id").fetchall() == [(-1, "undefined"), (0, "undefined")]
        row = connection.execute(
            "SELECT name, geometry_type, source_format, propagator, feature_kind, properties, geom FROM orbit_features"
        ).fetchone()
        assert row[0:5] == ("Orbit test", "LineString", "TLE", "sgp4", "LineString")
        assert json.loads(row[5])["propagator"] == "sgp4"
        assert row[6].startswith(b"GP\x00\x05")
        assert struct.unpack("<i", row[6][4:8])[0] == 4979
        assert struct.unpack("<I", row[6][57:61])[0] == 1002  # WKB LineString Z after a 56-byte GPKG header and byte order.
    finally:
        connection.close()


def test_serializers_are_reusable_for_ground_station_point_features():
    point = {
        "name": "Estación Madrid",
        "geometry_type": "Point",
        "coordinates": (-3.703790, 40.416775, 667.0),
        "properties": {"mask_deg": 10},
    }

    geojson = json.loads(geospatial_export_bytes("geojson", [point]))
    geopackage = geospatial_export_bytes("gpkg", [point])

    assert geojson["features"][0]["geometry"] == {"type": "Point", "coordinates": [-3.70379, 40.416775]}
    assert geopackage.startswith(b"SQLite format 3\x00")


def test_orbital_feature_rejects_an_inertial_frame_instead_of_faking_a_ground_track():
    with pytest.raises(GeospatialExportError, match="ITRF/ITRS"):
        orbital_geospatial_feature(
            "Invalid",
            [
                {"reference_frame": "TEME", "position": {"x": 6_378_137, "y": 0, "z": 0}},
                {"reference_frame": "TEME", "position": {"x": 6_379_137, "y": 0, "z": 0}},
            ],
        )

    with pytest.raises(GeospatialExportError, match="ITRF/ITRS"):
        orbital_geospatial_feature(
            "Missing frame",
            [
                {"position": {"x": 6_378_137, "y": 0, "z": 0}},
                {"position": {"x": 6_379_137, "y": 0, "z": 0}},
            ],
        )


def test_orbital_features_split_an_antimeridian_crossing_without_a_world_spanning_chord():
    radius = 6_378_137.0

    def position_at(longitude_deg):
        radians = math.radians(longitude_deg)
        return {"x": radius * math.cos(radians), "y": radius * math.sin(radians), "z": 0.0}

    features = orbital_geospatial_features(
        "Anti-meridian",
        [
            {"reference_frame": "ITRF", "position": position_at(179.0), "time": "2026-01-01T00:00:00Z"},
            {"reference_frame": "ITRF", "position": position_at(-179.0), "time": "2026-01-01T00:01:00Z"},
        ],
    )

    assert len(features) == 2
    assert features[0]["coordinates"][-1][0] == pytest.approx(180.0)
    assert features[1]["coordinates"][0][0] == pytest.approx(-180.0)
    geojson = json.loads(geospatial_export_bytes("geojson", features))
    assert len(geojson["features"]) == 2
    for feature in geojson["features"]:
        coordinates = feature["geometry"]["coordinates"]
        assert all(abs(right[0] - left[0]) <= 180.0 for left, right in zip(coordinates, coordinates[1:]))
    assert geospatial_export_bytes("wkt", features).decode("utf-8").startswith("GEOMETRYCOLLECTION (")
    connection = sqlite3.connect(":memory:")
    try:
        connection.deserialize(geospatial_export_bytes("gpkg", features))
        assert connection.execute("SELECT COUNT(*) FROM orbit_features").fetchone() == (2,)
    finally:
        connection.close()
    with pytest.raises(GeospatialExportError, match="anti-meridiano"):
        orbital_geospatial_feature(
            "Anti-meridian",
            [
                {"reference_frame": "ITRF", "position": position_at(179.0)},
                {"reference_frame": "ITRF", "position": position_at(-179.0)},
            ],
        )

    seam = orbital_geospatial_features(
        "Seam",
        [
            {"reference_frame": "ITRF", "position": position_at(-180.0)},
            {"reference_frame": "ITRF", "position": position_at(180.0)},
        ],
    )
    assert len(seam) == 1
    assert seam[0]["coordinates"][-1][0] == pytest.approx(-180.0)

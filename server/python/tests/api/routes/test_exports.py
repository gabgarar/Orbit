"""Focused contract tests for the orbit product-export route factory."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import json

import pytest
from fastapi import HTTPException

from orbit_api.api.routes.exports import create_exports_router
from orbit_api.domain.requests import ManualOrbitRequest


START = datetime(2026, 1, 1, tzinfo=UTC)
END = START + timedelta(minutes=1)


def _entry(*, source_format="TLE", line1="1 25544U 98067A   24001.00000000  .00000000  00000+0  00000+0 0  9991", line2="2 25544  51.6400  10.0000 0005000  30.0000 330.0000 15.50000000000000"):
    return {"name": "ISS", "sourceFormat": source_format, "line1": line1, "line2": line2}


def _ephemeris(name, _engine, start, end, _step, _include_velocity):
    return {
        "satellite": name,
        "reference_frame": "ITRF",
        "time_scale": "UTC",
        "start_time": start.isoformat(),
        "end_time": end.isoformat(),
        "points": [
            {
                "time": start.isoformat(),
                "epoch": start.isoformat(),
                "time_scale": "UTC",
                "reference_frame": "ITRF",
                "position": {"x": 6_378_137.0, "y": 0.0, "z": 0.0},
                "velocity": {"x": 0.0, "y": 7_500.0, "z": 0.0},
            },
            {
                "time": end.isoformat(),
                "epoch": end.isoformat(),
                "time_scale": "UTC",
                "reference_frame": "ITRF",
                "position": {"x": 0.0, "y": 6_378_137.0, "z": 0.0},
                "velocity": {"x": -7_500.0, "y": 0.0, "z": 0.0},
            },
        ],
    }


def _endpoint(router, path):
    return next(route.endpoint for route in router.routes if route.path == path)


def _router(entry):
    return create_exports_router(
        lambda _satellite_id: entry,
        lambda satellite_id, _line1, _line2: (satellite_id, object()),
        _ephemeris,
        lambda value: value.astimezone(UTC),
    )


def test_real_tle_export_preserves_two_original_source_lines():
    endpoint = _endpoint(_router(_entry()), "/export/tle/{sat_id}")

    response = endpoint("ISS")

    assert response.status_code == 200
    assert response.headers["content-disposition"] == "attachment; filename=ISS.tle"
    assert response.body.decode("utf-8").splitlines() == ["ISS", _entry()["line1"], _entry()["line2"]]


@pytest.mark.parametrize(
    ("entry", "expected_status"),
    [
        (_entry(source_format="OMM"), 400),
        (_entry(line1="not a TLE"), 422),
    ],
)
def test_tle_export_rejects_non_tle_provenance_and_invalid_source_lines(entry, expected_status):
    endpoint = _endpoint(_router(entry), "/export/tle/{sat_id}")

    with pytest.raises(HTTPException) as excinfo:
        endpoint("ISS")

    assert excinfo.value.status_code == expected_status


def test_omm_source_export_rejects_non_omm_catalogue_provenance():
    endpoint = _endpoint(_router(_entry(source_format="TLE")), "/export/omm/{sat_id}")

    with pytest.raises(HTTPException) as excinfo:
        endpoint("ISS", "json")

    assert excinfo.value.status_code == 400


def test_ephemeris_export_uses_catalogue_provenance_and_returns_itrf_geojson_ground_track():
    endpoint = _endpoint(_router(_entry(source_format="OMM")), "/export/ephemeris/{sat_id}")

    response = endpoint("ISS", START, END, 30.0, "geojson", "sgp4", "OMM")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/geo+json")
    payload = json.loads(response.body)
    assert payload["features"][0]["properties"]["source_format"] == "OMM"
    assert payload["features"][0]["geometry"]["coordinates"] == [[0.0, 0.0], [90.0, 0.0]]


def test_ephemeris_export_cannot_relabel_catalogue_provenance_from_a_query_parameter():
    endpoint = _endpoint(_router(_entry(source_format="OMM")), "/export/ephemeris/{sat_id}")

    with pytest.raises(HTTPException) as excinfo:
        endpoint("ISS", START, END, 30.0, "csv", "sgp4", "TLE")

    assert excinfo.value.status_code == 400


def test_ephemeris_export_does_not_run_sgp4_over_an_oem_source():
    endpoint = _endpoint(_router(_entry(source_format="OEM")), "/export/ephemeris/{sat_id}")

    with pytest.raises(HTTPException) as excinfo:
        endpoint("ISS", START, END, 30.0, "csv", "sgp4", None)

    assert excinfo.value.status_code == 409


def test_manual_export_runs_the_manual_propagation_contract_without_a_tle():
    endpoint = _endpoint(_router(_entry()), "/export/manual-ephemeris")
    payload = ManualOrbitRequest(
        name="Manual test",
        epoch=START,
        propagator="two-body",
        definition_source="keplerian",
        keplerian={
            "semi_major_axis_km": 6878,
            "eccentricity": 0.001,
            "inclination_deg": 51.6,
            "raan_deg": 20,
            "argument_of_perigee_deg": 45,
            "true_anomaly_deg": 90,
        },
        start_time=START,
        end_time=END,
        step_seconds=30,
    )

    response = endpoint(payload, "geojson")

    assert response.status_code == 200
    exported = json.loads(response.body)
    assert exported["features"][0]["properties"]["source_format"] == "MANUAL"
    assert exported["features"][0]["properties"]["propagator"] == "two-body"

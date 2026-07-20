"""Manual-orbit conversion, TLE construction, and route adapter tests."""

from datetime import UTC, datetime
import math

from orbit_api.api.routes.manual_orbits import create_manual_orbits_router
from orbit_api.application.manual_orbits import (
    build_synthetic_tle,
    canonical_manual_orbit,
    is_valid_tle_checksum,
)
from orbit_api.domain.requests import ManualOrbitRequest
from orbit_api.orbits.propagators.sgp4.propagator import SGP4Propagator


def keplerian_payload(**overrides):
    payload = {
        "name": "Manual test",
        "epochUtc": "2026-07-20T12:00:00Z",
        "propagator": "sgp4",
        "keplerian": {
            "semiMajorAxisKm": 6878,
            "eccentricity": 0.001,
            "inclinationDeg": 51.6,
            "raanDeg": 20,
            "argumentOfPeriapsisDeg": 45,
            "trueAnomalyDeg": 90,
        },
    }
    payload.update(overrides)
    return payload


def test_manual_request_accepts_editor_camel_case_and_generates_valid_synthetic_tle():
    request = ManualOrbitRequest(**keplerian_payload())
    source, keplerian, state_vector = canonical_manual_orbit(request)
    tle = build_synthetic_tle(request.name, request.epoch, keplerian)

    assert source == "keplerian"
    assert state_vector["reference_frame"] == "ECI"
    assert keplerian["mean_anomaly_deg"] != keplerian["true_anomaly_deg"]
    assert len(tle["line1"]) == len(tle["line2"]) == 69
    assert is_valid_tle_checksum(tle["line1"])
    assert is_valid_tle_checksum(tle["line2"])
    assert tle["synthetic"] is True
    propagated = SGP4Propagator(tle["line1"], tle["line2"]).propagate_datetime(datetime(2026, 7, 20, 12, 0, 0))
    assert len(propagated) == 6 and all(math.isfinite(component) for component in propagated)


def test_manual_request_accepts_flat_state_vector_and_derives_keplerian():
    request = ManualOrbitRequest(
        name="State vector test",
        epoch="2026-07-20T12:00:00+00:00",
        source="stateVector",
        stateVector={
            "positionXKm": 7000,
            "positionYKm": 0,
            "positionZKm": 0,
            "velocityXKmS": 0,
            "velocityYKmS": 7.5,
            "velocityZKmS": 1.0,
        },
    )
    source, keplerian, state_vector = canonical_manual_orbit(request)

    assert source == "state_vector"
    assert keplerian["semi_major_axis_km"] > 6378
    assert 0 <= keplerian["eccentricity"] < 1
    assert state_vector["position_eci_km"]["x"] == 7000
    assert state_vector["velocity_eci_km_s"]["z"] == 1.0


def test_manual_route_uses_resolver_and_returns_display_named_itrf_ephemeris():
    calls = []

    class FakePropagator: pass

    def resolve_propagator(sat_id, line1, line2, propagator_name):
        calls.append((sat_id, line1, line2, propagator_name))
        return "sgp4:tle:test", FakePropagator()

    def build_ephemeris(name, propagator, start, end, step, include_velocity):
        assert name == "sgp4:tle:test" and isinstance(propagator, FakePropagator)
        assert start.tzinfo is UTC and end > start and step == 30 and include_velocity is True
        return {
            "satellite": name,
            "start_time": start.isoformat(),
            "end_time": end.isoformat(),
            "step_seconds": step,
            "count": 1,
            "points": [{
                "satellite": name,
                "time": start.isoformat(),
                "reference_frame": "ITRF",
                "position_units": "m",
                "velocity_units": "m/s",
                "position": {"x": 1, "y": 2, "z": 3},
                "velocity": {"x": 4, "y": 5, "z": 6},
            }],
        }

    router = create_manual_orbits_router(resolve_propagator, build_ephemeris, lambda value: value.astimezone(UTC))
    endpoint = next(route.endpoint for route in router.routes if route.path == "/manual-orbits")
    response = endpoint(ManualOrbitRequest(**keplerian_payload(horizonHours=2)))

    assert calls and calls[0][0] is None and calls[0][3] == "sgp4"
    assert response["name"] == "Manual test"
    assert response["epochUtc"].endswith("+00:00")
    assert response["ephemeris"]["satellite"] == "Manual test"
    assert response["ephemeris"]["points"][0]["satellite"] == "Manual test"
    assert response["ephemeris"]["points"][0]["reference_frame"] == "ITRF"
    assert response["tle"]["synthetic"] is True
    assert response["propagation"]["range_source"] == "horizon_hours"
    assert response["propagation"]["duration_hours"] == 2
    assert response["orbit_summary"]["perigee_altitude_km"] > 0
    assert response["orbit_summary"]["apogee_altitude_km"] > response["orbit_summary"]["perigee_altitude_km"]


def test_manual_route_prefers_an_explicit_end_time_over_horizon_hours():
    calls = []

    class FakePropagator: pass

    def resolve_propagator(*_args):
        return "sgp4:tle:test", FakePropagator()

    def build_ephemeris(name, propagator, start, end, step, include_velocity):
        calls.append((name, propagator, start, end, step, include_velocity))
        return {
            "satellite": name,
            "start_time": start.isoformat(),
            "end_time": end.isoformat(),
            "step_seconds": step,
            "count": 2,
            "points": [],
        }

    router = create_manual_orbits_router(resolve_propagator, build_ephemeris, lambda value: value.astimezone(UTC))
    endpoint = next(route.endpoint for route in router.routes if route.path == "/manual-orbits")
    response = endpoint(ManualOrbitRequest(**keplerian_payload(
        startTime="2026-07-20T10:00:00Z",
        endTime="2026-07-20T13:30:00Z",
        horizonHours=72,
    )))

    assert calls[0][2] == datetime(2026, 7, 20, 10, 0, tzinfo=UTC)
    assert calls[0][3] == datetime(2026, 7, 20, 13, 30, tzinfo=UTC)
    assert response["propagation"] == {
        "start_time": "2026-07-20T10:00:00+00:00",
        "end_time": "2026-07-20T13:30:00+00:00",
        "duration_seconds": 12_600.0,
        "duration_hours": 3.5,
        "step_seconds": 30.0,
        "points_count": 2,
        "range_source": "explicit_end_time",
    }

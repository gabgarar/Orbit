"""Request-boundary contracts for manual AOS/LOS sources."""

from datetime import UTC, datetime

import pytest
from orbit_api.domain.requests import AosLosRequest
from pydantic import ValidationError


def _manual_orbit() -> dict:
    """Return a complete authored definition, not a synthetic TLE."""

    return {
        "name": "Manual access test",
        "epoch": "2026-08-08T10:00:00Z",
        "startTime": "2026-08-08T10:00:00Z",
        "endTime": "2026-08-08T14:00:00Z",
        "propagator": "cowell",
        "definitionSource": "keplerian",
        "keplerian": {
            "referenceFrame": "EME2000",
            "timeScale": "UTC",
            "semiMajorAxisKm": 7_000,
            "eccentricity": 0.001,
            "inclinationDeg": 98,
            "raanDeg": 20,
            "argumentOfPerigeeDeg": 30,
            "trueAnomalyDeg": 0,
        },
        "propagationOptions": {
            "forceTerms": ["central", "j2"],
            "numericalIntegrator": "rk4",
        },
    }


def _station() -> dict:
    return {
        "lat_deg": 40.4168,
        "lon_deg": -3.7038,
        "height_m": 667,
        "min_elevation_deg": 10,
    }


def _access_request(**overrides: object) -> dict:
    payload: dict = {
        "source": {"type": "manual", "manualOrbit": _manual_orbit()},
        "station": _station(),
        # Deliberately different from the manual designer's four-hour window:
        # the REST boundary owns the requested access-analysis interval.
        "startTime": "2026-08-09T00:00:00Z",
        "endTime": "2026-08-09T06:00:00Z",
        "stepSeconds": 20,
    }
    payload.update(overrides)
    return payload


def test_aos_los_manual_source_preserves_the_authored_engine_and_utc_range():
    request = AosLosRequest.model_validate(_access_request())

    assert request.source is not None
    assert request.source.kind == "manual"
    assert request.source.manual_orbit is not None
    assert request.source.manual_orbit.name == "Manual access test"
    assert request.source.manual_orbit.propagator == "cowell-rk4"
    assert request.source.manual_orbit.propagation_options.force_terms == ("central", "j2")
    assert request.sat_id is None
    assert request.line1 is None
    assert request.line2 is None
    assert request.start_time == datetime(2026, 8, 9, 0, 0, tzinfo=UTC)
    assert request.end_time == datetime(2026, 8, 9, 6, 0, tzinfo=UTC)
    assert request.step_seconds == 20


def test_aos_los_accepts_the_manual_orbit_compatibility_alias_without_a_catalogue_id():
    payload = _access_request()
    payload.pop("source")
    payload["manualOrbit"] = _manual_orbit()

    request = AosLosRequest.model_validate(payload)

    assert request.source is not None
    assert request.source.kind == "manual"
    assert request.source.manual_orbit is not None
    assert request.source.manual_orbit.epoch == datetime(2026, 8, 8, 10, 0, tzinfo=UTC)
    assert request.sat_id is None


def test_aos_los_rejects_mixing_a_manual_source_with_a_catalogue_identifier():
    with pytest.raises(ValidationError, match="manual.*sat_id|sat_id.*manual"):
        AosLosRequest.model_validate(_access_request(satId="25544"))

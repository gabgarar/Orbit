"""Validated domain request contracts."""

from datetime import UTC, datetime, timedelta

import pytest
from orbit_api.domain.requests import (
    EphemerisRequest,
    OrbitRequest,
    PropagationRequest,
    StationInput,
)
from pydantic import ValidationError


def test_sources_and_ranges_are_validated():
    with pytest.raises(ValidationError): PropagationRequest()
    with pytest.raises(ValidationError): EphemerisRequest(sat_id="ISS", start_time=datetime.now(UTC), end_time=datetime.now(UTC) - timedelta(seconds=1))
    assert OrbitRequest(sat_id="ISS").sat_id == "ISS"


def test_station_limits_are_validated():
    with pytest.raises(ValidationError): StationInput(lat_deg=91, lon_deg=0)
    with pytest.raises(ValidationError): StationInput(
        lat_deg=0,
        lon_deg=0,
        mechanical_elevation_min_deg=70,
        mechanical_elevation_max_deg=20,
    )
    # A stationary station may rely on the default HPBW/pattern fallback.
    # Requiring the old legacy ``beam_half_angle_deg`` rejected valid modern
    # station-editor payloads that instead persist the full pattern model.
    assert StationInput(
        lat_deg=0,
        lon_deg=0,
        operation_mode="stationary",
    ).operation_mode == "stationary"
    with pytest.raises(ValidationError): StationInput(
        lat_deg=0,
        lon_deg=0,
        operation_mode="stationary",
        beam_half_angle_deg=4,
        mechanical_elevation_max_deg=45,
    )
    with pytest.raises(ValidationError): StationInput(
        lat_deg=0,
        lon_deg=0,
        operation_mode="stationary",
        beam_half_angle_deg=4,
        mechanical_azimuth_min_deg=-20,
        mechanical_azimuth_max_deg=20,
        boresight_azimuth_deg=90,
    )
    assert StationInput(
        lat_deg=0,
        lon_deg=0,
        operation_mode="stationary",
        beam_half_angle_deg=4,
    ).operation_mode == "stationary"

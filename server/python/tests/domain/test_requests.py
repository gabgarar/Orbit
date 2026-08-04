"""Validated domain request contracts."""

from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from orbit_api.domain.requests import EphemerisRequest, OrbitRequest, PropagationRequest, StationInput


def test_sources_and_ranges_are_validated():
    with pytest.raises(ValidationError): PropagationRequest()
    with pytest.raises(ValidationError): EphemerisRequest(sat_id="ISS", start_time=datetime.now(UTC), end_time=datetime.now(UTC) - timedelta(seconds=1))
    assert OrbitRequest(sat_id="ISS").sat_id == "ISS"


def test_station_limits_are_validated():
    with pytest.raises(ValidationError): StationInput(lat_deg=91, lon_deg=0)

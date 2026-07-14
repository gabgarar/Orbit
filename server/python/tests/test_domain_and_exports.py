import datetime

import pytest
from pydantic import ValidationError

from orbit_api.application.exporters import ephemeris_csv_text, ephemeris_oem_text, normalize_source_format, safe_filename
from orbit_api.domain.requests import EphemerisRequest, OrbitRequest, PropagationRequest


def test_request_contract_requires_a_satellite_source():
    with pytest.raises(ValidationError):
        PropagationRequest()
    assert OrbitRequest(sat_id="ISS").sat_id == "ISS"


def test_ephemeris_request_rejects_reversed_time_range():
    now = datetime.datetime.now(datetime.UTC)
    with pytest.raises(ValidationError):
        EphemerisRequest(sat_id="ISS", start_time=now, end_time=now - datetime.timedelta(seconds=1))


def test_exporters_create_safe_machine_readable_formats():
    points = [{"time": "2026-01-01T00:00:00+00:00", "position": {"x": 1, "y": 2, "z": 3}, "velocity": {"x": 4, "y": 5, "z": 6}}]
    assert safe_filename("ISS / ZARYA") == "ISS___ZARYA"
    assert normalize_source_format("omm") == "OMM"
    assert "source_format" in ephemeris_csv_text(points)
    assert "CCSDS_OEM_VERS" in ephemeris_oem_text("ISS", points[0]["time"], points[0]["time"], points)

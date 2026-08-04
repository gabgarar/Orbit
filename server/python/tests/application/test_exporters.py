"""Export serialization tests."""

import pytest

from orbit_api.application.exporters import ephemeris_csv_text, ephemeris_oem_text, normalize_source_format, ocm_json_from_entry, omm_json_from_entry, omm_xml_from_entry, safe_filename


def test_all_export_formats_preserve_satellite_identity():
    entry = {"name": "ISS / ZARYA", "line1": "1 A", "line2": "2 B"}
    point = {"time": "2026-01-01T00:00:00Z", "position": {"x": 1, "y": 2, "z": 3}, "velocity": {"x": 4, "y": 5, "z": 6}}
    assert safe_filename(entry["name"]) == "ISS___ZARYA"
    assert normalize_source_format("invalid") == "TLE"
    assert omm_json_from_entry(entry)["OBJECT_NAME"] == entry["name"]
    assert "TLE_LINE1" in omm_xml_from_entry(entry) and ocm_json_from_entry(entry)["format"] == "OCM"
    oem = ephemeris_oem_text("ISS", point["time"], point["time"], [point])
    assert "source_format" in ephemeris_csv_text([point]) and "CCSDS_OEM_VERS" in oem
    # A legacy tuple has no verified ITRF realization; do not invent one.
    assert "REF_FRAME = ITRF\n" in oem
    assert "TIME_SYSTEM = UTC" in oem
    assert "ORBIT_POSITION_UNIT = km" in oem and "ORBIT_VELOCITY_UNIT = km/s" in oem
    assert "2026-01-01T00:00:00Z 0.001 0.002 0.003 0.004 0.005 0.006" in oem


def test_oem_export_preserves_the_explicit_frame_and_time_scale_of_native_samples():
    point = {
        "time": "2026-01-01T00:00:00Z",
        "epoch": "2026-01-01T00:00:18+00:00",
        "time_scale": "GPS",
        "reference_frame": "IGS20",
        "position": {"x": 1, "y": 2, "z": 3},
        "velocity": {"x": 4, "y": 5, "z": 6},
    }

    oem = ephemeris_oem_text("IGS satellite", point["time"], point["time"], [point])

    assert "REF_FRAME = IGS20" in oem
    assert "TIME_SYSTEM = GPS" in oem
    assert "START_TIME = 2026-01-01T00:00:18+00:00" in oem
    assert "2026-01-01T00:00:18+00:00 0.001 0.002 0.003 0.004 0.005 0.006" in oem


@pytest.mark.parametrize(
    "points",
    [
        [
            {"reference_frame": "ITRF", "time_scale": "UTC"},
            {"reference_frame": "IGS20", "time_scale": "UTC"},
        ],
        [
            {"reference_frame": "ITRF", "time_scale": "UTC"},
            {"reference_frame": "ITRF", "time_scale": "GPS"},
        ],
    ],
)
def test_oem_export_rejects_mixed_native_frame_or_time_scale_samples(points):
    with pytest.raises(ValueError, match="marcos|escalas"):
        ephemeris_oem_text("mixed", "2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z", points)

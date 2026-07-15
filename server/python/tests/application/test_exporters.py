"""Export serialization tests."""

from orbit_api.application.exporters import ephemeris_csv_text, ephemeris_oem_text, normalize_source_format, ocm_json_from_entry, omm_json_from_entry, omm_xml_from_entry, safe_filename


def test_all_export_formats_preserve_satellite_identity():
    entry = {"name": "ISS / ZARYA", "line1": "1 A", "line2": "2 B"}
    point = {"time": "2026-01-01T00:00:00Z", "position": {"x": 1, "y": 2, "z": 3}, "velocity": {"x": 4, "y": 5, "z": 6}}
    assert safe_filename(entry["name"]) == "ISS___ZARYA"
    assert normalize_source_format("invalid") == "TLE"
    assert omm_json_from_entry(entry)["OBJECT_NAME"] == entry["name"]
    assert "TLE_LINE1" in omm_xml_from_entry(entry) and ocm_json_from_entry(entry)["format"] == "OCM"
    assert "source_format" in ephemeris_csv_text([point]) and "CCSDS_OEM_VERS" in ephemeris_oem_text("ISS", point["time"], point["time"], [point])

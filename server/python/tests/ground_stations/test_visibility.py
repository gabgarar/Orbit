"""Ground-station geometry and pass extraction tests."""

from orbit_api.ground_stations.visibility import elevation_degrees, extract_passes


def test_visibility_and_open_passes_are_calculated():
    assert elevation_degrees(0, 0, (6_778_137, 0, 0)) > 0
    passes = extract_passes([{"time": "a", "elevation_deg": 11}, {"time": "b", "elevation_deg": 20}], 10)
    assert passes == [{"aos": "a", "los": "b", "max_elevation_deg": 20.0, "max_elevation_time": "b"}]

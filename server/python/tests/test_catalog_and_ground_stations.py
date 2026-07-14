import json

from orbit_api.catalog.repository import find_entry, load_entries
from orbit_api.catalog.tle_loader import load_all_tles_from_config
from orbit_api.ground_stations.visibility import elevation_degrees, extract_passes


def test_catalog_repository_loads_and_finds_json_entries(tmp_path):
    (tmp_path / "catalog.json").write_text(json.dumps({"entries": [{"name": "ISS", "line1": "1 test", "line2": "2 test"}]}), encoding="utf-8")
    entries = load_entries(tmp_path, "catalog.json", load_all_tles_from_config)
    assert find_entry(entries, "iss")["name"] == "ISS"


def test_ground_station_visibility_and_pass_extraction():
    assert elevation_degrees(0, 0, (6_778_137, 0, 0)) > 0
    passes = extract_passes([
        {"time": "t0", "elevation_deg": -1},
        {"time": "t1", "elevation_deg": 10},
        {"time": "t2", "elevation_deg": 20},
        {"time": "t3", "elevation_deg": -1},
    ], 5)
    assert passes == [{"aos": "t1", "los": "t3", "max_elevation_deg": 20, "max_elevation_time": "t2"}]

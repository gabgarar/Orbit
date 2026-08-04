"""Catalogue loading and lookup tests."""

import json

import pytest

from orbit_api.catalog.repository import find_entry, load_entries
from orbit_api.catalog.tle_loader import load_all_tles_from_config


def test_json_catalogue_is_normalized_and_case_insensitive(tmp_path):
    (tmp_path / "catalog.json").write_text(json.dumps({"entries": [{"name": "ISS", "line1": "1 A", "line2": "2 B", "format": "omm"}]}), encoding="utf-8")
    entry = find_entry(load_entries(tmp_path, "catalog.json", load_all_tles_from_config), "iss")
    assert entry == {"name": "ISS", "line1": "1 A", "line2": "2 B", "sourceFormat": "OMM"}


def test_three_line_tle_catalogue_is_loaded(tmp_path):
    path = tmp_path / "catalog.txt"
    path.write_text("ISS\n1 line\n2 line\n", encoding="utf-8")
    assert load_all_tles_from_config(str(path)) == [("ISS", "1 line", "2 line")]


def test_incomplete_text_catalogue_fails_explicitly(tmp_path):
    path = tmp_path / "bad.tle"
    path.write_text("ISS\n1 line\n", encoding="utf-8")
    with pytest.raises(ValueError):
        load_all_tles_from_config(str(path))

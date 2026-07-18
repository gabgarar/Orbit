"""Core configuration policy tests."""

from orbit_api.core.system_config import clamp_propagation_hours, normalize_catalog_file_name, normalize_system_config


def test_hours_are_clamped_and_invalid_values_use_default():
    assert clamp_propagation_hours("bad", 3) == 3
    assert clamp_propagation_hours(-1, 3) == 3
    assert clamp_propagation_hours(10**9) > 0


def test_nested_and_legacy_settings_normalize_to_one_shape():
    config = normalize_system_config({"orbit": {"propagation_hours": 4}, "satellite_label_size_px": 12})
    assert config["propagation_hours"] == 4
    assert config["satellite_label_size_px"] == 12


def test_catalog_file_name_rejects_path_traversal_for_both_platforms():
    assert normalize_catalog_file_name("mission.tle") == "mission.tle"
    for unsafe_name in (
        "../../outside.tle",
        "..\\outside.tle",
        "/etc/hosts",
        "system_config.json",
        "SYSTEM_CONFIG.JSON",
        "system_config.json.",
        "CON.tle",
        "catalog:archive.tle",
        "",
        None,
    ):
        assert normalize_catalog_file_name(unsafe_name) == "catalog.json"

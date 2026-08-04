"""Core configuration policy tests."""

from orbit_api.core.system_config import clamp_orbit_line_width, clamp_propagation_hours, normalize_catalog_file_name, normalize_system_config


def test_hours_are_clamped_and_invalid_values_use_default():
    assert clamp_propagation_hours("bad", 3) == 3
    assert clamp_propagation_hours(-1, 3) == 3
    assert clamp_propagation_hours(10**9) > 0


def test_orbit_line_width_stays_inside_the_fixed_visual_range():
    assert clamp_orbit_line_width("bad") == 2.5
    assert clamp_orbit_line_width(0) == 2.5
    assert clamp_orbit_line_width(232) == 5.0
    assert clamp_orbit_line_width(1) == 2.0
    assert normalize_system_config({"orbit": {"future_line_width": 232}})["orbit_future_line_width"] == 5.0


def test_nested_and_legacy_settings_normalize_to_one_shape():
    config = normalize_system_config({"orbit": {"propagation_hours": 4}, "satellite_label_size_px": 12, "max_satellites_visible": 100})
    assert config["propagation_hours"] == 4
    assert config["satellite_label_size_px"] == 12
    assert "max_satellites_visible" not in config


def test_retired_trail_configuration_is_not_exposed_to_runtime():
    config = normalize_system_config({
        "orbit": {
            "trail_show": False,
            "trail_color": "#123456",
            "trail_speed_seconds": 9,
            "trail_length_percent": 12,
            "trail_line_width": 4,
            "past_show": False,
        },
        "orbit_trail_show": False,
    })

    for key in (
        "orbit_trail_show",
        "orbit_trail_color",
        "orbit_trail_speed_seconds",
        "orbit_trail_length_percent",
        "orbit_trail_line_width",
    ):
        assert key not in config


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

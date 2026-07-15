"""Core configuration policy tests."""

from orbit_api.core.system_config import clamp_propagation_hours, normalize_system_config


def test_hours_are_clamped_and_invalid_values_use_default():
    assert clamp_propagation_hours("bad", 3) == 3
    assert clamp_propagation_hours(-1, 3) == 3
    assert clamp_propagation_hours(10**9) > 0


def test_nested_and_legacy_settings_normalize_to_one_shape():
    config = normalize_system_config({"orbit": {"propagation_hours": 4}, "satellite_label_size_px": 12})
    assert config["propagation_hours"] == 4
    assert config["satellite_label_size_px"] == 12

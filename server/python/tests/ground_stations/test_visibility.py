"""Ground-station geometry and pass extraction tests."""

import pytest
from orbit_api.ground_stations.visibility import (
    angular_separation_degrees,
    azimuth_degrees,
    azimuth_is_defined,
    azimuth_within_limits,
    channel_bandwidth_compatible,
    directional_pattern_loss_for_directions_db,
    elevation_degrees,
    extract_passes,
    slant_range_km,
)


def test_visibility_and_open_passes_are_calculated():
    assert elevation_degrees(0, 0, (6_778_137, 0, 0)) > 0
    passes = extract_passes([{"time": "a", "elevation_deg": 11}, {"time": "b", "elevation_deg": 20}], 10)
    assert passes == [{"aos": "a", "los": "b", "max_elevation_deg": 20.0, "max_elevation_time": "b"}]


def test_range_and_explicit_visibility_gate_can_exclude_an_elevated_sample():
    assert slant_range_km(0, 0, (6_778_137, 0, 0)) == 400.0
    passes = extract_passes([
        {"time": "a", "elevation_deg": 45, "range_km": 400, "visible": False},
        {"time": "b", "elevation_deg": 45, "range_km": 300, "visible": True},
    ], 10)
    assert passes == [{"aos": "b", "los": "b", "max_elevation_deg": 45.0, "max_elevation_time": "b"}]


def test_local_azimuth_and_wrapped_mechanical_limits_use_the_itrf_enu_frame():
    # At the equator/Greenwich, a positive y displacement is local east.
    assert azimuth_degrees(0, 0, (6_378_137, 1_000, 0)) == 90.0
    assert azimuth_within_limits(170, 150, -150)
    assert azimuth_within_limits(-170, 150, -150)
    assert not azimuth_within_limits(0, 150, -150)


def test_stationary_beam_separation_is_zero_at_boresight_and_grows_off_axis():
    assert angular_separation_degrees(0, 45, 0, 45) == 0
    assert angular_separation_degrees(90, 45, 0, 45) > 50


def test_enu_pattern_offsets_do_not_create_an_azimuth_singularity_at_zenith():
    assert not azimuth_is_defined(90)
    # Every azimuth label at zenith represents the same physical direction.
    assert angular_separation_degrees(0, 90, 137, 90) == pytest.approx(0, abs=1e-9)
    loss, separation = directional_pattern_loss_for_directions_db(
        "gaussian",
        8,
        8,
        25,
        0,
        90,
        137,
        90,
    )
    assert separation == pytest.approx(0, abs=1e-9)
    assert loss == pytest.approx(0, abs=1e-9)

    # Near zenith, a 90-degree *coordinate* azimuth difference is only a
    # small physical sky separation. The tangent-plane pattern must preserve
    # that geometry instead of flooring the gain as the old delta-azimuth
    # approximation did.
    near_zenith_loss, near_zenith_separation = directional_pattern_loss_for_directions_db(
        "gaussian",
        20,
        20,
        25,
        90,
        89,
        0,
        89,
    )
    assert near_zenith_separation < 2
    assert near_zenith_loss > -1


def test_channel_bandwidth_contract_uses_full_occupied_channel_width():
    assert channel_bandwidth_compatible(2_200_000_000, 200_000, 2_200_100_000, 400_000) is True
    assert channel_bandwidth_compatible(2_200_000_000, 200_000, 2_200_100_001, 400_000) is False
    assert channel_bandwidth_compatible(2_200_000_000, 200_000, 2_200_000_000, 100_000) is False
    assert channel_bandwidth_compatible(2_200_000_000, None, 2_200_000_000, 400_000) is None
    assert channel_bandwidth_compatible(float("nan"), 200_000, 2_200_000_000, 400_000) is None


def test_pass_boundaries_use_a_refined_transition_and_never_publish_an_invisible_los():
    samples = [
        {"time": "2026-01-01T00:00:00+00:00", "elevation_deg": 8, "visible": False},
        {"time": "2026-01-01T00:00:30+00:00", "elevation_deg": 12, "visible": True},
        {"time": "2026-01-01T00:01:00+00:00", "elevation_deg": 14, "visible": True},
        {"time": "2026-01-01T00:01:30+00:00", "elevation_deg": 8, "visible": False},
    ]

    def refine(before, after):
        return f"crossing:{before['time']}->{after['time']}"

    passes = extract_passes(samples, 10, refine_transition=refine)

    assert passes == [{
        "aos": "crossing:2026-01-01T00:00:00+00:00->2026-01-01T00:00:30+00:00",
        "los": "crossing:2026-01-01T00:01:00+00:00->2026-01-01T00:01:30+00:00",
        "max_elevation_deg": 14.0,
        "max_elevation_time": "2026-01-01T00:01:00+00:00",
    }]


def test_pass_without_a_refiner_keeps_the_last_visible_sample_as_los():
    passes = extract_passes([
        {"time": "a", "elevation_deg": 12, "visible": True},
        {"time": "b", "elevation_deg": 8, "visible": False},
    ], 10)

    assert passes == [{"aos": "a", "los": "a", "max_elevation_deg": 12.0, "max_elevation_time": "a"}]

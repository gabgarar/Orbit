"""Ground-station geometry and pass extraction tests."""

from orbit_api.ground_stations.visibility import elevation_degrees, extract_passes, slant_range_km


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

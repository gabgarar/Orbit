"""Orbit runtime service behaviour, isolated from filesystem and transport."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException

from orbit_api.application.orbit_runtime import OrbitRuntime


class FakePropagator:
    def propagate_datetime(self, _moment): return (1, 2, 3, 4, 5, 6)
    def propagate_offset(self, _offset): return (1, 2, 3, 4, 5, 6)


def test_runtime_resolves_loaded_and_rejects_unknown_satellites():
    runtime = OrbitRuntime()
    runtime._propagators_by_name = {"ISS": FakePropagator()}
    assert runtime.resolve_propagator("ISS", None, None)[0] == "ISS"
    with pytest.raises(HTTPException, match="not found"):
        runtime.resolve_propagator("UNKNOWN", None, None)


def test_ephemeris_contains_bounded_timestamped_points_and_is_cached():
    runtime, start = OrbitRuntime(), datetime(2026, 1, 1, tzinfo=UTC)
    result = runtime.build_ephemeris("ISS", FakePropagator(), start, start + timedelta(seconds=60), 30)
    assert result["count"] == 3 and result["points"][0]["position"]["x"] == 1
    assert runtime.build_ephemeris("ISS", FakePropagator(), start, start + timedelta(seconds=60), 30) is result
    with pytest.raises(HTTPException):
        runtime.build_ephemeris("ISS", FakePropagator(), start, start, 0)

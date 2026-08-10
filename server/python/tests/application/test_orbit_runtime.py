"""Orbit runtime service behaviour, isolated from filesystem and transport."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException

from orbit_api.application.orbit_runtime import OrbitRuntime
from orbit_api.frames import FrameId, FrameTransformService, StateVector
from orbit_api.orbits.propagators.sgp4.propagator import SGP4Propagator
from orbit_api.timekeeping import (
    EarthOrientation,
    LeapSecondTable,
    TimeScale,
    configure_default_leap_second_table,
    default_leap_second_table,
)


class FakePropagator:
    def propagate_datetime(self, _moment): return (1, 2, 3, 4, 5, 6)
    def propagate_offset(self, _offset): return (1, 2, 3, 4, 5, 6)


class NativeEme2000FakePropagator(FakePropagator):
    def native_state_at(self, moment):
        return StateVector.from_kilometres(
            epoch=moment,
            time_scale=TimeScale.UTC,
            frame=FrameId.EME2000,
            frame_realization=None,
            center="EARTH",
            position_km=(7, 8, 9),
            velocity_km_s=(10, 11, 12),
        )

    def state_at(self, moment, *, target_frame):
        assert target_frame is FrameId.ITRF
        return StateVector(
            epoch=moment,
            time_scale=TimeScale.UTC,
            frame=FrameId.ITRF,
            frame_realization="ITRF2020",
            center="EARTH",
            position_m=(1.0, 2.0, 3.0),
            velocity_m_s=(4.0, 5.0, 6.0),
            earth_orientation_source="test IERS",
            earth_orientation_version="fixture-1",
            earth_orientation_quality="final",
            transform_path=("EME2000", "CIRS", "TIRS", "ITRF"),
        )


class VisualEarthFixedFakePropagator(FakePropagator):
    """Native EME2000 source using the runtime's visual EOP fallback."""

    dynamics_reference_frame = "EME2000"

    def __init__(self, frame_transformer):
        self.frame_transformer = frame_transformer

    def native_state_at(self, moment):
        return StateVector.from_kilometres(
            epoch=moment,
            time_scale=TimeScale.UTC,
            frame=FrameId.EME2000,
            frame_realization=None,
            center="EARTH",
            position_km=(7000, 0, 0),
            velocity_km_s=(0, 7.5, 0),
        )

    def state_at(self, moment, *, target_frame):
        return self.frame_transformer.transform(
            self.native_state_at(moment),
            target_frame=target_frame,
        )

class MutableEopProvider:
    """Test double exposing a revision change without a network refresh."""

    def __init__(self):
        self.version = "fixture-r1"

    def at(self, moment):
        return EarthOrientation(
            source="test EOP",
            version=self.version,
            quality="final",
            sampled_at=moment,
        )


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
    # A tuple-only legacy propagator has no evidence for a particular ITRF
    # realization, so the runtime must not manufacture an `ITRF2020` label.
    assert result["reference_frame"] == "ITRF"
    assert result["frame"] == {"name": "ITRF", "realization": None, "center": "EARTH"}
    assert runtime.build_ephemeris("ISS", FakePropagator(), start, start + timedelta(seconds=60), 30) is result
    with pytest.raises(HTTPException):
        runtime.build_ephemeris("ISS", FakePropagator(), start, start, 0)


def test_constellation_reload_discards_ephemerides_for_the_previous_element_set(monkeypatch):
    runtime = OrbitRuntime()
    runtime._ephemeris_cache.set("old-tle", {"stale": True})
    monkeypatch.setattr("orbit_api.application.orbit_runtime.load_system_config", lambda: ({}, {"satellites_catalog_file": "catalog.json"}))
    monkeypatch.setattr("orbit_api.application.orbit_runtime.load_all_tles_from_config", lambda _path: [("ISS", "line1", "line2")])
    monkeypatch.setattr(runtime._propagator_registry, "create", lambda *_args: FakePropagator())

    runtime.load_constellation()

    assert runtime._ephemeris_cache.get("old-tle") is None


def test_ephemeris_cache_key_includes_the_versioned_eop_snapshot():
    provider = MutableEopProvider()
    runtime = OrbitRuntime(FrameTransformService(provider))
    start = datetime(2026, 1, 1, tzinfo=UTC)

    first = runtime.build_ephemeris("ISS", FakePropagator(), start, start + timedelta(seconds=30), 30)
    assert runtime.build_ephemeris("ISS", FakePropagator(), start, start + timedelta(seconds=30), 30) is first

    provider.version = "fixture-r2"
    refreshed = runtime.build_ephemeris("ISS", FakePropagator(), start, start + timedelta(seconds=30), 30)

    assert refreshed is not first
    token = refreshed["earth_orientation_cache_token"]
    assert token[0][:4] == ("eop", "test EOP", "fixture-r2", "final")
    assert token[0][4] == "leap_seconds"
    assert token[0] == token[1]


def test_ephemeris_cache_key_includes_the_active_leap_second_table():
    provider = MutableEopProvider()
    runtime = OrbitRuntime(FrameTransformService(provider))
    start = datetime(2026, 1, 1, tzinfo=UTC)
    previous = default_leap_second_table()
    first_table = LeapSecondTable(
        entries=((datetime(2017, 1, 1, tzinfo=UTC), 37),),
        source="test leap seconds",
        version="fixture-r1",
    )
    second_table = LeapSecondTable(
        entries=((datetime(2017, 1, 1, tzinfo=UTC), 37),),
        source="test leap seconds",
        version="fixture-r2",
    )
    try:
        configure_default_leap_second_table(first_table)
        first = runtime.build_ephemeris("ISS", FakePropagator(), start, start + timedelta(seconds=30), 30)
        configure_default_leap_second_table(second_table)
        refreshed = runtime.build_ephemeris("ISS", FakePropagator(), start, start + timedelta(seconds=30), 30)
    finally:
        configure_default_leap_second_table(previous)

    assert refreshed is not first
    assert refreshed["earth_orientation_cache_token"][0][-2:] == ("fixture-r2", None)


def test_serialized_native_epoch_keeps_its_declared_scale_while_timeline_time_is_utc():
    runtime = OrbitRuntime()
    utc_query = datetime(2026, 1, 1, tzinfo=UTC)
    # This is the calendar representation of the same physical instant in
    # GPS time. A future SP3 reader must not have it silently rewritten to
    # UTC while still labelling it GPS.
    gps_epoch = utc_query + timedelta(seconds=18)
    state = StateVector(
        epoch=gps_epoch,
        time_scale=TimeScale.GPS,
        frame=FrameId.ITRF,
        frame_realization="IGS20",
        center="EARTH",
        position_m=(1.0, 2.0, 3.0),
        velocity_m_s=(4.0, 5.0, 6.0),
    )

    payload = runtime.serialize_state("SP3", utc_query, state=state)

    assert payload["time"] == utc_query.isoformat()
    assert payload["epoch"] == gps_epoch.isoformat()
    assert payload["time_scale"] == "GPS"
    assert payload["reference_frame"] == "IGS20"


def test_native_ephemeris_serializes_explicit_eme2000_and_itrf2020_metadata():
    runtime, start = OrbitRuntime(), datetime(2026, 1, 1, tzinfo=UTC)
    result = runtime.build_ephemeris("Manual", NativeEme2000FakePropagator(), start, start + timedelta(seconds=30), 30)

    assert result["reference_frame"] == "ITRF2020"
    assert result["frame"] == {"name": "ITRF", "realization": "ITRF2020", "center": "EARTH"}
    assert result["time_scale"] == "UTC"
    assert result["native_samples_available"] is True
    assert result["eci_samples_available"] is True
    first_point = result["points"][0]
    assert first_point["time"] == start.isoformat()
    assert first_point["epoch"] == start.isoformat()
    assert first_point["reference_frame"] == "ITRF2020"
    assert first_point["earth_orientation"] == {
        "source": "test IERS",
        "version": "fixture-1",
        "quality": "final",
    }
    assert first_point["transform_path"] == ["EME2000", "CIRS", "TIRS", "ITRF"]
    first_native = first_point["native_state"]
    assert first_native == {
        "reference_frame": "EME2000",
        "frame": {"name": "EME2000", "realization": None, "center": "EARTH"},
        "epoch": start.isoformat(),
        "time_scale": "UTC",
        "position_units": "m",
        "velocity_units": "m/s",
        "position": {"x": 7000.0, "y": 8000.0, "z": 9000.0},
        "velocity": {"x": 10000.0, "y": 11000.0, "z": 12000.0},
    }
    # The `eci` property remains only as a labelled compatibility field for
    # current UI consumers; it must never claim the generic ECI frame.
    first_eci = first_point["eci"]
    assert first_eci == {**first_native, "legacy_field": True}


def test_visual_earth_fixed_renderer_is_qualified_without_relabelling_coordinates_as_precise_itrf():
    runtime = OrbitRuntime()
    start = datetime(2026, 1, 1, tzinfo=UTC)
    result = runtime.build_ephemeris(
        "Visual",
        VisualEarthFixedFakePropagator(runtime.frame_transformer),
        start,
        start,
        30,
    )

    # The coordinate array remains compatible with the existing Cesium ITRF
    # path, but the adjacent semantic contract makes the visual fallback
    # impossible to present as a rigorous terrestrial realization.
    assert result["reference_frame"] == "ITRF"
    assert result["native_reference_frame"] == "EME2000"
    renderer = result["renderer_reference"]
    assert renderer["status"] == "approximate_earth_fixed"
    assert renderer["display_label"] == "Earth-fixed (visual approximation)"
    orientation = renderer["earth_orientation"]
    assert orientation["required"] is True
    assert orientation["applied"] is True
    assert str(orientation["source"]).endswith("visual fallback")
    assert orientation["version"] == "zero-eop"
    assert orientation["quality"] == "approximate"
    assert orientation["snapshot_id"] is None
    assert result["points"][0]["renderer_reference"] == renderer


def test_position_only_ephemeris_keeps_itrf_positions_and_skips_frame_derivatives(monkeypatch):
    """Access planning must not pay for velocities it cannot consume."""

    runtime = OrbitRuntime()
    propagator = SGP4Propagator(
        "1 25544U 98067A   24001.00000000  .00000000  00000+0  00000+0 0  9991",
        "2 25544  51.6400  10.0000 0005000  30.0000 330.0000 15.50000000000000",
        frame_transformer=runtime.frame_transformer,
    )
    start = datetime(2024, 1, 1, tzinfo=UTC)
    end = start + timedelta(seconds=30)

    normal = runtime.build_ephemeris("ISS", propagator, start, end, 30, False)
    expected_position = normal["points"][0]["position"]

    calls = 0
    original_native_state_at = propagator.native_state_at

    def counted_native_state_at(moment):
        nonlocal calls
        calls += 1
        return original_native_state_at(moment)

    def derivative_must_not_run(*_args, **_kwargs):
        raise AssertionError("A position-only AOS/LOS ephemeris must not transform velocity")

    monkeypatch.setattr(propagator, "native_state_at", counted_native_state_at)
    monkeypatch.setattr(runtime.frame_transformer, "_matrix_derivatives", derivative_must_not_run)

    position_only = runtime.build_ephemeris("ISS", propagator, start, end, 30, False, True)

    assert position_only is not normal
    assert position_only["position_only"] is True
    assert position_only["points"][0]["position"] == pytest.approx(expected_position)
    assert "velocity" not in position_only["points"][0]
    assert "native_state" not in position_only["points"][0]
    # One native TEME evaluation per sample: the regular build used two when
    # it serialised both renderer and native views.
    assert calls == position_only["count"]

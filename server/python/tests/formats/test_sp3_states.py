"""Native SP3 state parsing and interpolation contracts."""

from datetime import UTC, datetime

import pytest
from orbit_api.formats import EphemerisFormatError, Sp3StateProvider, TimeScale
from orbit_api.frames import FrameTransformationError


def _sp3_header(*, frame: str = "IGS20", epochs: int = 2) -> str:
    return (
        "#cP"
        "2026 07 26 00 00 18.00000000"
        f" {epochs:7d} "
        f"{'ORBIT':<5} "
        f"{frame:<5} "
        f"{'FIT':<3} "
        f"{'COD':<4}"
    )


def _sp3_text(*, frame: str = "IGS20") -> str:
    return "\n".join(
        [
            _sp3_header(frame=frame),
            "%c cc GPS ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc",
            "*  2026 07 26 00 00 18.00000000",
            "PG01 7000.000000 0.000000 0.000000 0.000000",
            "VG01 10000.000000 0.000000 0.000000 0.000000",
            "*  2026 07 26 00 01 18.00000000",
            "PG01 7060.000000 0.000000 0.000000 0.000000",
            "VG01 10000.000000 0.000000 0.000000 0.000000",
        ]
    )


def _polynomial_sp3_text(*, epochs: int = 11) -> str:
    """A UTC SP3 whose x component is quadratic in elapsed minutes."""

    rows = [
        _sp3_header(frame="ITRF", epochs=epochs),
        "%c cc UTC ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc",
    ]
    for minute in range(epochs):
        rows.extend([
            f"*  2026 07 26 00 {minute:02d} 00.00000000",
            f"PG01 {7_000.0 + (minute * minute):.6f} 0.000000 0.000000 0.000000",
        ])
    return "\n".join(rows)


def test_sp3_provider_interpolates_in_native_gps_time_and_preserves_igs_realization():
    provider = Sp3StateProvider.from_text(_sp3_text())

    # 00:00:30 UTC is 00:00:48 GPS in 2026, exactly halfway through the
    # source samples. The output keeps the source GPS calendar/metadata.
    state = provider.native_state_at(datetime(2026, 7, 26, 0, 0, 30, tzinfo=UTC))

    assert provider.satellite_ids == ("G01",)
    assert state.time_scale is TimeScale.GPS
    assert state.epoch == datetime(2026, 7, 26, 0, 0, 48, tzinfo=UTC)
    assert state.frame == "IGS"
    assert state.frame_realization == "IGS20"
    assert state.center == "EARTH"
    assert state.position_m == pytest.approx((7_030_000.0, 0.0, 0.0))
    # SP3 V values are dm/s and are converted into SI m/s at ingestion.
    assert state.velocity_m_s == pytest.approx((1_000.0, 0.0, 0.0))
    assert state.provenance["coordinate_system"] == "IGS20"
    assert state.provenance["time_system"] == "GPS"
    assert state.provenance["tabular_interpolation"]["method"] == "LAGRANGE"
    assert state.provenance["tabular_interpolation"]["declared_degree"] == 1


def test_sp3_uses_bounded_lagrange_interpolation_instead_of_piecewise_linear_preview():
    provider = Sp3StateProvider.from_text(_polynomial_sp3_text())

    state = provider.native_state_at(datetime(2026, 7, 26, 0, 5, 30, tzinfo=UTC))

    # The x coordinate is 7000 + minute^2 km. At 5.5 minutes a linear
    # interpolation between the adjacent 5 and 6 minute samples would be
    # 7,030.5 km, while the bounded SP3 Lagrange window gives 7,030.25 km.
    assert state.position_m == pytest.approx((7_030_250.0, 0.0, 0.0))
    interpolation = state.provenance["tabular_interpolation"]
    assert interpolation["method"] == "LAGRANGE"
    assert interpolation["declared_degree"] == 9
    assert interpolation["sample_count"] == 10


def test_sp3_lagrange_window_is_bounded_at_both_coverage_edges_and_never_extrapolates():
    provider = Sp3StateProvider.from_text(_polynomial_sp3_text())

    near_start = provider.native_state_at(datetime(2026, 7, 26, 0, 0, 1, tzinfo=UTC))
    near_stop = provider.native_state_at(datetime(2026, 7, 26, 0, 9, 59, tzinfo=UTC))

    assert near_start.position_m[0] == pytest.approx(7_000_000.277777778)
    assert near_stop.position_m[0] == pytest.approx(7_099_666.944444444)
    assert near_start.provenance["tabular_interpolation"]["sample_count"] == 10
    assert near_stop.provenance["tabular_interpolation"]["sample_count"] == 10
    with pytest.raises(EphemerisFormatError, match="fuera de la cobertura"):
        provider.native_state_at(datetime(2026, 7, 25, 23, 59, 59, tzinfo=UTC))


def test_sp3_does_not_invent_an_igs_to_itrf_realization_transform():
    provider = Sp3StateProvider.from_text(_sp3_text())
    instant = datetime(2026, 7, 26, 0, 0, 30, tzinfo=UTC)

    native_view = provider.state_at(
        instant,
        target_frame="IGS",
        target_realization="IGS20",
    )
    assert native_view.frame == "IGS"
    assert native_view.frame_realization == "IGS20"

    with pytest.raises(FrameTransformationError, match="realizaci.n terrestre registrada"):
        provider.state_at(instant)


def test_sp3_igc20_is_preserved_and_is_not_silently_converted_to_itrf():
    provider = Sp3StateProvider.from_text(_sp3_text(frame="IGc20"))
    instant = datetime(2026, 7, 26, 0, 0, 30, tzinfo=UTC)

    native = provider.native_state_at(instant)

    assert native.frame == "IGS"
    assert native.frame_realization == "IGC20"
    assert native.provenance["coordinate_system"] == "IGC20"

    with pytest.raises(FrameTransformationError, match="realizaci.n terrestre registrada"):
        provider.state_at(instant)


def test_sp3_keeps_embedded_clock_and_clock_rate_outside_cartesian_velocity():
    provider = Sp3StateProvider.from_text(_sp3_text())

    clock = provider.clock_samples["G01"][0]

    assert provider.clock_sample_count == 2
    assert clock.bias_seconds == pytest.approx(0.0)
    assert clock.rate_seconds_per_second == pytest.approx(0.0)
    state = provider.native_state_at(datetime(2026, 7, 26, 0, 0, 30, tzinfo=UTC))
    assert state.velocity_m_s == pytest.approx((1_000.0, 0.0, 0.0))
    assert state.provenance["sp3_clock_bias_seconds"] == pytest.approx(0.0)

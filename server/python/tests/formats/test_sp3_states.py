"""Native SP3 state parsing and interpolation contracts."""

from datetime import UTC, datetime

import pytest

from orbit_api.formats import Sp3StateProvider, TimeScale
from orbit_api.frames import FrameTransformationError


def _sp3_header(*, frame: str = "IGS20") -> str:
    return (
        "#cP"
        "2026 07 26 00 00 18.00000000"
        f" {2:7d} "
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
    assert state.provenance["tabular_interpolation"]["method"] == "LINEAR"


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

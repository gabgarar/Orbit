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


def _sp3_header_orbit_accuracy_line(*exponents: str) -> str:
    """Make one fixed-width standard SP3 ``++`` header record for a test."""

    fields = [*exponents, *("0" for _ in range(17 - len(exponents)))]
    return "++" + (" " * 7) + "".join(f"{field:>3}" for field in fields)


def _sp3_with_header_orbit_accuracy_text(
    *,
    g01_exponent: str = "13",
    g02_exponent: str = "000",
) -> str:
    return "\n".join(
        [
            _sp3_header(frame="ITRF"),
            "+    2   G01G02",
            _sp3_header_orbit_accuracy_line(g01_exponent, g02_exponent),
            "%c cc UTC ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc",
            "*  2026 07 26 00 00 00.00000000",
            "PG01 7000.000000 0.000000 0.000000 0.000000",
            "PG02 8000.000000 0.000000 0.000000 0.000000",
            "*  2026 07 26 00 01 00.00000000",
            "PG01 7060.000000 0.000000 0.000000 0.000000",
            "PG02 8060.000000 0.000000 0.000000 0.000000",
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


def _strict_sparse_sp3_text() -> str:
    """A structurally-valid source whose three missing states are unsafe.

    The header/table remains continuous.  The intentionally sparse *usable*
    G01 series at the end makes the ninth-degree Lagrange window amplify
    errors beyond the upload policy's Lebesgue threshold.
    """

    rows = [
        _sp3_header(frame="ITRF", epochs=15),
        "## 0000 0 60.00000000 0 0",
        "+    1   G01",
        "%c cc UTC ccc ccc ccc",
    ]
    for minute in range(15):
        rows.append(f"*  2026 07 26 00 {minute:02d} 18.00000000")
        if minute in {11, 12, 13}:
            rows.append("PG01      0.000000      0.000000      0.000000 999999.999999")
        else:
            rows.append(
                f"PG01{7_000.0 + minute:14.6f}{0.0:14.6f}{0.0:14.6f}{0.0:14.6f}"
            )
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
    # The first source record is 00:00:18 GPS, i.e. 00:00:00 UTC in 2026.
    exact = provider.native_state_at(datetime(2026, 7, 26, 0, 0, tzinfo=UTC))
    assert exact.velocity_m_s == pytest.approx((1_000.0, 0.0, 0.0))
    assert exact.provenance["sp3_clock_bias_seconds"] == pytest.approx(0.0)

    interpolated = provider.native_state_at(datetime(2026, 7, 26, 0, 0, 30, tzinfo=UTC))
    assert "sp3_clock_bias_seconds" not in interpolated.provenance
    assert interpolated.provenance["tabular_interpolation"]["clock_observation"] == "not_interpolated"


def test_sp3_retains_declared_header_orbit_accuracy_with_its_file_wide_scope():
    provider = Sp3StateProvider.from_text(_sp3_with_header_orbit_accuracy_text())

    exact = provider.for_satellite("G01").samples[0]
    assert exact.provenance["sp3_header_orbit_accuracy_exponent"] == 13
    assert exact.provenance["sp3_header_orbit_accuracy_base"] == 2
    assert exact.provenance["sp3_header_orbit_sigma_mm"] == pytest.approx(8_192.0)
    assert exact.provenance["sp3_header_orbit_sigma_units"] == "mm"
    assert (
        exact.provenance["sp3_header_orbit_accuracy_scope"]
        == "file-wide satellite orbit one-standard-deviation"
    )

    # A zero exponent is the SP3 spelling for unknown accuracy, not 2^0 mm.
    g02 = provider.for_satellite("G02").samples[0]
    assert "sp3_header_orbit_sigma_mm" not in g02.provenance

    # The declaration remains source-level provenance when a Cartesian state
    # is interpolated; it is never converted into an invented row sigma.
    interpolated = provider.native_state_at(
        datetime(2026, 7, 26, 0, 0, 30, tzinfo=UTC),
        satellite_id="G01",
    )
    assert interpolated.provenance["sp3_header_orbit_sigma_mm"] == pytest.approx(8_192.0)
    assert interpolated.provenance["tabular_interpolation"]["method"] == "LAGRANGE"


def test_sp3_rejects_a_nonstandard_populated_header_orbit_accuracy_field():
    source = _sp3_with_header_orbit_accuracy_text(g01_exponent="1X3")

    with pytest.raises(EphemerisFormatError, match="exponente de exactitud"):
        Sp3StateProvider.from_text(source)


def test_sp3_skips_real_world_all_zero_position_records_as_missing_states():
    """CODE MGEX uses this spelling for one unavailable satellite epoch.

    The production COD0MGXFIN file contains ``PC08 0 0 0 999999.999999``.
    It must not turn into an Earth-centre state, because that value is neither
    a valid tabular orbit sample nor a position Cesium can project.
    """

    source = "\n".join(
        [
            _sp3_header(frame="IGb20", epochs=3),
            "%c M cc GPS ccc cccc",
            "*  2026 07 26 00 00 18.00000000",
            "PC08 12000.000000 13000.000000 14000.000000 0.000000",
            "*  2026 07 26 00 05 18.00000000",
            "PC08      0.000000      0.000000      0.000000 999999.999999",
            "*  2026 07 26 00 10 18.00000000",
            "PC08 12100.000000 13100.000000 14100.000000 0.000000",
        ]
    )

    provider = Sp3StateProvider.from_text(source)
    samples = provider.for_satellite("C08").samples

    assert len(samples) == 2
    assert samples[0].position_m == pytest.approx((12_000_000.0, 13_000_000.0, 14_000_000.0))
    assert samples[1].position_m == pytest.approx((12_100_000.0, 13_100_000.0, 14_100_000.0))


def test_strict_sp3_rejects_a_sparse_lagrange_window_with_excessive_amplification():
    with pytest.raises(EphemerisFormatError, match="amplifica demasiado los errores"):
        Sp3StateProvider.from_text(_strict_sparse_sp3_text(), strict_structure=True)

"""Safety boundaries for locally supplied IGS ERP v2 products."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from orbit_api.timekeeping import (
    ARCSECOND_TO_RADIAN,
    EarthOrientationCoverageError,
    EopSnapshotValidationError,
    IgsErpEarthOrientationProvider,
)


def _erp_text(*rows: str, header: str = "MJD Xpole Ypole UT1-UTC LOD") -> str:
    return "\n".join(("VERSION 2", header, *rows))


def test_igs_erp_mjd_times_are_utc_and_default_sampling_never_extrapolates():
    provider = IgsErpEarthOrientationProvider.from_text(
        _erp_text(
            "61247.25000 100000 -200000 2500000 10000",
            "61247.75000 300000  200000 4500000 30000",
        ),
        filename="fixture.erp",
    )
    coverage_start = datetime(2026, 7, 26, 6, tzinfo=UTC)
    coverage_stop = datetime(2026, 7, 26, 18, tzinfo=UTC)

    assert provider.samples[0].sampled_at == coverage_start
    assert provider.samples[-1].sampled_at == coverage_stop
    midpoint = provider.at(datetime(2026, 7, 26, 12, tzinfo=UTC))
    assert midpoint.dut1_seconds == pytest.approx(0.35)
    assert midpoint.xp_radians == pytest.approx(0.2 * ARCSECOND_TO_RADIAN)
    assert midpoint.yp_radians == pytest.approx(0.0)
    assert midpoint.lod_seconds == pytest.approx(0.002)

    with pytest.raises(EarthOrientationCoverageError, match="antes de la cobertura"):
        provider.at(coverage_start - timedelta(microseconds=1))
    with pytest.raises(EarthOrientationCoverageError, match="después de la cobertura"):
        provider.at(coverage_stop + timedelta(microseconds=1))


def test_igs_erp_prefers_ut1_utc_and_lod_over_their_rapid_fallback_columns():
    provider = IgsErpEarthOrientationProvider.from_text(
        _erp_text(
            "61247.00000 100000 -200000 1111111 2500000 90000 10000",
            header="MJD Xpole Ypole UT1R-UTC UT1-UTC LODR LOD",
        )
    )

    sample = provider.at(datetime(2026, 7, 26, tzinfo=UTC))

    assert sample.dut1_seconds == pytest.approx(0.25)
    assert sample.lod_seconds == pytest.approx(0.001)
    assert sample.xp_radians == pytest.approx(0.1 * ARCSECOND_TO_RADIAN)
    assert sample.yp_radians == pytest.approx(-0.2 * ARCSECOND_TO_RADIAN)


def test_igs_erp_accepts_exact_physical_limits_in_native_published_units():
    provider = IgsErpEarthOrientationProvider.from_text(
        _erp_text("61247.00000 1000000 -1000000 5000000 -100000")
    )

    sample = provider.at(datetime(2026, 7, 26, tzinfo=UTC))

    assert sample.xp_radians == pytest.approx(1.0 * ARCSECOND_TO_RADIAN)
    assert sample.yp_radians == pytest.approx(-1.0 * ARCSECOND_TO_RADIAN)
    assert sample.dut1_seconds == pytest.approx(0.5)
    assert sample.lod_seconds == pytest.approx(-0.01)


@pytest.mark.parametrize(
    ("column", "value"),
    [
        ("xp", "NaN"),
        ("yp", "Infinity"),
        ("dut1", "-Infinity"),
        ("lod", "NaN"),
    ],
)
def test_igs_erp_rejects_non_finite_native_values_before_unit_conversion(column: str, value: str):
    values = {
        "xp": "100000",
        "yp": "-200000",
        "dut1": "2500000",
        "lod": "10000",
    }
    values[column] = value
    source = _erp_text(
        "61247.00000 {xp} {yp} {dut1} {lod}".format(**values)
    )

    with pytest.raises(EopSnapshotValidationError, match="valores no finitos"):
        IgsErpEarthOrientationProvider.from_text(source)


def test_igs_erp_rejects_rows_before_the_supported_modern_mjd_range():
    source = _erp_text("29999.00000 100000 -200000 2500000 10000")

    with pytest.raises(EopSnapshotValidationError, match="no contiene registros"):
        IgsErpEarthOrientationProvider.from_text(source)

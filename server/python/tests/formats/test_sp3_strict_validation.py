"""Fail-closed contracts for strict SP3 product ingestion.

These fixtures are deliberately synthetic and compact.  They exercise the
same strict reader used at the upload boundary without relying on an external
catalogue, a local operator download, or the wall clock.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime, timedelta

import pytest
from orbit_api.formats import EphemerisFormatError, Sp3StateProvider, TimeScale


def _header(*, epoch_count: int, version: str = "c") -> str:
    return (
        f"#{version}P2026 07 26 00 00 00.00000000 {epoch_count:7d} "
        "ORBIT ITRF  FIT COD "
    )


def _epoch(minute: int) -> str:
    return f"*  2026 07 26 00 {minute:02d} 00.00000000"


def _position_record(
    satellite_id: str,
    x_km: float,
    y_km: float,
    z_km: float,
    clock_microseconds: float = 0.0,
) -> str:
    """Create a fixed-width SP3 P record for the strict parser."""

    return (
        f"P{satellite_id}{x_km:14.6f}{y_km:14.6f}{z_km:14.6f}"
        f"{clock_microseconds:14.6f}"
    )


def _strict_source(
    *,
    epoch_minutes: tuple[int, ...] = tuple(range(11)),
    declared_ids: tuple[str, ...] = ("G01",),
    header_epoch_count: int | None = None,
    missing_position: tuple[int, str] | None = None,
    sentinel_position: tuple[int, str] | None = None,
) -> str:
    """Return a structurally valid UTC SP3 with polynomial Cartesian data."""

    rows = [
        _header(epoch_count=header_epoch_count or len(epoch_minutes)),
        "## 0000 0 60.00000000 0 0",
        f"+ {len(declared_ids):4d}   {''.join(declared_ids)}",
        "%c M  cc UTC ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc",
    ]
    for minute in epoch_minutes:
        rows.append(_epoch(minute))
        for satellite_index, satellite_id in enumerate(declared_ids):
            if missing_position == (minute, satellite_id):
                continue
            if sentinel_position == (minute, satellite_id):
                rows.append(
                    _position_record(satellite_id, 0.0, 0.0, 0.0, 999_999.999999)
                )
                continue
            # Quadratic x and affine y/z let a degree-nine Lagrange window
            # reproduce known interior values while remaining well conditioned.
            rows.append(
                _position_record(
                    satellite_id,
                    7_000.0 + (minute * minute) + satellite_index,
                    100.0 + (2.0 * minute) + satellite_index,
                    -20.0 + (0.5 * minute) - satellite_index,
                )
            )
    return "\n".join(rows)


def test_strict_sp3_validation_report_proves_structure_and_lagrange_knot_contract():
    provider = Sp3StateProvider.from_text(_strict_source(), strict_structure=True)

    report = provider.validation

    assert report is not None
    assert report.declared_epoch_count == 11
    assert report.observed_epoch_count == 11
    assert report.declared_satellite_ids == ("G01",)
    assert report.header_cadence_seconds == pytest.approx(60.0)
    assert report.cadence_seconds == pytest.approx(60.0)
    assert report.usable_position_records == 11
    assert report.missing_sentinel_position_records == 0
    assert report.interpolation_method == "LAGRANGE"
    assert report.interpolation_max_degree == 9
    assert report.interpolation_checked_knot_count == 11
    assert report.interpolation_stability_window_count == 10
    assert report.interpolation_max_knot_error_m < report.interpolation_knot_tolerance_m
    assert report.interpolation_full_degree_satellite_count == 1

    # Query inside the table exercises the declared degree-nine interpolator,
    # rather than the exact source-knot fast path.
    state = provider.native_state_at(datetime(2026, 7, 26, 0, 5, 30, tzinfo=UTC))
    assert state.position_m == pytest.approx((7_030_250.0, 111_000.0, -17_250.0))
    interpolation = state.provenance["tabular_interpolation"]
    assert interpolation["method"] == "LAGRANGE"
    assert interpolation["declared_degree"] == 9
    assert interpolation["sample_count"] == 10


def test_strict_sp3_skips_sentinel_states_but_keeps_them_in_audit_counts():
    provider = Sp3StateProvider.from_text(
        _strict_source(
            epoch_minutes=(0, 1, 2),
            sentinel_position=(1, "G01"),
        ),
        strict_structure=True,
    )

    report = provider.validation
    samples = provider.for_satellite("G01").samples

    assert report is not None
    assert report.usable_position_records == 2
    assert report.missing_sentinel_position_records == 1
    assert report.interpolation_checked_knot_count == 2
    assert len(samples) == 2
    assert all(math.isfinite(component) for sample in samples for component in sample.position_m)
    assert all(sample.position_m != (0.0, 0.0, 0.0) for sample in samples)


def test_strict_sp3_counts_the_large_component_sentinel_without_creating_a_state():
    valid = _position_record("G01", 7_001.0, 102.0, -19.5)
    source = _strict_source(epoch_minutes=(0, 1, 2)).replace(
        valid,
        _position_record("G01", 999_999.999999, 0.0, 0.0, 999_999.999999),
        1,
    )

    provider = Sp3StateProvider.from_text(source, strict_structure=True)

    assert provider.validation is not None
    assert provider.validation.usable_position_records == 2
    assert provider.validation.missing_sentinel_position_records == 1
    assert len(provider.for_satellite("G01").samples) == 2


def test_strict_sp3_never_extrapolates_beyond_either_coverage_boundary():
    provider = Sp3StateProvider.from_text(_strict_source(), strict_structure=True)
    start = datetime(2026, 7, 26, tzinfo=UTC)
    stop = start + timedelta(minutes=10)

    with pytest.raises(EphemerisFormatError, match="fuera de la cobertura"):
        provider.native_state_at(start - timedelta(microseconds=1), time_scale=TimeScale.UTC)
    with pytest.raises(EphemerisFormatError, match="fuera de la cobertura"):
        provider.native_state_at(stop + timedelta(microseconds=1), time_scale=TimeScale.UTC)


def test_strict_sp3_rejects_a_header_epoch_count_mismatch():
    with pytest.raises(EphemerisFormatError, match="número de épocas SP3 no coincide"):
        Sp3StateProvider.from_text(
            _strict_source(epoch_minutes=(0, 1, 2), header_epoch_count=4),
            strict_structure=True,
        )


def test_strict_sp3_rejects_a_declared_satellite_count_that_does_not_match_its_list():
    source = _strict_source(epoch_minutes=(0, 1)).replace(
        "+    1   G01",
        "+    2   G01",
        1,
    )

    with pytest.raises(EphemerisFormatError, match="número de satélites SP3 no coincide"):
        Sp3StateProvider.from_text(source, strict_structure=True)


def test_strict_sp3_rejects_an_epoch_missing_a_declared_satellite_position():
    source = _strict_source(
        epoch_minutes=(0, 1),
        declared_ids=("G01", "G02"),
        missing_position=(1, "G02"),
    )

    with pytest.raises(EphemerisFormatError, match="satélites de una época SP3 no coinciden"):
        Sp3StateProvider.from_text(source, strict_structure=True)


def test_strict_sp3_rejects_a_cadence_jump_even_when_epoch_count_still_matches():
    source = _strict_source(epoch_minutes=(0, 1, 2)).replace(
        _epoch(2),
        _epoch(3),
        1,
    )

    with pytest.raises(EphemerisFormatError, match="salto de época"):
        Sp3StateProvider.from_text(source, strict_structure=True)


def test_strict_sp3_rejects_a_duplicate_or_non_increasing_epoch():
    source = _strict_source(epoch_minutes=(0, 1)).replace(_epoch(1), _epoch(0), 1)

    with pytest.raises(EphemerisFormatError, match="duplicadas o no crecientes"):
        Sp3StateProvider.from_text(source, strict_structure=True)


def test_strict_sp3_rejects_duplicate_position_records_for_one_epoch_and_satellite():
    source = _strict_source(epoch_minutes=(0, 1)) + "\n" + _position_record(
        "G01", 7_999.0, 1.0, 2.0
    )

    with pytest.raises(EphemerisFormatError, match="registro P duplicado"):
        Sp3StateProvider.from_text(source, strict_structure=True)


def test_strict_sp3_rejects_non_finite_cartesian_components():
    source = _strict_source(epoch_minutes=(0, 1)).replace(
        _position_record("G01", 7_000.0, 100.0, -20.0),
        _position_record("G01", float("nan"), 100.0, -20.0),
        1,
    )

    with pytest.raises(EphemerisFormatError, match="componentes no finitos"):
        Sp3StateProvider.from_text(source, strict_structure=True)


def test_strict_sp3_rejects_blank_fixed_width_cartesian_components():
    valid = _position_record("G01", 7_000.0, 100.0, -20.0)
    blank_y = f"PG01{7_000.0:14.6f}{'':14}{-20.0:14.6f}{0.0:14.6f}"
    source = _strict_source(epoch_minutes=(0, 1)).replace(valid, blank_y, 1)

    with pytest.raises(EphemerisFormatError, match="componente cartesiano vacío"):
        Sp3StateProvider.from_text(source, strict_structure=True)

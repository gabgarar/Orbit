"""RINEX CLK parsing contracts used by precise-product ingestion."""

from datetime import UTC, datetime

import pytest

from orbit_api.formats import EphemerisFormatError, TimeScale, parse_rinex_clock_product


def _clk_text(*, duplicate: bool = False) -> str:
    records = [
        "AS G01 2026 07 26 00 00 18.0000000  2  1.234567890D-04  2.0D-12",
        "AS E11 2026 07 26 00 00 18.0000000  3 -2.000000000D-05  3.0D-12  4.0D-15",
    ]
    if duplicate:
        records.append("AS G01 2026 07 26 00 00 18.0000000  1  1.000000000D-04")
    return "\n".join([
        "     3.04           C                   RINEX VERSION / TYPE",
        "GPS                                                         TIME SYSTEM ID",
        "                                                            END OF HEADER",
        *records,
    ])


def test_rinex_clk_preserves_time_system_and_satellite_clock_units():
    product = parse_rinex_clock_product(_clk_text())

    assert product.metadata.format_name == "CLK"
    assert product.metadata.version == "3.04"
    assert product.metadata.time_scale is TimeScale.GPS
    assert product.metadata.time_scale_label == "GPS"
    assert product.satellite_ids == ("G01", "E11")
    sample = product.samples_for_satellite("g01")[0]
    assert sample.epoch == datetime(2026, 7, 26, 0, 0, 18, tzinfo=UTC)
    assert sample.bias_seconds == pytest.approx(1.234567890e-4)
    assert sample.bias_sigma_seconds == pytest.approx(2e-12)
    assert sample.drift_seconds_per_second is None
    galileo = product.samples_for_satellite("E11")[0]
    assert galileo.drift_seconds_per_second == pytest.approx(4e-15)


def test_rinex_clk_rejects_duplicate_satellite_epochs():
    with pytest.raises(EphemerisFormatError, match="duplicadas"):
        parse_rinex_clock_product(_clk_text(duplicate=True))


def test_rinex_clk_requires_a_complete_header():
    with pytest.raises(EphemerisFormatError, match="END OF HEADER"):
        parse_rinex_clock_product("     3.04           C                   RINEX VERSION / TYPE")

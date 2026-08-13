"""Offline integrity contract for Orbit's packaged IERS leap-second data."""

from __future__ import annotations

import base64
from datetime import UTC, datetime
from pathlib import Path

import pytest
from orbit_api.application.precise_products import import_precise_product
from orbit_api.frames import FrameId, build_frame_transformer_from_environment
from orbit_api.timekeeping import (
    LeapSecondTable,
    LeapSecondTableExpiredError,
    configure_default_leap_second_table,
    default_leap_second_table,
)

_PROJECT_ROOT = Path(__file__).resolve().parents[4]
_BUNDLED_SNAPSHOT = _PROJECT_ROOT / "config" / "eop" / "leap-seconds.list"
_BUNDLED_SHA256 = "db5a895f16853b03bfc865e8d68f9fc8710ef1740e3400c701cd46a5bbbc3433"
_BUNDLED_VERSION = "IERS-Bulletin-C-72-2026-07-06"
_BUNDLED_SOURCE = "IERS Earth Orientation Center leap-seconds.list"


def test_bundled_iers_snapshot_is_pinned_current_and_fails_closed_at_its_horizon():
    """CI verifies the exact, network-free artifact Compose uses for GNSS ECI.

    Bulletin C 72 was issued on 2026-07-06.  Its ``#@ 4023129600`` horizon is
    2027-06-28T00:00:00Z, so the reference operational date (2026-08-12) is
    valid while an epoch at the horizon is deliberately rejected.
    """

    table = LeapSecondTable.from_file(
        _BUNDLED_SNAPSHOT,
        expected_sha256=_BUNDLED_SHA256,
        source=_BUNDLED_SOURCE,
        version=_BUNDLED_VERSION,
    )

    assert table.sha256 == _BUNDLED_SHA256
    assert table.source == _BUNDLED_SOURCE
    assert table.version == _BUNDLED_VERSION
    assert table.expires_at == datetime(2027, 6, 28, tzinfo=UTC)
    assert table.tai_minus_utc(datetime(2026, 8, 12, tzinfo=UTC)) == 37
    table.require_coverage(datetime(2026, 8, 12, tzinfo=UTC), require_unexpired=True)

    with pytest.raises(LeapSecondTableExpiredError, match="caduc"):
        table.require_coverage(datetime(2027, 6, 28, tzinfo=UTC), require_unexpired=True)


def _encoded_upload(name: str, source: str) -> tuple[str, str]:
    return name, base64.b64encode(source.encode("utf-8")).decode("ascii")


def _igb20_sp3() -> str:
    def record(x: float, y: float, z: float, clock: float) -> str:
        return f"PG01{x:14.6f}{y:14.6f}{z:14.6f}{clock:14.6f}"

    return "\n".join((
        "#cP2026 07 26 00 00 18.00000000       2 ORBIT IGb20 FIT COD ",
        "## 0000 0 60.00000000 0 0",
        "+    1   G01",
        "%c cc UTC ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc",
        "*  2026 07 26 00 00 18.00000000",
        record(7000.0, 100.0, -25.0, 0.123456),
        "*  2026 07 26 00 01 18.00000000",
        record(7060.0, 110.0, -20.0, 0.123457),
    ))


def _erp() -> str:
    return (
        "VERSION 2\n"
        "MJD Xpole Ypole UT1-UTC LOD\n"
        "61247.00000000 100000 -200000 2500000 10000\n"
        "61248.00000000 120000 -180000 2600000 11000"
    )


def test_bundled_snapshot_unblocks_only_the_audited_igb20_to_itrf2020_then_eci_route():
    """A real deployment path preserves the source frame instead of relabelling it.

    The exact bundled UTC-TAI data makes the time guard pass.  ECI still
    requires the paired ERP and the explicit IGS-family datum operation; its
    provenance must retain the actual `IGB20` source realization.
    """

    previous = default_leap_second_table()
    try:
        transformer = build_frame_transformer_from_environment({
            "ORBIT_LEAP_SECONDS_PATH": str(_BUNDLED_SNAPSHOT),
            "ORBIT_LEAP_SECONDS_SHA256": _BUNDLED_SHA256,
            "ORBIT_LEAP_SECONDS_SOURCE": _BUNDLED_SOURCE,
            "ORBIT_LEAP_SECONDS_VERSION": _BUNDLED_VERSION,
            "ORBIT_LEAP_SECONDS_REQUIRED": "true",
            "ORBIT_LEAP_SECONDS_REQUIRE_UNEXPIRED": "true",
            "ORBIT_TERRESTRIAL_REALIZATION": "ITRF2020",
            "ORBIT_ENABLE_IGS20_FAMILY_ITRF2020_ALIGNMENT": "true",
        })
        product = import_precise_product(
            (
                _encoded_upload("COD0MGXFIN_20262070000_01D_05M_ORB.SP3", _igb20_sp3()),
                _encoded_upload("COD0MGXFIN_20262070000_01D_ERP.ERP", _erp()),
            ),
            require_eci=True,
            frame_transformer=transformer,
        )

        assert product.payload()["native_reference_frame"] == "IGB20"
        assert product.eci_conversion_summary()["available"] is True
        inertial = product.eci_state_at("G01", datetime(2026, 7, 26, 0, 0, 18, tzinfo=UTC))
        assert inertial.frame is FrameId.EME2000
        datum = inertial.provenance["terrestrial_realization_transform"]
        assert datum["source_realization"] == "IGB20"
        assert datum["target_realization"] == "ITRF2020"
        assert datum["operation"] == "IGS20-family-ITRF2020-published-zero-datum-parameters"
    finally:
        configure_default_leap_second_table(previous)

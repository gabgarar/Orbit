"""Safety and provenance contracts for official IERS finals2000A support."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from orbit_api.timekeeping import (
    ARCSECOND_TO_RADIAN,
    IERS_FINALS2000A_URL,
    EopSnapshotValidationError,
    IersAutomaticEarthOrientationService,
    IersEopCacheService,
    IersFinals2000ACacheService,
    IersFinals2000AEarthOrientationProvider,
)


def _mjd(moment: datetime) -> float:
    return (moment - datetime(1858, 11, 17, tzinfo=UTC)).total_seconds() / 86_400.0


def _put(buffer: list[str], first: int, last: int, value: str) -> None:
    width = last - first + 1
    if len(value) > width:
        raise AssertionError(f"{value!r} exceeds fixed field {first}-{last}")
    buffer[first - 1:last] = list(value.rjust(width))


def _finals_row(
    moment: datetime,
    *,
    pm_flag: str = "I",
    ut1_flag: str = "I",
    nutation_flag: str = "I",
    xp: float = 0.12,
    yp: float = -0.23,
    dut1: float = 0.2,
    dx_arcsec: float = 0.001,
    dy_arcsec: float = -0.002,
    lod_seconds: float | None = -0.000711,
    bulletin_b: tuple[float, float, float, float, float] | None = None,
) -> str:
    """Build one documented fixed-width finals2000A line."""

    buffer = [" "] * 185
    year = moment.year % 100
    _put(buffer, 1, 2, f"{year:02d}")
    _put(buffer, 3, 4, f"{moment.month:02d}")
    _put(buffer, 5, 6, f"{moment.day:02d}")
    _put(buffer, 8, 15, f"{_mjd(moment):8.2f}")
    _put(buffer, 17, 17, pm_flag)
    _put(buffer, 19, 27, f"{xp:9.6f}")
    _put(buffer, 38, 46, f"{yp:9.6f}")
    _put(buffer, 58, 58, ut1_flag)
    _put(buffer, 59, 68, f"{dut1:10.7f}")
    if lod_seconds is not None:
        _put(buffer, 80, 86, f"{lod_seconds * 1_000.0:7.4f}")
    _put(buffer, 96, 96, nutation_flag)
    _put(buffer, 98, 106, f"{dx_arcsec * 1_000.0:9.3f}")
    _put(buffer, 117, 125, f"{dy_arcsec * 1_000.0:9.3f}")
    if bulletin_b is not None:
        b_xp, b_yp, b_dut1, b_dx_arcsec, b_dy_arcsec = bulletin_b
        _put(buffer, 135, 144, f"{b_xp:10.6f}")
        _put(buffer, 145, 154, f"{b_yp:10.6f}")
        _put(buffer, 155, 165, f"{b_dut1:11.7f}")
        _put(buffer, 166, 175, f"{b_dx_arcsec * 1_000.0:10.3f}")
        _put(buffer, 176, 185, f"{b_dy_arcsec * 1_000.0:10.3f}")
    return "".join(buffer)


def _finals(*rows: str) -> bytes:
    return ("# IERS official finals2000A.all fixture\n" + "\n".join(rows) + "\n").encode("ascii")


def _c01_row(moment: datetime, *, ut1_tai: float = -36.8) -> str:
    fields = [
        f"{_mjd(moment):.5f}",
        "0.120000",
        "-0.230000",
        f"{ut1_tai:.7f}",
        "0.010000",
        "-0.020000",
    ]
    fields.extend("0" for _ in range(15))
    fields.append("-0.0007110")
    return " ".join(fields)


def _c01(*rows: str) -> bytes:
    return (
        "COMB EARTH ROTATION DATA\n"
        "MJD PM-X PM-Y UT1-TAI DX DY XERR YERR UTERR DXERR DYERR C1 C2 C3 C4 C5 C6 C7 C8 XRT YRT LOD\n"
        + "\n".join(rows)
        + "\n"
    ).encode("ascii")


def test_finals_parser_prefers_complete_bulletin_b_tuple_and_preserves_optional_lod():
    epoch = datetime(2026, 8, 21, tzinfo=UTC)
    provider = IersFinals2000AEarthOrientationProvider.from_bytes(
        _finals(
            _finals_row(
                epoch,
                xp=0.12,
                bulletin_b=(0.22, -0.33, 0.1234567, 0.004, -0.005),
            )
        )
    )

    sample = provider.at(epoch)

    assert sample.quality == "final"
    assert sample.xp_radians == pytest.approx(0.22 * ARCSECOND_TO_RADIAN)
    assert sample.yp_radians == pytest.approx(-0.33 * ARCSECOND_TO_RADIAN)
    assert sample.dut1_seconds == pytest.approx(0.1234567)
    assert sample.dx_radians == pytest.approx(0.004 * ARCSECOND_TO_RADIAN)
    assert sample.dy_radians == pytest.approx(-0.005 * ARCSECOND_TO_RADIAN)
    assert sample.lod_seconds == pytest.approx(-0.000711)


def test_finals_parser_distinguishes_rapid_and_predicted_without_inventing_missing_lod():
    start = datetime(2026, 8, 21, tzinfo=UTC)
    provider = IersFinals2000AEarthOrientationProvider.from_bytes(
        _finals(
            _finals_row(start, lod_seconds=None),
            _finals_row(
                start + timedelta(days=1),
                pm_flag="P",
                ut1_flag="P",
                nutation_flag="P",
                xp=0.13,
                lod_seconds=None,
            ),
        )
    )

    assert provider.at(start).quality == "rapid"
    assert provider.at(start).lod_seconds is None
    # At an A quality boundary the interpolation remains conservatively
    # marked predicted instead of being relabelled merely "interpolated".
    assert provider.at(start + timedelta(hours=12)).quality == "predicted"
    assert provider.at(start + timedelta(days=1)).quality == "predicted"


def test_finals_parser_rejects_mismatched_calendar_date_and_mjd():
    epoch = datetime(2026, 8, 21, tzinfo=UTC)
    malformed = _finals_row(epoch)
    malformed = "99" + malformed[2:]

    with pytest.raises(EopSnapshotValidationError, match="fecha/MJD"):
        IersFinals2000AEarthOrientationProvider.from_bytes(_finals(malformed))


def test_finals_cache_keeps_valid_bytes_when_an_untrusted_refresh_is_rejected(tmp_path):
    now = datetime(2026, 8, 21, 12, tzinfo=UTC)
    cache = tmp_path / "finals2000A.all"
    original = _finals(
        _finals_row(now.replace(hour=0)),
        _finals_row(now.replace(hour=0) + timedelta(days=1), xp=0.13),
    )
    cache.write_bytes(original)
    stale = now - timedelta(days=8)
    import os

    os.utime(cache, (stale.timestamp(), stale.timestamp()))
    service = IersFinals2000ACacheService(cache, fetcher=lambda *_: b"not finals", now=lambda: now)

    status = service.refresh_if_needed()

    assert status.status == "warning"
    assert status.loaded is True
    assert status.using_cached_fallback is True
    assert cache.read_bytes() == original


def test_default_downloader_pins_finals_to_the_canonical_iers_endpoint_before_network_io():
    with pytest.raises(ValueError, match="URL oficial"):
        IersEopCacheService._download_https(
            "https://datacenter.iers.org/products/eop/rapid/standard/finals2000A.data",
            timeout_seconds=1.0,
            max_bytes=1_024,
        )
    # The exact canonical URL reaches the transport boundary rather than
    # being rejected as an unapproved source.  Do not perform I/O in this
    # unit test; the real-source parser smoke test is an opt-in CI check.
    assert IERS_FINALS2000A_URL.endswith("/finals2000A.all")


def test_composite_selects_c01_then_finals_then_bounded_linear_tail_then_nominal(tmp_path):
    now = datetime(2026, 8, 21, 12, tzinfo=UTC)
    c01 = _c01(
        _c01_row(now.replace(hour=0)),
        _c01_row(now.replace(hour=0) + timedelta(days=1), ut1_tai=-36.79),
    )
    finals_start = now.replace(hour=0) + timedelta(days=1)
    finals = _finals(
        _finals_row(finals_start, bulletin_b=(0.11, -0.21, 0.18, 0.001, -0.002)),
        _finals_row(finals_start + timedelta(days=1), bulletin_b=(0.12, -0.22, 0.19, 0.001, -0.002)),
        _finals_row(finals_start + timedelta(days=2), bulletin_b=(0.13, -0.23, 0.20, 0.001, -0.002)),
    )
    c01_requests: list[str] = []
    finals_requests: list[str] = []
    service = IersAutomaticEarthOrientationService(
        tmp_path / "EOP_C01_IAU2000_1846-now.txt",
        tmp_path / "finals2000A.all",
        c01_fetcher=lambda url, *_: c01_requests.append(url) or c01,
        finals_fetcher=lambda url, *_: finals_requests.append(url) or finals,
        now=lambda: now,
    )

    status = service.refresh_if_needed()

    assert status.status == "ok"
    assert c01_requests and c01_requests[0].endswith("EOP_C01_IAU2000_1846-now.txt")
    assert finals_requests == [IERS_FINALS2000A_URL]
    assert service.at(now).source.startswith("IERS (EOP_C01")
    assert service.at(finals_start + timedelta(days=1, hours=12)).source.startswith("IERS (finals2000A")
    tail_epoch = finals_start + timedelta(days=3)
    tail = service.at(tail_epoch)
    assert tail.quality == "extrapolated"
    assert tail.source.startswith("Orbit linear extrapolation")
    nominal = service.at(tail_epoch + timedelta(days=31))
    assert nominal.quality == "approximate"
    payload = service.diagnostics_payload()
    assert set(payload["sources"]) == {"c01", "finals2000A"}
    assert payload["selection"]["linearExtrapolationMaxDays"] == 30.0
    assert [item["kind"] for item in payload["coverageTimeline"]][-2:] == [
        "linear-extrapolation",
        "nominal-fallback",
    ]
    window = service.classify_window(finals_start + timedelta(days=2), tail_epoch + timedelta(days=31))
    assert window["outsideIersCoverage"] is True
    assert window["requiresLinearExtrapolation"] is True
    assert window["usesNominalFallback"] is True

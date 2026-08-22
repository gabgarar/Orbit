"""Safety contracts for the automatic public IERS C01 EOP cache."""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta

import pytest
from orbit_api.timekeeping import (
    ARCSECOND_TO_RADIAN,
    EopSnapshotValidationError,
    IersC01EarthOrientationProvider,
    IersEopCacheService,
    default_leap_second_table,
)


def _mjd(moment: datetime) -> float:
    return (moment - datetime(1858, 11, 17, tzinfo=UTC)).total_seconds() / 86_400.0


def _row(
    moment: datetime,
    *,
    xp: float = 0.12,
    yp: float = -0.23,
    ut1_tai: float = -36.8,
    dx: float = 0.01,
    dy: float = -0.02,
    lod: float = -0.000711,
) -> str:
    # C01 uses the documented 0=MJD ... 4=dX, 5=dY ... 21=LOD layout.
    fields = [
        f"{_mjd(moment):.5f}",
        f"{xp:.6f}",
        f"{yp:.6f}",
        f"{ut1_tai:.7f}",
        f"{dx:.6f}",
        f"{dy:.6f}",
    ]
    fields.extend("0" for _ in range(15))
    fields.append(f"{lod:.7f}")
    assert len(fields) == 22
    return " ".join(fields)


def _c01(*rows: str) -> bytes:
    return (
        "COMB EARTH ROTATION DATA\n"
        "MJD PM-X PM-Y UT1-TAI DX DY XERR YERR UTERR DXERR DYERR "
        "C1 C2 C3 C4 C5 C6 C7 C8 XRT YRT LOD DXRT DYRT\n"
        + "\n".join(rows)
        + "\n"
    ).encode("utf-8")


def test_c01_parser_converts_ut1_tai_with_the_local_leap_second_snapshot_and_preserves_lod_seconds():
    epoch = datetime(2026, 7, 26, tzinfo=UTC)

    provider = IersC01EarthOrientationProvider.from_bytes(_c01(_row(epoch)))
    sample = provider.at(epoch)

    # TAI-UTC is 37 s at this fixture epoch: -36.8 + 37 = DUT1 +0.2 s.
    assert sample.dut1_seconds == pytest.approx(0.2)
    assert sample.xp_radians == pytest.approx(0.12 * ARCSECOND_TO_RADIAN)
    assert sample.yp_radians == pytest.approx(-0.23 * ARCSECOND_TO_RADIAN)
    assert sample.dx_radians == pytest.approx(0.01 * ARCSECOND_TO_RADIAN)
    assert sample.dy_radians == pytest.approx(-0.02 * ARCSECOND_TO_RADIAN)
    # C01 field 21 is already seconds; dividing it by 1000 would be unsafe.
    assert sample.lod_seconds == pytest.approx(-0.000711)
    assert abs(sample.lod_seconds) < 0.001  # current/sample requirement: < 1 ms
    assert provider.snapshot_identity is not None
    assert provider.snapshot_identity.coverage_start == epoch


def test_c01_ignores_pre_modern_and_sentinel_rows_but_requires_modern_usable_coverage():
    modern = datetime(2026, 7, 26, tzinfo=UTC)
    # C01 reaches back to 1846, before the MJD epoch itself. These rows must
    # be ignored before UTC/TAI conversion rather than rejected by an
    # arbitrary modern-MJD lower bound.
    historical = datetime(1846, 1, 1, tzinfo=UTC)
    provider = IersC01EarthOrientationProvider.from_bytes(
        _c01(f"{_mjd(historical):.5f} 99.99", _row(modern))
    )

    assert len(provider.samples) == 1
    assert provider.samples[0].sampled_at == modern

    with pytest.raises(EopSnapshotValidationError, match="registros modernos utilizables"):
        IersC01EarthOrientationProvider.from_bytes(_c01(_row(historical, ut1_tai=99.99)))


def test_c01_continuity_is_checked_in_ut1_tai_so_a_tai_utc_leap_is_not_rejected():
    # UT1-TAI remains continuous across 2017-01-01 while the conversion to
    # DUT1 changes by one second due to TAI-UTC.  The C01 parser must accept
    # the official scale behaviour rather than comparing DUT1 directly.
    before = datetime(2016, 12, 31, tzinfo=UTC)
    after = datetime(2017, 1, 1, tzinfo=UTC)
    provider = IersC01EarthOrientationProvider.from_bytes(
        _c01(_row(before, ut1_tai=-36.2), _row(after, ut1_tai=-36.2))
    )

    assert provider.at(before).dut1_seconds == pytest.approx(-0.2)
    assert provider.at(after).dut1_seconds == pytest.approx(0.8)

    with pytest.raises(EopSnapshotValidationError, match="UT1-TAI"):
        IersC01EarthOrientationProvider.from_bytes(
            _c01(_row(before, ut1_tai=-36.8), _row(after, ut1_tai=-36.6))
        )


def test_c01_rejects_missing_header_or_physically_implausible_values():
    modern = datetime(2026, 7, 26, tzinfo=UTC)
    with pytest.raises(EopSnapshotValidationError, match="encabezado"):
        IersC01EarthOrientationProvider.from_bytes(_row(modern).encode("utf-8"))
    with pytest.raises(EopSnapshotValidationError, match="PM-X"):
        IersC01EarthOrientationProvider.from_bytes(_c01(_row(modern, xp=1.01)))
    with pytest.raises(EopSnapshotValidationError, match="LOD"):
        IersC01EarthOrientationProvider.from_bytes(_c01(_row(modern, lod=0.0101)))
    with pytest.raises(EopSnapshotValidationError, match="dX"):
        IersC01EarthOrientationProvider.from_bytes(_c01(_row(modern, dx=0.11)))


def test_cache_uses_fresh_valid_file_without_network_and_exposes_coverage(tmp_path):
    now = datetime(2026, 7, 26, 12, tzinfo=UTC)
    cache = tmp_path / "data" / "erp" / "EOP_C01_IAU2000_1846-now.txt"
    cache.parent.mkdir(parents=True)
    cache.write_bytes(_c01(_row(now.replace(hour=0)), _row(now.replace(hour=0) + timedelta(days=1), ut1_tai=-36.79)))
    os.utime(cache, (now.timestamp(), now.timestamp()))
    calls: list[object] = []
    service = IersEopCacheService(
        cache,
        fetcher=lambda *_: calls.append(object()) or b"unreachable",
        now=lambda: now,
    )

    status = service.refresh_if_needed()

    assert calls == []
    assert status.status == "ok"
    assert status.loaded is True
    assert status.coverage_start == now.replace(hour=0)
    assert service.at(now).dut1_seconds == pytest.approx(0.205)
    payload = service.diagnostics_payload()
    assert payload["coverage"] == {
        "start": now.replace(hour=0).isoformat(),
        "end": (now.replace(hour=0) + timedelta(days=1)).isoformat(),
    }


def test_fresh_cache_without_current_coverage_refreshes_from_iers(tmp_path):
    """A recent file mtime must not hide a C01 publication/coverage gap."""

    now = datetime(2026, 8, 21, 12, tzinfo=UTC)
    cache = tmp_path / "EOP_C01_IAU2000_1846-now.txt"
    cached = _c01(
        _row(now - timedelta(days=2)),
        _row(now - timedelta(days=1), ut1_tai=-36.79),
    )
    refreshed = _c01(
        _row(now.replace(hour=0)),
        _row(now.replace(hour=0) + timedelta(days=1), ut1_tai=-36.79),
    )
    cache.write_bytes(cached)
    # The bytes were freshly downloaded, but their last valid C01 sample is
    # still yesterday. This is the July/August operational failure mode.
    os.utime(cache, (now.timestamp(), now.timestamp()))
    downloads: list[object] = []
    service = IersEopCacheService(
        cache,
        fetcher=lambda *_: downloads.append(object()) or refreshed,
        now=lambda: now,
    )

    status = service.refresh_if_needed()

    assert len(downloads) == 1
    assert cache.read_bytes() == refreshed
    assert status.status == "ok"
    assert status.cache_fresh is True
    assert status.coverage_current is True
    assert status.refresh_due is False
    assert status.refresh_reasons == ()


def test_current_coverage_gap_is_reported_separately_when_iers_has_no_newer_c01(tmp_path):
    """Never relabel an IERS publication lag as a stale local cache."""

    now = datetime(2026, 8, 21, 12, tzinfo=UTC)
    cache = tmp_path / "EOP_C01_IAU2000_1846-now.txt"
    cached = _c01(
        _row(now - timedelta(days=33)),
        _row(now - timedelta(days=32), ut1_tai=-36.79),
    )
    cache.write_bytes(cached)
    os.utime(cache, (now.timestamp(), now.timestamp()))
    downloads: list[object] = []
    service = IersEopCacheService(
        cache,
        # The official endpoint may legitimately still publish the same
        # historical C01. It is validated but does not become current EOP.
        fetcher=lambda *_: downloads.append(object()) or cached,
        now=lambda: now,
    )

    status = service.refresh_if_needed()

    assert len(downloads) == 1
    assert status.status == "warning"
    assert status.cache_fresh is True
    assert status.coverage_current is False
    assert status.refresh_due is True
    assert status.refresh_reasons == ("coverage",)
    assert status.using_cached_fallback is False
    assert "fuente publicada" in (status.error or "")
    assert "termina el" in (status.error or "")
    assert "antigüedad máxima" not in (status.error or "")
    payload = service.diagnostics_payload()
    assert payload["cacheFresh"] is True
    assert payload["coverageCurrent"] is False
    assert payload["refreshReasons"] == ["coverage"]
    # Automatic C01 keeps its nominal fallback outside a factual coverage
    # window; product-bound precise ERP providers are not involved here.
    assert service.at(now).quality == "approximate"


def test_cache_age_and_coverage_gap_remain_distinct_after_failed_refresh(tmp_path):
    now = datetime(2026, 8, 21, 12, tzinfo=UTC)
    cache = tmp_path / "EOP_C01_IAU2000_1846-now.txt"
    cached = _c01(
        _row(now - timedelta(days=34)),
        _row(now - timedelta(days=33), ut1_tai=-36.79),
    )
    cache.write_bytes(cached)
    old_mtime = now - timedelta(days=8)
    os.utime(cache, (old_mtime.timestamp(), old_mtime.timestamp()))
    service = IersEopCacheService(
        cache,
        fetcher=lambda *_: (_ for _ in ()).throw(OSError("offline")),
        now=lambda: now,
    )

    status = service.refresh_if_needed()

    assert status.status == "warning"
    assert status.cache_fresh is False
    assert status.coverage_current is False
    assert status.refresh_due is True
    assert status.refresh_reasons == ("cache", "coverage")
    assert status.using_cached_fallback is True
    assert "antigüedad máxima" in (status.error or "")
    assert "termina el" in (status.error or "")


def test_invalid_fresh_local_cache_is_rejected_and_replaced_by_a_valid_download(tmp_path):
    """Cache age never substitutes for parsing the C01 snapshot at startup."""

    now = datetime(2026, 7, 26, 12, tzinfo=UTC)
    cache = tmp_path / "data" / "erp" / "EOP_C01_IAU2000_1846-now.txt"
    cache.parent.mkdir(parents=True)
    cache.write_bytes(b"this is not an IERS C01 snapshot\n")
    os.utime(cache, (now.timestamp(), now.timestamp()))
    replacement = _c01(
        _row(now.replace(hour=0)),
        _row(now.replace(hour=0) + timedelta(days=1), ut1_tai=-36.79),
    )
    downloads: list[object] = []
    service = IersEopCacheService(
        cache,
        fetcher=lambda *_: downloads.append(object()) or replacement,
        now=lambda: now,
    )

    status = service.refresh_if_needed()

    assert len(downloads) == 1
    assert status.status == "ok"
    assert status.loaded is True
    assert cache.read_bytes() == replacement


def test_stale_cache_falls_back_to_its_last_valid_snapshot_when_download_fails(tmp_path):
    now = datetime(2026, 7, 26, tzinfo=UTC)
    cache = tmp_path / "EOP_C01_IAU2000_1846-now.txt"
    original = _c01(_row(now), _row(now + timedelta(days=1), ut1_tai=-36.79))
    cache.write_bytes(original)
    stale = now - timedelta(days=8)
    os.utime(cache, (stale.timestamp(), stale.timestamp()))
    service = IersEopCacheService(
        cache,
        fetcher=lambda *_: (_ for _ in ()).throw(OSError("offline")),
        now=lambda: now,
    )

    status = service.refresh_if_needed()

    assert status.status == "warning"
    assert status.loaded is True
    assert status.using_cached_fallback is True
    assert "offline" in (status.error or "")
    assert cache.read_bytes() == original


def test_invalid_remote_bytes_never_replace_the_last_valid_cache(tmp_path):
    now = datetime(2026, 7, 26, tzinfo=UTC)
    cache = tmp_path / "EOP_C01_IAU2000_1846-now.txt"
    original = _c01(_row(now), _row(now + timedelta(days=1), ut1_tai=-36.79))
    cache.write_bytes(original)
    stale = now - timedelta(days=8)
    os.utime(cache, (stale.timestamp(), stale.timestamp()))
    service = IersEopCacheService(cache, fetcher=lambda *_: b"not an EOP file", now=lambda: now)

    status = service.refresh_if_needed()

    assert status.status == "warning"
    assert status.loaded is True
    assert cache.read_bytes() == original


def test_invalid_first_download_enters_error_without_creating_a_cache_file(tmp_path):
    now = datetime(2026, 7, 26, tzinfo=UTC)
    cache = tmp_path / "missing" / "EOP_C01_IAU2000_1846-now.txt"
    service = IersEopCacheService(cache, fetcher=lambda *_: b"not an EOP file", now=lambda: now)

    status = service.refresh_if_needed()

    assert status.status == "error"
    assert status.loaded is False
    assert cache.exists() is False


def test_cache_provider_is_never_updated_from_transform_lookup(tmp_path):
    cache = tmp_path / "EOP_C01_IAU2000_1846-now.txt"
    service = IersEopCacheService(cache, leap_seconds=default_leap_second_table())

    sample = service.at(datetime(2026, 7, 26, tzinfo=UTC))

    assert sample.quality == "approximate"
    assert cache.exists() is False


def test_default_downloader_refuses_noncanonical_urls_before_any_network_request():
    with pytest.raises(ValueError, match="URL oficial"):
        IersEopCacheService._download_https(
            "https://datacenter.iers.org/data/latestVersion/another-eop.txt",
            timeout_seconds=1.0,
            max_bytes=1024,
        )
    with pytest.raises(ValueError, match="host HTTPS oficial"):
        IersEopCacheService._download_https(
            "https://example.test/EOP_C01_IAU2000_1846-now.txt",
            timeout_seconds=1.0,
            max_bytes=1024,
        )

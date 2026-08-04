"""Contracts for the backend's standalone time-scale utilities."""

from datetime import UTC, datetime, timedelta, timezone
import hashlib

import pytest

from orbit_api.timekeeping import (
    LeapSecondTable,
    LeapSecondTableError,
    LeapSecondTableExpiredError,
    TimeScale,
    ensure_utc,
    from_utc,
    gmst_rad,
    julian_date,
    tai_minus_utc,
    tai_to_utc,
    to_utc,
    tt_to_utc,
    utc_to_tai,
    utc_to_tt,
    utc_to_ut1,
)
from orbit_api.timekeeping.configuration import load_leap_second_table_from_environment


def test_ensure_utc_preserves_instants_and_accepts_legacy_naive_values():
    naive = datetime(2026, 7, 26, 12, 30)
    madrid_offset = datetime(2026, 7, 26, 14, 30, tzinfo=timezone(timedelta(hours=2)))

    assert ensure_utc(naive) == datetime(2026, 7, 26, 12, 30, tzinfo=UTC)
    assert ensure_utc(madrid_offset) == datetime(2026, 7, 26, 12, 30, tzinfo=UTC)
    with pytest.raises(ValueError, match="fecha y hora"):
        ensure_utc("2026-07-26T12:30:00Z")


def test_ut1_requires_external_dut1_and_sidereal_time_uses_it():
    utc = datetime(2026, 7, 26, 12, tzinfo=UTC)
    ut1 = utc_to_ut1(utc, dut1_seconds=0.42)

    assert ut1 - utc == timedelta(seconds=0.42)
    assert julian_date(utc) == pytest.approx(2_461_248.0)
    assert gmst_rad(utc, dut1_seconds=0.42) != pytest.approx(gmst_rad(utc))
    with pytest.raises(ValueError, match="DUT1"):
        utc_to_ut1(utc, dut1_seconds=float("nan"))


def test_modern_utc_tai_tt_and_navigation_scale_round_trips_are_explicit():
    utc = datetime(2024, 1, 1, 12, tzinfo=UTC)

    assert tai_minus_utc(utc) == 37
    assert utc_to_tai(utc) == datetime(2024, 1, 1, 12, 0, 37, tzinfo=UTC)
    assert utc_to_tt(utc) == datetime(2024, 1, 1, 12, 1, 9, 184_000, tzinfo=UTC)
    assert tai_to_utc(utc_to_tai(utc)) == utc
    assert tt_to_utc(utc_to_tt(utc)) == utc

    for scale in (TimeScale.GPS, TimeScale.GAL, TimeScale.QZS, TimeScale.BDT, TimeScale.GLO):
        assert to_utc(from_utc(utc, scale), scale) == utc


def test_ut1_and_unknown_scales_are_never_silently_treated_as_utc():
    utc = datetime(2024, 1, 1, 12, tzinfo=UTC)
    ut1 = from_utc(utc, TimeScale.UT1, dut1_seconds=0.25)

    assert ut1 == utc + timedelta(seconds=0.25)
    assert to_utc(ut1, TimeScale.UT1, dut1_seconds=0.25) == utc
    assert TimeScale.from_label("GPST") is TimeScale.GPS
    assert TimeScale.from_label("unrecognised") is TimeScale.UNKNOWN
    with pytest.raises(ValueError, match="DUT1"):
        to_utc(ut1, TimeScale.UT1)
    with pytest.raises(ValueError, match="UNKNOWN|correlaci"):
        to_utc(utc, TimeScale.UNKNOWN)


def test_local_iers_leap_second_snapshot_is_pinned_and_can_drive_future_conversions(tmp_path):
    contents = (
        "# test IERS/NTP leap-seconds.list\n"
        "#@ 4039286400\n"
        "3692217600 37 # 1 Jan 2017\n"
        "4007750400 38 # 1 Jan 2027\n"
    ).encode("utf-8")
    snapshot = tmp_path / "leap-seconds.list"
    snapshot.write_bytes(contents)
    digest = hashlib.sha256(contents).hexdigest()

    table = LeapSecondTable.from_file(snapshot, expected_sha256=digest, version="fixture-2027")
    utc = datetime(2027, 1, 2, 12, tzinfo=UTC)

    assert table.sha256 == digest
    assert table.expires_at == datetime(2028, 1, 1, tzinfo=UTC)
    assert tai_minus_utc(utc, leap_seconds=table) == 38
    assert utc_to_tai(utc, leap_seconds=table) == datetime(2027, 1, 2, 12, 0, 38, tzinfo=UTC)
    assert utc_to_tt(utc, leap_seconds=table) == datetime(2027, 1, 2, 12, 1, 10, 184_000, tzinfo=UTC)
    assert to_utc(from_utc(utc, TimeScale.GPS, leap_seconds=table), TimeScale.GPS, leap_seconds=table) == utc
    table.require_current(datetime(2027, 7, 1, tzinfo=UTC))
    table.require_coverage(datetime(2027, 7, 1, tzinfo=UTC), require_unexpired=True)
    with pytest.raises(LeapSecondTableError, match="no cubre"):
        table.require_coverage(datetime(2016, 12, 31, 23, 59, 59, tzinfo=UTC))
    with pytest.raises(LeapSecondTableExpiredError, match="caduc"):
        table.require_current(datetime(2028, 1, 1, tzinfo=UTC))
    with pytest.raises(LeapSecondTableExpiredError, match="caduc"):
        table.require_coverage(datetime(2028, 1, 1, tzinfo=UTC), require_unexpired=True)
    with pytest.raises(LeapSecondTableError, match="SHA-256"):
        LeapSecondTable.from_file(snapshot, expected_sha256="0" * 64)


def test_leap_second_environment_configuration_is_local_and_can_require_validity(tmp_path):
    contents = (
        "#@ 4039286400\n"
        "3692217600 37 # 1 Jan 2017\n"
        "4007750400 38 # 1 Jan 2027\n"
    ).encode("utf-8")
    snapshot = tmp_path / "leap-seconds.list"
    snapshot.write_bytes(contents)
    environment = {
        "ORBIT_LEAP_SECONDS_PATH": str(snapshot),
        "ORBIT_LEAP_SECONDS_SHA256": hashlib.sha256(contents).hexdigest(),
        "ORBIT_LEAP_SECONDS_REQUIRE_UNEXPIRED": "true",
        "ORBIT_LEAP_SECONDS_VERSION": "fixture-2027",
    }

    table = load_leap_second_table_from_environment(environment, now=datetime(2027, 6, 1, tzinfo=UTC))

    assert table.version == "fixture-2027"
    with pytest.raises(LeapSecondTableExpiredError, match="caduc"):
        load_leap_second_table_from_environment(environment, now=datetime(2028, 1, 1, tzinfo=UTC))
    with pytest.raises(LeapSecondTableError, match="ORBIT_LEAP_SECONDS_PATH"):
        load_leap_second_table_from_environment({"ORBIT_LEAP_SECONDS_REQUIRED": "true"})
    with pytest.raises(LeapSecondTableError, match="ORBIT_LEAP_SECONDS_PATH"):
        load_leap_second_table_from_environment({"ORBIT_EOP_STRICT": "true"})
    no_expiry = tmp_path / "leap-seconds-without-expiry.list"
    no_expiry.write_text("3692217600 37 # 1 Jan 2017\n", encoding="utf-8")
    with pytest.raises(LeapSecondTableExpiredError, match="no declara"):
        load_leap_second_table_from_environment({
            "ORBIT_EOP_STRICT": "true",
            "ORBIT_LEAP_SECONDS_PATH": str(no_expiry),
        }, now=datetime(2027, 1, 1, tzinfo=UTC))

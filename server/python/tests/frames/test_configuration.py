"""Tests for deterministic runtime wiring of IERS snapshots."""

from __future__ import annotations

from datetime import UTC, datetime
import hashlib

import pytest

from orbit_api.frames import FrameId, FrameTransformationError, StateVector, build_frame_transformer_from_environment
from orbit_api.timekeeping import (
    LeapSecondTableError,
    LeapSecondTableExpiredError,
    configure_default_leap_second_table,
    default_leap_second_table,
)


def test_environment_wires_a_local_versioned_c04_snapshot(tmp_path):
    snapshot = tmp_path / "eopc04_202607.txt"
    snapshot.write_text(
        "2026 7 26 61247 0.120000 -0.230000 0.345000 0.0010 0.0100 -0.0200\n",
        encoding="utf-8",
    )
    leap_seconds = tmp_path / "leap-seconds.list"
    # A far-future test horizon keeps this fixture independent of the wall
    # clock while preserving the IERS/NTP #@ validation path.
    leap_contents = b"#@ 6311433600\n3692217600 37 # 1 Jan 2017\n"
    leap_seconds.write_bytes(leap_contents)
    previous = default_leap_second_table()
    try:
        service = build_frame_transformer_from_environment({
            "ORBIT_EOP_C04_PATH": str(snapshot),
            "ORBIT_EOP_C04_SHA256": hashlib.sha256(snapshot.read_bytes()).hexdigest(),
            "ORBIT_EOP_SOURCE": "IERS C04 fixture",
            "ORBIT_EOP_VERSION": "2026.07.26",
            "ORBIT_EOP_QUALITY": "final",
            "ORBIT_EOP_STRICT": "true",
            "ORBIT_LEAP_SECONDS_PATH": str(leap_seconds),
            "ORBIT_LEAP_SECONDS_SHA256": hashlib.sha256(leap_contents).hexdigest(),
            "ORBIT_TERRESTRIAL_REALIZATION": "ITRF2020",
        })

        eop = service.earth_orientation_at(datetime(2026, 7, 26, tzinfo=UTC))

        assert eop.dut1_seconds == 0.345
        assert eop.source == "IERS C04 fixture"
        assert eop.version == "2026.07.26"
        assert eop.quality == "final"
        assert eop.snapshot_id == f"sha256:{hashlib.sha256(snapshot.read_bytes()).hexdigest()}"
        assert service.default_terrestrial_realization == "ITRF2020"
        assert service.leap_second_table.sha256 == hashlib.sha256(leap_contents).hexdigest()
        assert default_leap_second_table().sha256 == hashlib.sha256(leap_contents).hexdigest()
        configured_table = service.leap_second_table
        configure_default_leap_second_table(previous)
        assert service.leap_second_table is configured_table
    finally:
        configure_default_leap_second_table(previous)


def test_default_runtime_does_not_invent_an_itrf_realization():
    service = build_frame_transformer_from_environment({})
    native = StateVector(
        epoch=datetime(2026, 7, 26, tzinfo=UTC),
        time_scale="UTC",
        frame=FrameId.TEME,
        frame_realization=None,
        center="EARTH",
        position_m=(7_000_000.0, 0.0, 0.0),
        velocity_m_s=(0.0, 7_500.0, 0.0),
    )

    transformed = service.transform(native, target_frame=FrameId.ITRF)

    assert transformed.frame is FrameId.ITRF
    assert transformed.frame_realization is None
    assert transformed.earth_orientation_quality == "approximate"


def test_strict_eop_configuration_fails_fast_for_missing_hash_or_coverage(tmp_path):
    with pytest.raises(ValueError, match="ORBIT_EOP_C04_PATH"):
        build_frame_transformer_from_environment({"ORBIT_EOP_STRICT": "true"})
    with pytest.raises(ValueError, match="ORBIT_EOP_C04_PATH"):
        build_frame_transformer_from_environment({"ORBIT_EOP_C04_REQUIRE_SHA256": "true"})
    with pytest.raises(ValueError, match="ORBIT_EOP_C04_PATH"):
        build_frame_transformer_from_environment({"ORBIT_EOP_C04_SHA256": "0" * 64})

    snapshot = tmp_path / "eopc04.txt"
    snapshot.write_text(
        "2026 7 26 61247 0.12 -0.23 0.345 0.001 0.01 -0.02\n"
        "2026 7 27 61248 0.13 -0.24 0.346 0.001 0.01 -0.02\n",
        encoding="utf-8",
    )
    base = {
        "ORBIT_EOP_C04_PATH": str(snapshot),
        "ORBIT_EOP_STRICT": "true",
        "ORBIT_EOP_C04_SHA256": hashlib.sha256(snapshot.read_bytes()).hexdigest(),
    }

    with pytest.raises(ValueError, match="C04_SHA256"):
        build_frame_transformer_from_environment({
            "ORBIT_EOP_C04_PATH": str(snapshot),
            "ORBIT_EOP_STRICT": "true",
        })
    with pytest.raises(ValueError, match="cubre ORBIT_EOP_REQUIRED_END"):
        build_frame_transformer_from_environment({
            **base,
            "ORBIT_EOP_REQUIRED_END": "2026-07-28T00:00:00Z",
        })
    with pytest.raises(ValueError, match="no admite"):
        build_frame_transformer_from_environment({
            **base,
            "ORBIT_EOP_ALLOW_EXTRAPOLATION": "true",
        })
    with pytest.raises(ValueError, match="final o rapid"):
        build_frame_transformer_from_environment({
            **base,
            "ORBIT_EOP_QUALITY": "predicted",
        })
    with pytest.raises(LeapSecondTableError, match="ORBIT_LEAP_SECONDS_PATH"):
        build_frame_transformer_from_environment(base)


def test_strict_configuration_validates_the_declared_window_against_leap_seconds(tmp_path):
    snapshot = tmp_path / "eopc04.txt"
    snapshot.write_text(
        "2026 7 26 61247 0.12 -0.23 0.345 0.001 0.01 -0.02\n"
        "2027 1 1 61406 0.13 -0.24 0.346 0.001 0.01 -0.02\n",
        encoding="utf-8",
    )
    base = {
        "ORBIT_EOP_C04_PATH": str(snapshot),
        "ORBIT_EOP_C04_SHA256": hashlib.sha256(snapshot.read_bytes()).hexdigest(),
        "ORBIT_EOP_STRICT": "true",
    }

    starts_too_late = b"#@ 6311433600\n4007750400 38 # 1 Jan 2027\n"
    late_snapshot = tmp_path / "late-leap-seconds.list"
    late_snapshot.write_bytes(starts_too_late)
    with pytest.raises(LeapSecondTableError, match="no cubre"):
        build_frame_transformer_from_environment({
            **base,
            "ORBIT_EOP_REQUIRED_START": "2026-07-26T00:00:00Z",
            "ORBIT_LEAP_SECONDS_PATH": str(late_snapshot),
            "ORBIT_LEAP_SECONDS_SHA256": hashlib.sha256(starts_too_late).hexdigest(),
        })

    expiring_contents = b"#@ 4007750400\n3692217600 37 # 1 Jan 2017\n"
    expiring_snapshot = tmp_path / "expiring-leap-seconds.list"
    expiring_snapshot.write_bytes(expiring_contents)
    with pytest.raises(LeapSecondTableExpiredError, match="caduc"):
        build_frame_transformer_from_environment({
            **base,
            "ORBIT_EOP_REQUIRED_END": "2027-01-01T00:00:00Z",
            "ORBIT_LEAP_SECONDS_PATH": str(expiring_snapshot),
            "ORBIT_LEAP_SECONDS_SHA256": hashlib.sha256(expiring_contents).hexdigest(),
        })


def test_igs20_itrf2020_alignment_is_an_explicit_orbit_datum_opt_in():
    with pytest.raises(ValueError, match="TERRESTRIAL_REALIZATION=ITRF2020"):
        build_frame_transformer_from_environment({
            "ORBIT_ENABLE_IGS20_ITRF2020_ALIGNMENT": "true",
        })

    service = build_frame_transformer_from_environment({
        "ORBIT_ENABLE_IGS20_ITRF2020_ALIGNMENT": "true",
        "ORBIT_TERRESTRIAL_REALIZATION": "ITRF2020",
    })
    source = StateVector(
        epoch=datetime(2026, 7, 26, tzinfo=UTC),
        time_scale="GPS",
        frame="IGS",
        frame_realization="IGS20",
        center="EARTH",
        position_m=(7_000_000.0, 200_000.0, -300_000.0),
        velocity_m_s=(-500.0, 7_500.0, 100.0),
    )

    transformed = service.transform(source, target_frame=FrameId.ITRF)

    assert transformed.frame is FrameId.ITRF
    assert transformed.frame_realization == "ITRF2020"
    assert transformed.position_m == source.position_m
    assert transformed.provenance["terrestrial_realization_transform"]["authority"] == "IGSMAIL-8238"

    without_opt_in = build_frame_transformer_from_environment({
        "ORBIT_TERRESTRIAL_REALIZATION": "ITRF2020",
    })
    with pytest.raises(FrameTransformationError, match="realizaci.n terrestre registrada"):
        without_opt_in.transform(source, target_frame=FrameId.ITRF)


def test_igs20_family_alignment_requires_an_explicit_itrf2020_policy_and_supports_igc20():
    with pytest.raises(ValueError, match="ITRF2020"):
        build_frame_transformer_from_environment({
            "ORBIT_ENABLE_IGS20_FAMILY_ITRF2020_ALIGNMENT": "true",
        })
    with pytest.raises(ValueError, match="no pueden activarse juntos"):
        build_frame_transformer_from_environment({
            "ORBIT_ENABLE_IGS20_ITRF2020_ALIGNMENT": "true",
            "ORBIT_ENABLE_IGS20_FAMILY_ITRF2020_ALIGNMENT": "true",
            "ORBIT_TERRESTRIAL_REALIZATION": "ITRF2020",
        })

    service = build_frame_transformer_from_environment({
        "ORBIT_ENABLE_IGS20_FAMILY_ITRF2020_ALIGNMENT": "true",
        "ORBIT_TERRESTRIAL_REALIZATION": "ITRF2020",
    })
    source = StateVector(
        epoch=datetime(2026, 7, 26, tzinfo=UTC),
        time_scale="GPS",
        frame="IGS",
        frame_realization="IGc20",
        center="EARTH",
        position_m=(7_000_000.0, 200_000.0, -300_000.0),
        velocity_m_s=(-500.0, 7_500.0, 100.0),
    )

    transformed = service.transform(source, target_frame=FrameId.ITRF)

    assert transformed.frame_realization == "ITRF2020"
    assert transformed.provenance["terrestrial_realization_transform"]["source_realization"] == "IGC20"

"""Segment-aware OEM state parsing and interpolation contracts."""

from datetime import UTC, datetime

import pytest

from orbit_api.formats import EphemerisFormatError, OemStateProvider, TimeScale
from orbit_api.frames import FrameId


def _oem_text() -> str:
    return """
CCSDS_OEM_VERS = 2.0
CREATION_DATE = 2026-07-26T00:00:00Z
ORIGINATOR = Orbit

META_START
OBJECT_NAME = TEST SATELLITE
OBJECT_ID = 2026-001A
CENTER_NAME = EARTH
REF_FRAME = ITRF2020
TIME_SYSTEM = UTC
START_TIME = 2026-07-26T00:00:00Z
STOP_TIME = 2026-07-26T00:01:00Z
INTERPOLATION = LAGRANGE
INTERPOLATION_DEGREE = 7
META_STOP
2026-07-26T00:00:00Z 7000.0 0.0 0.0 1.0 0.0 0.0
2026-07-26T00:01:00Z 7060.0 0.0 0.0 1.0 0.0 0.0

META_START
OBJECT_NAME = TEST SATELLITE
OBJECT_ID = 2026-001A
CENTER_NAME = EARTH
REF_FRAME = EME2000
TIME_SYSTEM = TAI
START_TIME = 2026-07-26T00:00:37
STOP_TIME = 2026-07-26T00:01:37
META_STOP
2026-07-26T00:00:37 8000.0 0.0 0.0 1.0 0.0 0.0
2026-07-26T00:01:37 8060.0 0.0 0.0 1.0 0.0 0.0
"""


def test_oem_provider_keeps_frame_realization_and_time_scale_per_segment():
    provider = OemStateProvider.from_text(_oem_text())
    instant = datetime(2026, 7, 26, 0, 0, 30, tzinfo=UTC)

    terrestrial = provider.native_state_at(datetime(2026, 7, 26, 0, 0, tzinfo=UTC), segment_index=0)
    inertial = provider.native_state_at(instant, segment_index=1)

    assert provider.segment_count == 2
    assert terrestrial.frame is FrameId.ITRF
    assert terrestrial.frame_realization == "ITRF2020"
    assert terrestrial.time_scale is TimeScale.UTC
    assert terrestrial.epoch == datetime(2026, 7, 26, 0, 0, tzinfo=UTC)
    assert terrestrial.position_m == pytest.approx((7_000_000.0, 0.0, 0.0))
    assert terrestrial.velocity_m_s == pytest.approx((1_000.0, 0.0, 0.0))
    assert terrestrial.provenance["declared_interpolation"] == "LAGRANGE"
    assert terrestrial.provenance["declared_interpolation_degree"] == 7

    # The OEM says LAGRANGE degree 7 and therefore needs eight state records.
    # A short segment must fail rather than fall back to a linear midpoint.
    with pytest.raises(EphemerisFormatError, match="LAGRANGE.*al menos 8"):
        provider.native_state_at(instant, segment_index=0)

    # 00:00:30 UTC is 00:01:07 TAI. The source epoch is deliberately kept in
    # TAI instead of being relabelled/re-written as a UTC timestamp.
    assert inertial.frame is FrameId.EME2000
    assert inertial.frame_realization is None
    assert inertial.time_scale is TimeScale.TAI
    assert inertial.epoch == datetime(2026, 7, 26, 0, 1, 7, tzinfo=UTC)
    assert inertial.position_m == pytest.approx((8_030_000.0, 0.0, 0.0))

    transformed = provider.state_at(instant, segment_index=1)
    assert transformed.frame is FrameId.ITRF
    assert transformed.time_scale is TimeScale.TAI
    assert transformed.epoch == inertial.epoch


def test_oem_provider_requires_a_segment_choice_when_metadata_changes():
    provider = OemStateProvider.from_text(_oem_text())

    with pytest.raises(EphemerisFormatError, match="segment_index"):
        provider.native_state_at(datetime(2026, 7, 26, 0, 0, 30, tzinfo=UTC))


def test_single_itrf_oem_segment_can_satisfy_the_common_state_at_contract():
    source = _oem_text().split("META_START", 2)[0] + """
META_START
OBJECT_NAME = TEST SATELLITE
OBJECT_ID = 2026-001A
CENTER_NAME = EARTH
REF_FRAME = ITRF2020
TIME_SYSTEM = UTC
META_STOP
2026-07-26T00:00:00Z 7000.0 0.0 0.0 1.0 0.0 0.0
2026-07-26T00:01:00Z 7060.0 0.0 0.0 1.0 0.0 0.0
"""
    provider = OemStateProvider.from_text(source)

    state = provider.state_at(datetime(2026, 7, 26, 0, 0, 30, tzinfo=UTC))

    assert state.frame is FrameId.ITRF
    assert state.frame_realization == "ITRF2020"
    assert state.time_scale is TimeScale.UTC


def test_oem_provider_rejects_local_covariance_frames_explicitly():
    source = _oem_text().split("META_START", 2)[0] + """
META_START
OBJECT_NAME = TEST SATELLITE
OBJECT_ID = 2026-001A
CENTER_NAME = EARTH
REF_FRAME = ITRF2020
TIME_SYSTEM = UTC
META_STOP
2026-07-26T00:00:00Z 7000.0 0.0 0.0 1.0 0.0 0.0
COVARIANCE_START
EPOCH = 2026-07-26T00:00:00Z
COV_REF_FRAME = RTN
1.0
0.0 1.0
0.0 0.0 1.0
0.0 0.0 0.0 1.0
0.0 0.0 0.0 0.0 1.0
0.0 0.0 0.0 0.0 0.0 1.0
COVARIANCE_STOP
"""

    with pytest.raises(EphemerisFormatError, match="RTN.*local"):
        OemStateProvider.from_text(source)


def test_oem_lagrange_interpolation_uses_declared_degree_without_linear_downgrade():
    source = """
CCSDS_OEM_VERS = 2.0
META_START
OBJECT_NAME = TEST
CENTER_NAME = EARTH
REF_FRAME = EME2000
TIME_SYSTEM = UTC
INTERPOLATION = LAGRANGE
INTERPOLATION_DEGREE = 2
META_STOP
2026-07-26T00:00:00Z 0.0 0.0 0.0 0.0 0.0 0.0
2026-07-26T00:01:00Z 3600.0 0.0 0.0 120.0 0.0 0.0
2026-07-26T00:02:00Z 14400.0 0.0 0.0 240.0 0.0 0.0
"""
    provider = OemStateProvider.from_text(source)

    state = provider.native_state_at(datetime(2026, 7, 26, 0, 0, 30, tzinfo=UTC))

    assert state.position_m == pytest.approx((900_000.0, 0.0, 0.0))
    assert state.velocity_m_s == pytest.approx((60_000.0, 0.0, 0.0))
    assert state.provenance["tabular_interpolation"]["method"] == "LAGRANGE"
    assert state.provenance["tabular_interpolation"]["sample_count"] == 3


def test_oem_hermite_uses_position_velocity_and_odd_polynomial_degree():
    source = """
CCSDS_OEM_VERS = 2.0
META_START
OBJECT_NAME = TEST
CENTER_NAME = EARTH
REF_FRAME = EME2000
TIME_SYSTEM = UTC
INTERPOLATION = HERMITE
INTERPOLATION_DEGREE = 3
META_STOP
2026-07-26T00:00:00Z 0.0 0.0 0.0 0.0 0.0 0.0
2026-07-26T00:01:00Z 3600.0 0.0 0.0 120.0 0.0 0.0
"""
    provider = OemStateProvider.from_text(source)

    state = provider.native_state_at(datetime(2026, 7, 26, 0, 0, 30, tzinfo=UTC))

    assert state.position_m == pytest.approx((900_000.0, 0.0, 0.0))
    assert state.velocity_m_s == pytest.approx((60_000.0, 0.0, 0.0))
    assert state.acceleration_m_s2 == pytest.approx((2_000.0, 0.0, 0.0))
    assert state.provenance["tabular_interpolation"]["method"] == "HERMITE"
    assert state.provenance["tabular_interpolation"]["sample_count"] == 2
    assert state.provenance["tabular_interpolation"]["derivative_constraints"] == "position_and_velocity"


def test_oem_covariance_is_expanded_to_si_and_attached_only_at_its_epoch():
    source = """
CCSDS_OEM_VERS = 2.0
META_START
OBJECT_NAME = TEST
CENTER_NAME = EARTH
REF_FRAME = EME2000
TIME_SYSTEM = UTC
META_STOP
2026-07-26T00:00:00Z 7000.0 0.0 0.0 1.0 0.0 0.0
2026-07-26T00:01:00Z 7060.0 0.0 0.0 1.0 0.0 0.0
COVARIANCE_START
COMMENT = covariance at the navigation solution epoch
EPOCH = 2026-07-26T00:00:00Z
1.0
2.0 3.0
4.0 5.0 6.0
7.0 8.0 9.0 10.0
11.0 12.0 13.0 14.0 15.0
16.0 17.0 18.0 19.0 20.0 21.0
COVARIANCE_STOP
"""
    provider = OemStateProvider.from_text(source)

    exact = provider.native_state_at(datetime(2026, 7, 26, 0, 0, tzinfo=UTC))
    interpolated = provider.native_state_at(datetime(2026, 7, 26, 0, 0, 30, tzinfo=UTC))
    record = provider.covariances()[0]

    assert record.declared_reference_frame is None
    assert record.reference_frame.label == "EME2000"
    assert record.comments == ("covariance at the navigation solution epoch",)
    assert exact.covariance is not None
    assert exact.covariance[0][0] == pytest.approx(1_000_000.0)
    assert exact.covariance[1][0] == pytest.approx(2_000_000.0)
    assert exact.covariance[0][1] == pytest.approx(2_000_000.0)
    assert exact.covariance[5][5] == pytest.approx(21_000_000.0)
    assert exact.provenance["oem_covariance"]["attached"] is True
    assert interpolated.covariance is None
    assert interpolated.provenance["oem_covariance"]["attached"] is False


def test_oem_converts_a_cartesian_covariance_to_the_segment_state_frame():
    source = """
CCSDS_OEM_VERS = 2.0
META_START
OBJECT_NAME = TEST
CENTER_NAME = EARTH
REF_FRAME = ITRF2020
TIME_SYSTEM = UTC
META_STOP
2026-07-26T00:00:00Z 7000.0 0.0 0.0 1.0 0.0 0.0
2026-07-26T00:01:00Z 7060.0 0.0 0.0 1.0 0.0 0.0
COVARIANCE_START
EPOCH = 2026-07-26T00:00:00Z
COV_REF_FRAME = EME2000
1.0
0.0 1.0
0.0 0.0 1.0
0.0 0.0 0.0 1.0
0.0 0.0 0.0 0.0 1.0
0.0 0.0 0.0 0.0 0.0 1.0
COVARIANCE_STOP
"""
    provider = OemStateProvider.from_text(source)

    state = provider.native_state_at(datetime(2026, 7, 26, 0, 0, tzinfo=UTC))

    assert state.covariance is not None
    assert state.provenance["oem_covariance"]["declared_reference_frame"] == "EME2000"
    assert state.provenance["oem_covariance"]["transformed_to_state_frame"] is True


def test_oem_version_2_preserves_optional_acceleration_in_si_units():
    source = """
CCSDS_OEM_VERS = 2.0
META_START
OBJECT_NAME = TEST
CENTER_NAME = EARTH
REF_FRAME = EME2000
TIME_SYSTEM = UTC
META_STOP
2026-07-26T00:00:00Z 7000.0 0.0 0.0 1.0 0.0 0.0 0.001 0.0 0.0
"""
    provider = OemStateProvider.from_text(source)

    state = provider.native_state_at(datetime(2026, 7, 26, 0, 0, tzinfo=UTC))

    assert state.acceleration_m_s2 == pytest.approx((1.0, 0.0, 0.0))


def test_oem_version_1_rejects_optional_acceleration():
    source = """
CCSDS_OEM_VERS = 1.0
META_START
OBJECT_NAME = TEST
CENTER_NAME = EARTH
REF_FRAME = EME2000
TIME_SYSTEM = UTC
META_STOP
2026-07-26T00:00:00Z 7000.0 0.0 0.0 1.0 0.0 0.0 0.001 0.0 0.0
"""

    with pytest.raises(EphemerisFormatError, match="aceleraciones.*2.0"):
        OemStateProvider.from_text(source)


def test_oem_rejects_an_incomplete_covariance_before_covariance_stop():
    source = """
CCSDS_OEM_VERS = 2.0
META_START
OBJECT_NAME = TEST
CENTER_NAME = EARTH
REF_FRAME = EME2000
TIME_SYSTEM = UTC
META_STOP
2026-07-26T00:00:00Z 7000.0 0.0 0.0 1.0 0.0 0.0
COVARIANCE_START
EPOCH = 2026-07-26T00:00:00Z
1.0
COVARIANCE_STOP
"""

    with pytest.raises(EphemerisFormatError, match="seis filas"):
        OemStateProvider.from_text(source)

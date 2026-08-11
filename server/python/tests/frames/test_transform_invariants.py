"""Numerical invariants for Earth-orientation frame transformations.

These tests deliberately check properties which do not depend on one selected
orbit or catalogue record.  They are a regression boundary around the IAU
2006/2000A + ERP reduction: a future implementation must remain a proper
rotation, preserve Euclidean geometry and keep its time/EOP lookup contract.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime, timedelta

import pytest
from orbit_api.frames import FrameId, FrameTransformService, StateVector, TimeScale
from orbit_api.timekeeping import (
    ARCSECOND_TO_RADIAN,
    EarthOrientation,
    EarthOrientationCoverageError,
    IgsErpEarthOrientationProvider,
    StaticEarthOrientationProvider,
)

_UTC_EPOCH = datetime(2024, 1, 1, 12, 34, 56, tzinfo=UTC)
_GPS_MINUS_UTC_SECONDS = 18
_MATRIX_TOLERANCE = 5.0e-12


def _orientation() -> EarthOrientation:
    """Return a non-zero final EOP fixture, including celestial offsets."""

    return EarthOrientation(
        dut1_seconds=0.1734,
        xp_radians=0.173 * ARCSECOND_TO_RADIAN,
        yp_radians=-0.221 * ARCSECOND_TO_RADIAN,
        dx_radians=0.041 * ARCSECOND_TO_RADIAN,
        dy_radians=-0.037 * ARCSECOND_TO_RADIAN,
        lod_seconds=0.00082,
        source="ERP invariant fixture",
        version="2024.001",
        quality="final",
    )


def _state(
    *,
    epoch: datetime = _UTC_EPOCH,
    time_scale: TimeScale = TimeScale.UTC,
    covariance: tuple[tuple[float, ...], ...] | None = None,
) -> StateVector:
    return StateVector(
        epoch=epoch,
        time_scale=time_scale,
        frame=FrameId.ITRF,
        frame_realization="ITRF2020",
        center="EARTH",
        position_m=(6_702_345.678, -1_923_456.789, 2_783_210.987),
        velocity_m_s=(1_824.5, 6_931.25, -2_047.75),
        acceleration_m_s2=(-5.8, 1.2, 3.7),
        covariance=covariance,
    )


def _matmul(left: tuple[tuple[float, ...], ...], right: tuple[tuple[float, ...], ...]) -> tuple[tuple[float, ...], ...]:
    return tuple(
        tuple(sum(left[row][index] * right[index][column] for index in range(len(right))) for column in range(len(right[0])))
        for row in range(len(left))
    )


def _transpose(matrix: tuple[tuple[float, ...], ...]) -> tuple[tuple[float, ...], ...]:
    return tuple(tuple(matrix[column][row] for column in range(len(matrix))) for row in range(len(matrix[0])))


def _determinant(matrix: tuple[tuple[float, float, float], ...]) -> float:
    return (
        matrix[0][0] * ((matrix[1][1] * matrix[2][2]) - (matrix[1][2] * matrix[2][1]))
        - matrix[0][1] * ((matrix[1][0] * matrix[2][2]) - (matrix[1][2] * matrix[2][0]))
        + matrix[0][2] * ((matrix[1][0] * matrix[2][1]) - (matrix[1][1] * matrix[2][0]))
    )


def _assert_identity(matrix: tuple[tuple[float, ...], ...], *, tolerance: float = _MATRIX_TOLERANCE) -> None:
    for row in range(len(matrix)):
        for column in range(len(matrix[row])):
            assert matrix[row][column] == pytest.approx(1.0 if row == column else 0.0, abs=tolerance)


@pytest.mark.parametrize("utc", (_UTC_EPOCH, _UTC_EPOCH + timedelta(days=183, seconds=19)))
def test_iau_earth_orientation_matrices_are_orthonormal_proper_inverse_rotations(utc: datetime):
    """The ERP-backed ITRF/EME2000 matrices must be rotations, never a scale/reflection."""

    service = FrameTransformService()
    orientation = _orientation()

    forward = service._matrix_between(FrameId.ITRF, FrameId.EME2000, utc, orientation)
    reverse = service._matrix_between(FrameId.EME2000, FrameId.ITRF, utc, orientation)

    _assert_identity(_matmul(_transpose(forward), forward))
    _assert_identity(_matmul(reverse, forward))
    assert _determinant(forward) == pytest.approx(1.0, abs=_MATRIX_TOLERANCE)


def test_itrf_eme2000_round_trip_preserves_state_geometry_and_covariance():
    """A forward/reverse reduction retains state components within numerical tolerance."""

    covariance = tuple(
        tuple((index + 1) * 1_000_000.0 if row == column else 0.0 for column in range(6))
        for row, index in enumerate(range(6))
    )
    native = _state(covariance=covariance)
    service = FrameTransformService()
    orientation = _orientation()

    inertial = service.transform(native, target_frame=FrameId.EME2000, earth_orientation=orientation)
    restored = service.transform(
        inertial,
        target_frame=FrameId.ITRF,
        target_realization="ITRF2020",
        earth_orientation=orientation,
    )

    assert math.hypot(*inertial.position_m) == pytest.approx(math.hypot(*native.position_m), rel=1e-12, abs=1e-6)
    assert restored.position_m == pytest.approx(native.position_m, abs=2e-6)
    assert restored.velocity_m_s == pytest.approx(native.velocity_m_s, abs=5e-6)
    assert restored.acceleration_m_s2 == pytest.approx(native.acceleration_m_s2, abs=2e-5)
    assert restored.covariance is not None
    for row in range(6):
        for column in range(6):
            assert restored.covariance[row][column] == pytest.approx(covariance[row][column], abs=5e-2)
            assert inertial.covariance is not None
            assert inertial.covariance[row][column] == pytest.approx(inertial.covariance[column][row], abs=1e-8)


def test_velocity_and_acceleration_match_centered_differences_of_rotated_positions():
    """The 6D Jacobian terms agree with the frame matrix's time evolution."""

    orientation = _orientation()
    service = FrameTransformService(
        eop_provider=StaticEarthOrientationProvider(orientation),
        strict_eop=True,
    )
    native = StateVector(
        epoch=_UTC_EPOCH,
        time_scale=TimeScale.UTC,
        frame=FrameId.ITRF,
        frame_realization="ITRF2020",
        center="EARTH",
        # A point stationary in ITRF obtains velocity/acceleration solely
        # from Earth rotation in the inertial frame.
        position_m=(6_702_345.678, -1_923_456.789, 2_783_210.987),
        velocity_m_s=(0.0, 0.0, 0.0),
        acceleration_m_s2=(0.0, 0.0, 0.0),
    )
    step_seconds = 0.5
    before = service.transform(
        StateVector(
            epoch=native.epoch - timedelta(seconds=step_seconds),
            time_scale=native.time_scale,
            frame=native.frame,
            frame_realization=native.frame_realization,
            center=native.center,
            position_m=native.position_m,
            velocity_m_s=native.velocity_m_s,
            acceleration_m_s2=native.acceleration_m_s2,
        ),
        target_frame=FrameId.EME2000,
    )
    current = service.transform(native, target_frame=FrameId.EME2000)
    after = service.transform(
        StateVector(
            epoch=native.epoch + timedelta(seconds=step_seconds),
            time_scale=native.time_scale,
            frame=native.frame,
            frame_realization=native.frame_realization,
            center=native.center,
            position_m=native.position_m,
            velocity_m_s=native.velocity_m_s,
            acceleration_m_s2=native.acceleration_m_s2,
        ),
        target_frame=FrameId.EME2000,
    )

    expected_velocity = tuple(
        (after.position_m[index] - before.position_m[index]) / (2.0 * step_seconds)
        for index in range(3)
    )
    expected_acceleration = tuple(
        (after.position_m[index] - (2.0 * current.position_m[index]) + before.position_m[index]) / (step_seconds ** 2)
        for index in range(3)
    )

    assert current.velocity_m_s == pytest.approx(expected_velocity, abs=2e-8)
    assert current.acceleration_m_s2 == pytest.approx(expected_acceleration, abs=2e-8)


def test_gps_epoch_uses_utc_equivalent_erp_epoch_and_rejects_coverage_overrun():
    """The ERP lookup follows GPS→UTC exactly and has inclusive coverage edges."""

    provider = IgsErpEarthOrientationProvider.from_text(
        "VERSION 2\n"
        "MJD Xpole Ypole UT1-UTC LOD\n"
        "60310.00000000 173000 -221000 1734000 8200\n"
        "60311.00000000 174000 -220000 1735000 8300",
        filename="IGS0OPSFIN_20240010000_01D_ERP.ERP",
        quality="final",
    )
    service = FrameTransformService(eop_provider=provider, strict_eop=True)
    coverage_start = datetime(2024, 1, 1, tzinfo=UTC)
    coverage_end = coverage_start + timedelta(days=1)
    gps_start = coverage_start + timedelta(seconds=_GPS_MINUS_UTC_SECONDS)
    gps_end = coverage_end + timedelta(seconds=_GPS_MINUS_UTC_SECONDS)

    at_start = service.transform(_state(epoch=gps_start, time_scale=TimeScale.GPS), target_frame=FrameId.EME2000)
    at_end = service.transform(_state(epoch=gps_end, time_scale=TimeScale.GPS), target_frame=FrameId.EME2000)

    # Source timestamps remain GPS in emitted state metadata even though EOP
    # lookup occurred in UTC. The exact ERP endpoint is accepted at both ends.
    assert at_start.epoch == gps_start
    assert at_start.time_scale is TimeScale.GPS
    assert at_start.earth_orientation_source == "IGS ERP"
    assert at_start.earth_orientation_snapshot_id == provider.snapshot_identity.content_id
    assert at_end.epoch == gps_end
    with pytest.raises(EarthOrientationCoverageError, match="cobertura"):
        service.transform(
            _state(epoch=gps_start - timedelta(microseconds=1), time_scale=TimeScale.GPS),
            target_frame=FrameId.EME2000,
        )
    with pytest.raises(EarthOrientationCoverageError, match="cobertura"):
        service.transform(
            _state(epoch=gps_end + timedelta(microseconds=1), time_scale=TimeScale.GPS),
            target_frame=FrameId.EME2000,
        )


def test_ut1_epoch_iterates_through_dut1_before_selecting_the_final_eop_sample():
    """UTC is solved from UT1 using DUT1 rather than treating UT1 labels as UTC."""

    utc = datetime(2024, 1, 1, 0, 0, tzinfo=UTC)
    dut1_seconds = 0.347
    provider = StaticEarthOrientationProvider(
        EarthOrientation(
            dut1_seconds=dut1_seconds,
            source="UT1 invariant fixture",
            version="r1",
            quality="final",
        )
    )
    service = FrameTransformService(eop_provider=provider, strict_eop=True)
    # This calendar value is UT1; it must map back to the UTC instant above.
    state = _state(epoch=utc + timedelta(seconds=dut1_seconds), time_scale=TimeScale.UT1)

    resolved_utc, resolved_orientation = service._utc_and_orientation(state, explicit=None)

    assert resolved_utc == utc
    assert resolved_orientation.sampled_at == utc
    transformed = service.transform(state, target_frame=FrameId.EME2000)
    assert transformed.epoch == state.epoch
    assert transformed.time_scale is TimeScale.UT1
    assert transformed.earth_orientation_source == "UT1 invariant fixture"

"""Independent SOFA/ERFA reference checks for Orbit's Earth-frame chain.

The production transform uses pyerfa, but these tests deliberately assemble
the reference reduction through different SOFA entry points.  This catches
errors in time-scale handling, matrix order, EOP corrections and the EME2000
frame-bias branch rather than merely testing that a matrix is orthonormal.

``pyerfa`` is a runtime dependency of the precise ITRF/ECI route.  If a
minimal developer shell omits it, pytest marks this module skipped: Orbit's
GMST fallback is intentionally not presented as an IAU 2006/2000A result, so
there is no scientifically equivalent local fallback against which to compare.
The published SOFA C2T06A fixture below remains the documented baseline.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from orbit_api.frames import FrameId, FrameTransformService, StateVector, TimeScale
from orbit_api.timekeeping import ARCSECOND_TO_RADIAN, EarthOrientation

erfa = pytest.importorskip("erfa", reason="Las pruebas diferenciales IAU 2006/2000A requieren pyerfa/ERFA")


def _orientation() -> EarthOrientation:
    """A non-zero, final-quality EOP sample exercising every correction."""

    return EarthOrientation(
        dut1_seconds=0.1734,
        xp_radians=0.173 * ARCSECOND_TO_RADIAN,
        yp_radians=-0.221 * ARCSECOND_TO_RADIAN,
        dx_radians=0.041 * ARCSECOND_TO_RADIAN,
        dy_radians=-0.037 * ARCSECOND_TO_RADIAN,
        source="ERFA differential fixture",
        version="2024.001",
        quality="final",
    )


def _erfa_time_parts(utc: datetime, orientation: EarthOrientation) -> tuple[float, float, float, float]:
    """Obtain TT and UT1 directly from ERFA, independently of Orbit's helpers."""

    second = utc.second + (utc.microsecond / 1_000_000.0)
    utc1, utc2 = erfa.dtf2d("UTC", utc.year, utc.month, utc.day, utc.hour, utc.minute, second)
    tai1, tai2 = erfa.utctai(utc1, utc2)
    tt1, tt2 = erfa.taitt(tai1, tai2)
    ut11, ut12 = erfa.utcut1(utc1, utc2, orientation.dut1_seconds)
    return float(tt1), float(tt2), float(ut11), float(ut12)


def _reference_gcrf_to_itrf(utc: datetime, orientation: EarthOrientation):
    """Compose the IAU chain via C2IXY/C2TCIO, not Orbit's C2TXY call."""

    tt1, tt2, ut11, ut12 = _erfa_time_parts(utc, orientation)
    cip_x, cip_y, _cio_s = erfa.xys06a(tt1, tt2)
    celestial_to_intermediate = erfa.c2ixy(
        tt1,
        tt2,
        float(cip_x) + orientation.dx_radians,
        float(cip_y) + orientation.dy_radians,
    )
    polar_motion = erfa.pom00(
        orientation.xp_radians,
        orientation.yp_radians,
        erfa.sp00(tt1, tt2),
    )
    return erfa.c2tcio(celestial_to_intermediate, erfa.era00(ut11, ut12), polar_motion)


def _assert_matrix_close(actual, expected, *, tolerance: float = 5.0e-15) -> None:
    for row in range(3):
        for column in range(3):
            assert float(actual[row][column]) == pytest.approx(float(expected[row][column]), abs=tolerance)


@pytest.mark.parametrize(
    "utc",
    (
        datetime(2006, 1, 15, 12, 0, tzinfo=UTC),
        datetime(2024, 1, 1, 12, 34, 56, tzinfo=UTC),
    ),
)
def test_gcrf_to_itrf_matches_independent_erfa_iau2006_chain(utc: datetime):
    """Precession/nutation, ERA, dX/dY and polar motion match ERFA's separate chain."""

    orientation = _orientation()
    actual = FrameTransformService()._matrix_to_itrf(FrameId.GCRF, utc, orientation)

    _assert_matrix_close(actual, _reference_gcrf_to_itrf(utc, orientation))


def test_cirs_and_eme2000_branches_match_independent_erfa_components():
    """Exercise the CIRS rotation order and EME2000 frame-bias correction."""

    utc = datetime(2024, 1, 1, 12, 34, 56, tzinfo=UTC)
    orientation = _orientation()
    service = FrameTransformService()
    tt1, tt2, ut11, ut12 = _erfa_time_parts(utc, orientation)
    polar_motion = erfa.pom00(orientation.xp_radians, orientation.yp_radians, erfa.sp00(tt1, tt2))
    expected_cirs = erfa.c2tcio(erfa.ir(), erfa.era00(ut11, ut12), polar_motion)
    frame_bias, _precession, _bias_precession = erfa.bp00(tt1, tt2)
    expected_eme2000 = erfa.rxr(_reference_gcrf_to_itrf(utc, orientation), erfa.tr(frame_bias))

    _assert_matrix_close(service._matrix_to_itrf(FrameId.CIRS, utc, orientation), expected_cirs)
    _assert_matrix_close(service._matrix_to_itrf(FrameId.EME2000, utc, orientation), expected_eme2000)


def test_public_gcrf_to_itrf_position_agrees_with_erfa_reference_chain():
    """Validate the public transform boundary, including UTC→TT/UT1 conversion."""

    utc = datetime(2024, 1, 1, 12, 34, 56, tzinfo=UTC)
    orientation = _orientation()
    position_m = (6_702_345.678, -1_923_456.789, 2_783_210.987)
    state = StateVector(
        epoch=utc,
        time_scale=TimeScale.UTC,
        frame=FrameId.GCRF,
        frame_realization=None,
        center="EARTH",
        position_m=position_m,
    )
    reference = _reference_gcrf_to_itrf(utc, orientation)
    expected_position = tuple(
        sum(float(reference[row][column]) * position_m[column] for column in range(3))
        for row in range(3)
    )

    transformed = FrameTransformService().transform(
        state,
        target_frame=FrameId.ITRF,
        target_realization="ITRF2020",
        earth_orientation=orientation,
    )

    assert transformed.position_m == pytest.approx(expected_position, abs=5.0e-7)


def test_gcrf_to_itrf_matches_published_sofa_c2t06a_reference(monkeypatch):
    """Keep a fixed official SOFA vector as a regression anchor without network I/O."""

    # SOFA/ERFA validation vector for eraC2t06a(2400000.5, 53736.0,
    # 2400000.5, 53736.0, 2.55060238e-7, 1.860359247e-6), published by
    # the IAU SOFA project and included in ERFA's public validation suite.
    expected = (
        (-0.1810332128305897282, 0.9834769806938592296, 0.6555550962998436505e-4),
        (-0.9834768134136214897, -0.1810332203649130832, 0.5749800844905594110e-3),
        (0.5773474024748545878e-3, 0.3961816829632690581e-4, 0.9999998325501747785),
    )
    from orbit_api.frames import transforms

    monkeypatch.setattr(
        transforms,
        "_julian_parts",
        lambda *_args, **_kwargs: (2_400_000.5, 53_736.0, 2_400_000.5, 53_736.0, 2_400_000.5, 53_736.0),
    )
    orientation = EarthOrientation(
        xp_radians=2.55060238e-7,
        yp_radians=1.860359247e-6,
        source="SOFA published vector",
        version="C2T06A",
        quality="final",
    )

    actual = FrameTransformService()._gcrf_to_itrf_matrix(
        FrameId.GCRF,
        datetime(2006, 1, 15, tzinfo=UTC),
        orientation,
    )

    _assert_matrix_close(actual, expected, tolerance=1.0e-12)

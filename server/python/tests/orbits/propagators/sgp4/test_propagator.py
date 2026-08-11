"""SGP4 engine contract and numerical-regression tests.

The fixed Vanguard 1 vector below is a public SGP4 verification case.  It is
kept locally so the suite never depends on a live catalogue or network access.
"""

import math
from datetime import UTC, datetime, timedelta, timezone

import pytest
from orbit_api.frames import FrameId
from orbit_api.orbits.propagators.sgp4.propagator import SGP4Propagator

# Vallado / SGP4 verification case 00005 (Vanguard 1).  At 2000-06-28T00:00Z
# the reference TEME state is published by the SGP4 verification suite in km
# and km/s.  The tolerance deliberately permits sub-metre differences between
# supported compiled and pure-Python SGP4 implementations, while remaining far
# tighter than any meaningful TLE uncertainty.
VANGUARD_LINE1 = "1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753"
VANGUARD_LINE2 = "2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667"
VANGUARD_REFERENCE_UTC = datetime(2000, 6, 28, tzinfo=UTC)
VANGUARD_REFERENCE_POSITION_KM = (-3754.2514743216166, 7876.346817439062, 4719.220856478582)
VANGUARD_REFERENCE_VELOCITY_KM_S = (-5.58365782280485, -0.9764014685717839, -1.4386317293802753)

# This official stress TLE first reports an SGP4 error at the requested epoch.
# It lets the Orbit boundary verify that an invalid state is never silently
# turned into a finite position.
DECAYED_LINE1 = "1 44160U 19006AX  20162.79712247 +.00816806 +19088-3 +34711-2 0  9997"
DECAYED_LINE2 = "2 44160 095.2472 272.0808 0216413 032.6694 328.7739 15.58006382062511"
DECAYED_ERROR_UTC = datetime(2020, 7, 25, 19, 7, 51, tzinfo=UTC)


@pytest.fixture
def vanguard_propagator() -> SGP4Propagator:
    return SGP4Propagator(VANGUARD_LINE1, VANGUARD_LINE2)


def test_sgp4_matches_the_local_vallado_reference_and_converts_native_units(
    vanguard_propagator: SGP4Propagator,
):
    """The native TEME path must retain the verified vector and SI contract."""

    raw = vanguard_propagator.propagate_teme_datetime(VANGUARD_REFERENCE_UTC)
    native = vanguard_propagator.native_state_at(VANGUARD_REFERENCE_UTC)

    assert raw[:3] == pytest.approx(VANGUARD_REFERENCE_POSITION_KM, abs=1.0e-3)
    assert raw[3:] == pytest.approx(VANGUARD_REFERENCE_VELOCITY_KM_S, abs=1.0e-6)
    assert native.epoch == VANGUARD_REFERENCE_UTC
    assert native.time_scale.value == "UTC"
    assert native.frame is FrameId.TEME
    assert native.frame_realization is None
    assert native.center == "EARTH"
    assert native.provenance == {
        "source": "TLE",
        "propagator": "sgp4",
        "native_frame": "TEME",
    }
    # Raw SGP4 is km/km/s; Orbit's typed native state is always SI.
    assert native.position_m == pytest.approx(tuple(value * 1_000.0 for value in raw[:3]), abs=1.0e-6)
    assert native.velocity_m_s == pytest.approx(tuple(value * 1_000.0 for value in raw[3:]), abs=1.0e-9)


def test_sgp4_normalizes_offset_datetimes_and_is_deterministic(
    vanguard_propagator: SGP4Propagator,
):
    """The same physical UTC instant must not drift with client time zones."""

    utc_state = vanguard_propagator.propagate_teme_datetime(VANGUARD_REFERENCE_UTC)
    repeated_state = vanguard_propagator.propagate_teme_datetime(VANGUARD_REFERENCE_UTC)
    madrid_equivalent = VANGUARD_REFERENCE_UTC.astimezone(timezone(timedelta(hours=2)))
    local_state = vanguard_propagator.propagate_teme_datetime(madrid_equivalent)
    native = vanguard_propagator.native_state_at(madrid_equivalent)

    assert repeated_state == utc_state
    assert local_state == utc_state
    assert native.epoch == VANGUARD_REFERENCE_UTC


def test_sgp4_teme_to_itrf_keeps_position_norm_and_position_only_contract(
    vanguard_propagator: SGP4Propagator,
):
    """A pure Earth-rotation transform must not scale a propagated orbit."""

    native = vanguard_propagator.native_state_at(VANGUARD_REFERENCE_UTC)
    rendered = vanguard_propagator.state_at(VANGUARD_REFERENCE_UTC, target_frame=FrameId.ITRF)
    position_only = vanguard_propagator.position_at(VANGUARD_REFERENCE_UTC, target_frame=FrameId.ITRF)

    assert rendered.frame is FrameId.ITRF
    assert rendered.transform_path == ("TEME", "PEF", "ITRF")
    assert position_only.frame is FrameId.ITRF
    assert position_only.velocity_m_s is None
    assert math.isclose(
        math.hypot(*native.position_m),
        math.hypot(*rendered.position_m),
        rel_tol=1.0e-12,
        abs_tol=1.0e-6,
    )
    # Position-only propagation uses the same rotation but intentionally skips
    # velocity derivatives for access-window calculations.
    assert position_only.position_m == pytest.approx(rendered.position_m, abs=1.0e-6)


def test_sgp4_fails_closed_for_malformed_or_decayed_tle_states():
    """Bad inputs/errors may not escape as invented Cartesian vectors."""

    malformed = SGP4Propagator("not a TLE", "not a TLE")
    decayed = SGP4Propagator(DECAYED_LINE1, DECAYED_LINE2)

    with pytest.raises(ValueError, match="code 2"):
        malformed.native_state_at(VANGUARD_REFERENCE_UTC)
    with pytest.raises(ValueError, match="code 1"):
        decayed.native_state_at(DECAYED_ERROR_UTC)


def test_sgp4_propagates_a_valid_tle_to_six_numeric_components():
    propagator = SGP4Propagator(
        "1 25544U 98067A   24001.00000000  .00000000  00000+0  00000+0 0  9991",
        "2 25544  51.6400  10.0000 0005000  30.0000 330.0000 15.50000000000000",
    )
    state = propagator.propagate()
    assert len(state) == 6
    assert all(isinstance(value, float) for value in state)


def test_sgp4_exposes_its_native_teme_state_separately_from_renderer_itrf():
    propagator = SGP4Propagator(
        "1 25544U 98067A   24001.00000000  .00000000  00000+0  00000+0 0  9991",
        "2 25544  51.6400  10.0000 0005000  30.0000 330.0000 15.50000000000000",
    )
    moment = datetime(2024, 1, 1, tzinfo=UTC)

    teme = propagator.propagate_teme_datetime(moment)
    itrf = propagator.propagate_datetime(moment)

    assert propagator.dynamics_reference_frame == "TEME"
    assert len(teme) == 6 and all(math.isfinite(value) for value in teme)
    assert len(itrf) == 6 and all(math.isfinite(value) for value in itrf)
    # The ITRF renderer contract is metres after an Earth-rotation transform,
    # while this method preserves raw SGP4 kilometres in TEME.
    assert not math.isclose(teme[0], itrf[0] / 1000.0, abs_tol=1e-6)


def test_teme_to_itrf_velocity_includes_the_correct_earth_rotation_derivative():
    x, y, _z, vx, vy, _vz = SGP4Propagator._teme_to_itrf(3_000.0, 4_000.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    earth_rotation_rate = 7.2921150e-5

    assert math.isclose(vx, earth_rotation_rate * y, abs_tol=1e-12)
    assert math.isclose(vy, -earth_rotation_rate * x, abs_tol=1e-12)

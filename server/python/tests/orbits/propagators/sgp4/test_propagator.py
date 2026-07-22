"""SGP4 engine contract tests."""

from datetime import UTC, datetime
import math

from orbit_api.orbits.propagators.sgp4.propagator import SGP4Propagator


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


def test_teme_to_ecef_velocity_includes_the_correct_earth_rotation_derivative():
    x, y, _z, vx, vy, _vz = SGP4Propagator._teme_to_ecef(3_000.0, 4_000.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    earth_rotation_rate = 7.2921150e-5

    assert math.isclose(vx, earth_rotation_rate * y, abs_tol=1e-12)
    assert math.isclose(vy, -earth_rotation_rate * x, abs_tol=1e-12)

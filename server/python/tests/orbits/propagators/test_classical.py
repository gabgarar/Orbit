"""Frame and element helpers shared by native manual propagators."""

from datetime import UTC, datetime
import math

from orbit_api.orbits.propagators.classical import (
    EARTH_ROTATION_RATE_RAD_S,
    eci_to_itrf,
)


def test_eci_to_itrf_applies_the_rotation_derivative_with_the_correct_sign():
    """A fixed ECI point appears to move westward in Earth-fixed space."""

    x, y, _z, vx, vy, _vz = eci_to_itrf(
        7_000.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        datetime(2026, 7, 20, 12, tzinfo=UTC),
    )

    # For r_ITRF = R3(-GMST) r_ECI, dR/dt r is (+omega*y, -omega*x).
    assert math.isclose(vx, EARTH_ROTATION_RATE_RAD_S * y, abs_tol=1e-8)
    assert math.isclose(vy, -EARTH_ROTATION_RATE_RAD_S * x, abs_tol=1e-8)

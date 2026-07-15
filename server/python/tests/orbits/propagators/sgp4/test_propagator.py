"""SGP4 engine contract tests."""

from orbit_api.orbits.propagators.sgp4.propagator import SGP4Propagator


def test_sgp4_propagates_a_valid_tle_to_six_numeric_components():
    propagator = SGP4Propagator(
        "1 25544U 98067A   24001.00000000  .00000000  00000+0  00000+0 0  9991",
        "2 25544  51.6400  10.0000 0005000  30.0000 330.0000 15.50000000000000",
    )
    state = propagator.propagate()
    assert len(state) == 6
    assert all(isinstance(value, float) for value in state)

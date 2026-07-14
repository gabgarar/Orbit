from orbit_api.orbits.propagators.registry import build_default_registry
from orbit_api.orbits.sampling import compute_auto_samples


def test_default_registry_exposes_sgp4():
    assert build_default_registry().available() == ("sgp4",)


def test_sampling_respects_limits():
    samples = compute_auto_samples(24, 1, None, 24, 1440, 300_000)
    assert 24 <= samples <= 1440


def test_sgp4_engine_propagates_a_valid_tle():
    propagator = build_default_registry().create(
        "sgp4",
        "1 25544U 98067A   24001.00000000  .00000000  00000+0  00000+0 0  9991",
        "2 25544  51.6400  10.0000 0005000  30.0000 330.0000 15.50000000000000",
    )
    state = propagator.propagate()
    assert len(state) == 6
    assert all(isinstance(value, float) for value in state)

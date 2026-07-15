"""Propagation selection and sampling policy tests."""

import pytest

from orbit_api.orbits.propagators.registry import PropagatorRegistry, build_default_registry
from orbit_api.orbits.sampling import compute_auto_samples, eccentricity_density_factor


def test_registry_exposes_sgp4_and_rejects_unknown_engine():
    assert build_default_registry().available() == ("sgp4",)
    with pytest.raises(ValueError): PropagatorRegistry().create("missing", "", "")


def test_sampling_respects_budget_and_eccentricity_density():
    circular = compute_auto_samples(24, 1, None, 24, 1440, 300_000)
    eccentric = type("Prop", (), {"sat": type("Sat", (), {"ecco": 0.6})()})()
    assert 24 <= circular <= 1440
    assert eccentricity_density_factor(eccentric) > 1

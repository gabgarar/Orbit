"""Propagation selection and sampling policy tests."""

import pytest

from orbit_api.orbits.propagators.registry import PropagatorRegistry, build_default_registry
from orbit_api.orbits.sampling import (
    compute_auto_samples,
    curvature_sample_count,
    eccentricity_density_factor,
    orbital_geometry,
)


def test_registry_exposes_sgp4_and_rejects_unknown_engine():
    assert build_default_registry().available() == ("sgp4",)
    with pytest.raises(ValueError): PropagatorRegistry().create("missing", "", "")


def test_sampling_respects_budget_and_eccentricity_density():
    circular = compute_auto_samples(24, 1, None, 24, 7_200, 300_000)
    eccentric = type("Prop", (), {"sat": type("Sat", (), {"ecco": 0.6})()})()
    assert 24 <= circular <= 7_200
    assert eccentricity_density_factor(eccentric) > 1


def test_sampling_uses_orbital_period_and_perigee_to_keep_low_orbits_smooth():
    # ``no_kozai`` is radians/minute: 92 min is representative of LEO and
    # 1436 min of GEO.  A 12-hour LEO must receive materially denser real SGP4
    # samples because its apparent curvature changes much faster.
    leo = type("Prop", (), {"sat": type("Sat", (), {"no_kozai": 2 * 3.141592653589793 / 92, "ecco": 0.001})()})()
    geo = type("Prop", (), {"sat": type("Sat", (), {"no_kozai": 2 * 3.141592653589793 / 1436, "ecco": 0.001})()})()

    leo_period, leo_perigee = orbital_geometry(leo)
    assert 5_000 < leo_period < 6_000
    assert 100 < leo_perigee < 1_000
    assert curvature_sample_count(12, leo) > curvature_sample_count(12, geo)

    leo_samples = compute_auto_samples(12, 1, leo, 24, 7_200, 300_000)
    geo_samples = compute_auto_samples(12, 1, geo, 24, 7_200, 300_000)
    assert leo_samples > geo_samples
    assert leo_samples <= 7_200


def test_sampling_never_exceeds_the_shared_render_budget():
    leo = type("Prop", (), {"sat": type("Sat", (), {"no_kozai": 2 * 3.141592653589793 / 92, "ecco": 0.001})()})()
    samples = compute_auto_samples(12, 100, leo, 24, 7_200, 300_000)
    assert samples <= 3_000


def test_sampling_keeps_the_budget_when_the_active_catalogue_exceeds_the_nominal_minimum():
    leo = type("Prop", (), {"sat": type("Sat", (), {"no_kozai": 2 * 3.141592653589793 / 92, "ecco": 0.001})()})()
    samples = compute_auto_samples(12, 20_000, leo, 24, 7_200, 300_000)
    assert samples <= 15

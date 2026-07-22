"""Focused regression tests for manual numerical force propagation."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import math

import pytest

from orbit_api.application.manual_orbits import keplerian_to_state_vector
from orbit_api.domain.requests import ManualKeplerianInput
from orbit_api.orbits.propagators.classical import EARTH_MU_KM3_S2
from orbit_api.orbits.propagators.cowell import CowellPropagator
from orbit_api.orbits.propagators.j2 import J2Propagator
from orbit_api.orbits.propagators.j2_j3_j4 import J2J3J4Propagator
from orbit_api.orbits.propagators.two_body import TwoBodyPropagator


EPOCH = datetime(2026, 7, 20, 12, tzinfo=UTC)


def circular_definition(radius_km: float = 6878.0) -> tuple[dict[str, float], dict[str, object]]:
    velocity = math.sqrt(EARTH_MU_KM3_S2 / radius_km)
    return (
        {
            "semi_major_axis_km": radius_km,
            "eccentricity": 0.0,
            "inclination_deg": 0.0,
            "raan_deg": 0.0,
            "argument_of_perigee_deg": 0.0,
            "mean_anomaly_deg": 0.0,
        },
        {
            "position_eci_km": {"x": radius_km, "y": 0.0, "z": 0.0},
            "velocity_eci_km_s": {"x": 0.0, "y": velocity, "z": 0.0},
        },
    )


def distance_km(left, right) -> float:
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(left[:3], right[:3], strict=True)))


def specific_energy_km2_s2(state) -> float:
    radius = math.sqrt(sum(component * component for component in state[:3]))
    speed_sq = sum(component * component for component in state[3:])
    return (speed_sq / 2.0) - (EARTH_MU_KM3_S2 / radius)


def semi_major_axis_km(state) -> float:
    return -EARTH_MU_KM3_S2 / (2.0 * specific_energy_km2_s2(state))


def test_cowell_two_body_agrees_closely_with_the_analytical_solution_after_one_day():
    keplerian, state_vector = circular_definition()
    numerical = CowellPropagator(EPOCH, state_vector, gravity_model="two-body")
    analytical = TwoBodyPropagator(EPOCH, keplerian)
    target = EPOCH + timedelta(days=1)

    numerical_state = numerical.propagate_eci_datetime(target)
    analytical_state = analytical.propagate_eci_datetime(target)

    # A 60-second RK4 design-preview step should remain well below visual
    # resolution against the exact Kepler solution over a day in LEO.
    assert distance_km(numerical_state, analytical_state) < 2.0
    assert math.dist(numerical_state[3:], analytical_state[3:]) < 0.003


def test_atmospheric_drag_lowers_orbital_energy_and_the_derived_semi_major_axis():
    # 250 km and a moderate ballistic factor make the first-order effect
    # observable over a short test while staying safely above Earth.
    _keplerian, state_vector = circular_definition(6628.0)
    no_drag = CowellPropagator(EPOCH, state_vector, gravity_model="two-body")
    with_drag = CowellPropagator(
        EPOCH,
        state_vector,
        gravity_model="two-body",
        atmospheric_drag=True,
        drag_coefficient=2.2,
        area_m2=8.0,
        mass_kg=250.0,
    )
    target = EPOCH + timedelta(hours=6)

    state_without_drag = no_drag.propagate_eci_datetime(target)
    state_with_drag = with_drag.propagate_eci_datetime(target)

    assert with_drag.model_id == "cowell-rk4"
    assert with_drag.force_terms == ("central", "drag")
    assert with_drag.force_model_id == "two-body"
    assert specific_energy_km2_s2(state_with_drag) < specific_energy_km2_s2(state_without_drag)
    assert semi_major_axis_km(state_with_drag) < semi_major_axis_km(state_without_drag)


def test_j2_j3_j4_produces_finite_and_distinguishable_higher_order_state():
    elements = ManualKeplerianInput(
        semi_major_axis_km=7200.0,
        eccentricity=0.08,
        inclination_deg=63.4,
        raan_deg=35.0,
        argument_of_perigee_deg=120.0,
        true_anomaly_deg=45.0,
    )
    keplerian, state_vector = keplerian_to_state_vector(elements)
    analytical_j2 = J2Propagator(EPOCH, keplerian)
    numerical_j2 = CowellPropagator(EPOCH, state_vector, gravity_model="j2")
    higher_order = J2J3J4Propagator(EPOCH, state_vector)
    target = EPOCH + timedelta(days=3)

    j2_state = analytical_j2.propagate_eci_datetime(target)
    numerical_j2_state = numerical_j2.propagate_eci_datetime(target)
    higher_order_state = higher_order.propagate_eci_datetime(target)

    assert all(math.isfinite(value) for value in higher_order_state)
    # A matching fixed-step numerical reference with gravity truncated at J2
    # proves that the J3/J4 force contribution itself changes the trajectory.
    assert distance_km(higher_order_state, numerical_j2_state) > 0.001
    # It must also not collapse into the existing first-order secular J2
    # preview used by the lightweight model.
    assert distance_km(higher_order_state, j2_state) > 0.01


def test_j2_j3_j4_preset_is_not_cowell_and_rejects_drag_configuration():
    _keplerian, state_vector = circular_definition()
    preset = J2J3J4Propagator(EPOCH, state_vector)

    assert not isinstance(preset, CowellPropagator)
    assert preset.applied_engine == "j2-j3-j4"
    assert preset.force_model_id == "j2-j3-j4"
    assert preset.atmospheric_drag is False
    with pytest.raises(ValueError, match="does not support atmospheric drag"):
        J2J3J4Propagator(EPOCH, state_vector, atmospheric_drag=True)


def test_explicit_j2_terms_match_the_legacy_j2_gravity_preset():
    _keplerian, state_vector = circular_definition()
    legacy = CowellPropagator(EPOCH, state_vector, gravity_model="j2")
    explicit = CowellPropagator(EPOCH, state_vector, force_terms=("central", "j2"))
    target = EPOCH + timedelta(hours=18)

    assert explicit.force_terms == ("central", "j2")
    assert explicit.gravity_model == "j2"
    assert explicit.propagate_eci_datetime(target) == legacy.propagate_eci_datetime(target)


def test_explicit_full_zonal_terms_match_the_legacy_j2_j3_j4_preset():
    elements = ManualKeplerianInput(
        semi_major_axis_km=7200.0,
        eccentricity=0.08,
        inclination_deg=63.4,
        raan_deg=35.0,
        argument_of_perigee_deg=120.0,
        true_anomaly_deg=45.0,
    )
    _keplerian, state_vector = keplerian_to_state_vector(elements)
    legacy = J2J3J4Propagator(EPOCH, state_vector)
    explicit = CowellPropagator(EPOCH, state_vector, force_terms=("central", "j2", "j3", "j4"))
    target = EPOCH + timedelta(days=1)

    assert explicit.force_terms == ("central", "j2", "j3", "j4")
    assert explicit.propagate_eci_datetime(target) == legacy.propagate_eci_datetime(target)


def test_j3_and_j4_are_independent_force_terms_that_change_a_generic_trajectory():
    elements = ManualKeplerianInput(
        semi_major_axis_km=7200.0,
        eccentricity=0.08,
        inclination_deg=63.4,
        raan_deg=35.0,
        argument_of_perigee_deg=120.0,
        true_anomaly_deg=45.0,
    )
    _keplerian, state_vector = keplerian_to_state_vector(elements)
    central = CowellPropagator(EPOCH, state_vector, force_terms=("central",))
    with_j2 = CowellPropagator(EPOCH, state_vector, force_terms=("j2",))
    with_j3 = CowellPropagator(EPOCH, state_vector, force_terms=("j3",))
    with_j4 = CowellPropagator(EPOCH, state_vector, force_terms=("j4",))
    target = EPOCH + timedelta(days=3)

    central_state = central.propagate_eci_datetime(target)
    assert with_j2.force_terms == ("central", "j2")
    assert with_j3.force_terms == ("central", "j3")
    assert with_j4.force_terms == ("central", "j4")
    assert distance_km(with_j2.propagate_eci_datetime(target), central_state) > 0.01
    assert distance_km(with_j3.propagate_eci_datetime(target), central_state) > 1e-5
    assert distance_km(with_j4.propagate_eci_datetime(target), central_state) > 1e-5


def test_drag_membership_is_authoritative_and_central_is_inserted_when_missing():
    _keplerian, state_vector = circular_definition(6628.0)
    ignored_drag_alias = CowellPropagator(
        EPOCH,
        state_vector,
        force_terms=("j2",),
        atmospheric_drag=True,
        drag_coefficient=2.2,
        area_m2=8.0,
        mass_kg=250.0,
    )
    explicit_drag = CowellPropagator(
        EPOCH,
        state_vector,
        force_terms=("drag",),
        atmospheric_drag=False,
        drag_coefficient=2.2,
        area_m2=8.0,
        mass_kg=250.0,
    )
    without_drag = CowellPropagator(EPOCH, state_vector, force_terms=("central",))
    target = EPOCH + timedelta(hours=6)

    assert ignored_drag_alias.force_terms == ("central", "j2")
    assert ignored_drag_alias.atmospheric_drag is False
    assert explicit_drag.force_terms == ("central", "drag")
    assert explicit_drag.atmospheric_drag is True
    assert semi_major_axis_km(explicit_drag.propagate_eci_datetime(target)) < semi_major_axis_km(
        without_drag.propagate_eci_datetime(target)
    )


def test_nearest_state_cache_bounds_a_7200_point_preview_to_one_history_pass(monkeypatch):
    _keplerian, state_vector = circular_definition()
    propagator = CowellPropagator(EPOCH, state_vector, gravity_model="two-body")
    durations: list[float] = []

    def fake_integrate(state, duration_seconds):
        durations.append(duration_seconds)
        return state

    monkeypatch.setattr(propagator, "_integrate", fake_integrate)
    for index in range(7_200):
        propagator.propagate_eci_datetime(EPOCH + timedelta(seconds=60 * index))

    assert len(durations) == 7_199
    assert max(abs(duration) for duration in durations) <= propagator.integration_step_seconds
    before_itrf_lookup = len(durations)
    propagator.propagate_datetime(EPOCH + timedelta(seconds=60 * 7_199))
    assert len(durations) == before_itrf_lookup

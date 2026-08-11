"""Physics invariants shared by Orbit's analytical and RK4 propagators.

These tests deliberately avoid renderer coordinates and compare native EME2000
states.  They catch unit, sign, time-direction and integration regressions
without asserting a display-dependent trajectory sample.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime, timedelta

from orbit_api.orbits.propagators.classical import EARTH_MU_KM3_S2
from orbit_api.orbits.propagators.cowell import CowellPropagator
from orbit_api.orbits.propagators.two_body import TwoBodyPropagator

EPOCH = datetime(2026, 7, 20, 12, tzinfo=UTC)


def specific_energy_km2_s2(state: tuple[float, float, float, float, float, float]) -> float:
    radius_km = math.sqrt(sum(component * component for component in state[:3]))
    speed_sq_km2_s2 = sum(component * component for component in state[3:])
    return (speed_sq_km2_s2 / 2.0) - (EARTH_MU_KM3_S2 / radius_km)


def angular_momentum_norm_km2_s(state: tuple[float, float, float, float, float, float]) -> float:
    x, y, z, vx, vy, vz = state
    return math.sqrt(
        ((y * vz) - (z * vy)) ** 2
        + ((z * vx) - (x * vz)) ** 2
        + ((x * vy) - (y * vx)) ** 2
    )


def circular_state(radius_km: float = 6878.0) -> tuple[tuple[float, float, float, float, float, float], dict[str, object]]:
    velocity_km_s = math.sqrt(EARTH_MU_KM3_S2 / radius_km)
    state = (radius_km, 0.0, 0.0, 0.0, velocity_km_s, 0.0)
    return state, {
        "position_eme2000_km": {"x": radius_km, "y": 0.0, "z": 0.0},
        "velocity_eme2000_km_s": {"x": 0.0, "y": velocity_km_s, "z": 0.0},
    }


def state_mapping(state: tuple[float, float, float, float, float, float]) -> dict[str, object]:
    return {
        "position_eme2000_km": {"x": state[0], "y": state[1], "z": state[2]},
        "velocity_eme2000_km_s": {"x": state[3], "y": state[4], "z": state[5]},
    }


def test_analytical_two_body_closes_a_full_orbit_and_preserves_native_invariants():
    propagator = TwoBodyPropagator(EPOCH, {
        "semi_major_axis_km": 7200.0,
        "eccentricity": 0.11,
        "inclination_deg": 47.0,
        "raan_deg": 20.0,
        "argument_of_perigee_deg": 33.0,
        "mean_anomaly_deg": 47.0,
    })

    initial = propagator.propagate_eme2000_datetime(EPOCH)
    after_period = propagator.propagate_eme2000_datetime(
        EPOCH + timedelta(seconds=propagator.orbital_period_seconds)
    )

    assert math.dist(initial[:3], after_period[:3]) < 1e-5
    assert math.dist(initial[3:], after_period[3:]) < 1e-8
    assert math.isclose(
        specific_energy_km2_s2(after_period),
        specific_energy_km2_s2(initial),
        abs_tol=1e-12,
    )
    assert math.isclose(
        angular_momentum_norm_km2_s(after_period),
        angular_momentum_norm_km2_s(initial),
        abs_tol=1e-10,
    )


def test_cowell_central_gravity_has_bounded_energy_and_angular_momentum_drift():
    initial, initial_mapping = circular_state()
    propagated = CowellPropagator(EPOCH, initial_mapping, gravity_model="two-body").propagate_eme2000_datetime(
        EPOCH + timedelta(hours=6)
    )

    initial_energy = specific_energy_km2_s2(initial)
    initial_momentum = angular_momentum_norm_km2_s(initial)
    assert abs(specific_energy_km2_s2(propagated) - initial_energy) / abs(initial_energy) < 1e-6
    assert abs(angular_momentum_norm_km2_s(propagated) - initial_momentum) / initial_momentum < 5e-7


def test_cowell_central_gravity_nearly_reverses_over_a_symmetric_interval():
    initial, initial_mapping = circular_state()
    target = EPOCH + timedelta(hours=6)
    forward = CowellPropagator(EPOCH, initial_mapping, gravity_model="two-body").propagate_eme2000_datetime(target)
    recovered = CowellPropagator(target, state_mapping(forward), gravity_model="two-body").propagate_eme2000_datetime(EPOCH)

    # Fixed-step RK4 is not exactly time-symmetric. These bounds are a
    # regression envelope for the documented 60 s preview integrator and
    # still catch accidental sign/unit/time-direction changes by orders of
    # magnitude.
    assert math.dist(recovered[:3], initial[:3]) < 0.25
    assert math.dist(recovered[3:], initial[3:]) < 3e-4

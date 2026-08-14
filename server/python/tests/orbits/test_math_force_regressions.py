"""Deterministic mathematical and force-model regression contracts.

These tests deliberately use synthetic, local inputs.  They protect the
equations and frame/time contracts without making network access, external
ephemerides, or wall-clock performance part of the unit-test result.
"""

from __future__ import annotations

import math
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest
from orbit_api.formats.tabular import TabularStateProvider
from orbit_api.frames import FrameId, FrameTransformService, StateVector, TimeScale
from orbit_api.orbits.forces.celestial import (
    ASTRONOMICAL_UNIT_METRES,
    SOLAR_RADIATION_PRESSURE_1_AU_N_M2,
    SUN_GRAVITATIONAL_PARAMETER_M3_S2,
    cannonball_solar_radiation_pressure_acceleration,
    differential_third_body_acceleration,
)
from orbit_api.orbits.forces.geopotential import (
    GeopotentialConfiguration,
    GravityFieldModel,
    geopotential_perturbation_acceleration_itrf,
    gravity_acceleration_itrf,
)
from orbit_api.orbits.propagators.classical import (
    EARTH_MU_KM3_S2,
    ClassicalElements,
    state_eci_from_mean_elements,
)
from orbit_api.timekeeping import ARCSECOND_TO_RADIAN, EarthOrientation

_EPOCH = datetime(2024, 1, 1, 12, tzinfo=UTC)
_TWO_PI = 2.0 * math.pi


def _classical_mapping(*, eccentricity: float, mean_anomaly_deg: float = 47.0) -> dict[str, float]:
    return {
        # Keep the moderately eccentric fixture's perigee above the WGS-84
        # equatorial radius enforced by the public manual-orbit contract.
        "semi_major_axis_km": 11_000.0,
        "eccentricity": eccentricity,
        "inclination_deg": 57.0,
        "raan_deg": 43.0,
        "argument_of_perigee_deg": 127.0,
        "mean_anomaly_deg": mean_anomaly_deg,
    }


def _norm(vector: tuple[float, float, float]) -> float:
    return math.sqrt(sum(component * component for component in vector))


def _dot(left: tuple[float, float, float], right: tuple[float, float, float]) -> float:
    return sum(a * b for a, b in zip(left, right, strict=True))


def _rotate_about_z(vector: tuple[float, float, float], angle_rad: float) -> tuple[float, float, float]:
    cosine = math.cos(angle_rad)
    sine = math.sin(angle_rad)
    x, y, z = vector
    return ((cosine * x) - (sine * y), (sine * x) + (cosine * y), z)


@pytest.mark.parametrize("eccentricity", (0.0, 0.37))
def test_classical_state_preserves_elliptic_energy_and_angular_momentum(eccentricity: float):
    """The Cartesian conversion must preserve the two-body invariants."""

    elements = ClassicalElements.from_mapping(_classical_mapping(eccentricity=eccentricity))
    state = state_eci_from_mean_elements(elements)
    position = state[:3]
    velocity = state[3:]
    radius = _norm(position)
    speed_squared = _dot(velocity, velocity)
    angular_momentum = _norm((
        (position[1] * velocity[2]) - (position[2] * velocity[1]),
        (position[2] * velocity[0]) - (position[0] * velocity[2]),
        (position[0] * velocity[1]) - (position[1] * velocity[0]),
    ))

    assert ((speed_squared / 2.0) - (EARTH_MU_KM3_S2 / radius)) == pytest.approx(
        -EARTH_MU_KM3_S2 / (2.0 * elements.semi_major_axis_km), abs=5.0e-13
    )
    assert angular_momentum == pytest.approx(
        math.sqrt(EARTH_MU_KM3_S2 * elements.semi_major_axis_km * (1.0 - (eccentricity * eccentricity))),
        abs=2.0e-10,
    )


def test_high_eccentricity_kepler_solution_closes_its_equation_and_period():
    """Near-parabolic elliptic inputs remain bounded and periodic."""

    elements = ClassicalElements.from_mapping({
        **_classical_mapping(eccentricity=0.99, mean_anomaly_deg=240.0),
        "semi_major_axis_km": 700_000.0,
        "inclination_deg": 0.0,
        "raan_deg": 0.0,
        "argument_of_perigee_deg": 0.0,
    })
    state = state_eci_from_mean_elements(elements)
    eccentric_anomaly = math.atan2(
        state[1] / (elements.semi_major_axis_km * math.sqrt(1.0 - (elements.eccentricity ** 2))),
        (state[0] / elements.semi_major_axis_km) + elements.eccentricity,
    ) % _TWO_PI
    residual = (eccentric_anomaly - (elements.eccentricity * math.sin(eccentric_anomaly)) - elements.mean_anomaly_rad) % _TWO_PI
    after_period = elements.advanced(elements.orbital_period_seconds)

    assert min(residual, _TWO_PI - residual) < 2.0e-12
    assert math.sin(after_period.mean_anomaly_rad) == pytest.approx(math.sin(elements.mean_anomaly_rad), abs=2.0e-12)
    assert math.cos(after_period.mean_anomaly_rad) == pytest.approx(math.cos(elements.mean_anomaly_rad), abs=2.0e-12)


def test_degree_two_axisymmetric_geopotential_is_rotation_and_equator_covariant():
    """A zonal J2 field cannot depend on ITRF longitude or hemisphere sign."""

    model = GravityFieldModel.wgs84_zonal_degree4()
    configuration = GeopotentialConfiguration(2, 0)
    position = (7020.0, -1510.0, 2310.0)
    angle = 1.173
    rotated_position = _rotate_about_z(position, angle)
    mirrored_position = (position[0], position[1], -position[2])

    acceleration = geopotential_perturbation_acceleration_itrf(position, model, configuration)
    rotated = geopotential_perturbation_acceleration_itrf(rotated_position, model, configuration)
    mirrored = geopotential_perturbation_acceleration_itrf(mirrored_position, model, configuration)

    assert rotated == pytest.approx(_rotate_about_z(acceleration, angle), rel=2.0e-13, abs=2.0e-18)
    assert mirrored == pytest.approx((acceleration[0], acceleration[1], -acceleration[2]), rel=2.0e-13, abs=2.0e-18)


def test_tesseral_geopotential_is_linear_and_complete_field_has_no_central_double_count():
    """A sparse harmonic is linear and ``full = central + perturbation``."""

    def field(coefficient: float) -> GravityFieldModel:
        return GravityFieldModel(
            model_id=f"synthetic-c22-{coefficient}",
            source="deterministic test fixture",
            version="1",
            sha256=None,
            mu_km3_s2=EARTH_MU_KM3_S2,
            reference_radius_km=6378.137,
            normalization="fully_normalized",
            max_degree=2,
            coefficients={(0, 0): (1.0, 0.0), (2, 2): (coefficient, -0.6 * coefficient)},
        )

    position = (7100.0, 2200.0, 1700.0)
    configuration = GeopotentialConfiguration(2, 2)
    single = geopotential_perturbation_acceleration_itrf(position, field(1.2e-6), configuration)
    doubled_model = field(2.4e-6)
    doubled = geopotential_perturbation_acceleration_itrf(position, doubled_model, configuration)
    complete = gravity_acceleration_itrf(position, doubled_model, configuration)
    central = gravity_acceleration_itrf(position, doubled_model, GeopotentialConfiguration(0, 0))

    assert doubled == pytest.approx(tuple(2.0 * value for value in single), rel=2.0e-13, abs=2.0e-18)
    assert tuple(complete[index] - central[index] for index in range(3)) == pytest.approx(
        doubled, rel=2.0e-13, abs=2.0e-18
    )


def test_third_body_axis_solution_includes_the_geocentric_indirect_term_and_tidal_limit():
    """The force vanishes at Earth and approaches the documented tidal tensor."""

    distance_m = 1.0e11
    satellite_offset_m = 1.0e5
    body = (distance_m, 0.0, 0.0)
    exact = SUN_GRAVITATIONAL_PARAMETER_M3_S2 * (
        (1.0 / ((distance_m - satellite_offset_m) ** 2)) - (1.0 / (distance_m ** 2))
    )
    leading_tidal_term = 2.0 * SUN_GRAVITATIONAL_PARAMETER_M3_S2 * satellite_offset_m / (distance_m ** 3)
    acceleration = differential_third_body_acceleration(
        (satellite_offset_m, 0.0, 0.0), body, SUN_GRAVITATIONAL_PARAMETER_M3_S2
    )

    assert differential_third_body_acceleration((0.0, 0.0, 0.0), body, SUN_GRAVITATIONAL_PARAMETER_M3_S2) == (0.0, 0.0, 0.0)
    assert acceleration == pytest.approx((exact, 0.0, 0.0), rel=2.0e-14, abs=1.0e-24)
    assert acceleration[0] == pytest.approx(leading_tidal_term, rel=2.0e-6)


def test_srp_obeys_inverse_square_distance_and_cannonball_scaling():
    """SRP stays directionally away from the Sun with explicit engineering inputs."""

    sun = (ASTRONOMICAL_UNIT_METRES, 0.0, 0.0)
    at_one_au = cannonball_solar_radiation_pressure_acceleration(
        (0.0, 0.0, 0.0), sun, reflectivity_coefficient=1.2, area_m2=5.0, mass_kg=20.0
    )
    at_half_distance = cannonball_solar_radiation_pressure_acceleration(
        (ASTRONOMICAL_UNIT_METRES / 2.0, 0.0, 0.0), sun,
        reflectivity_coefficient=1.2, area_m2=5.0, mass_kg=20.0,
    )
    doubled_area = cannonball_solar_radiation_pressure_acceleration(
        (0.0, 0.0, 0.0), sun, reflectivity_coefficient=1.2, area_m2=10.0, mass_kg=20.0
    )
    expected_one_au = SOLAR_RADIATION_PRESSURE_1_AU_N_M2 * 1.2 * 5.0 / 20.0

    assert at_one_au == pytest.approx((-expected_one_au, 0.0, 0.0), rel=0.0, abs=1.0e-20)
    assert _norm(at_half_distance) == pytest.approx(4.0 * _norm(at_one_au), rel=2.0e-15)
    assert doubled_area == pytest.approx(tuple(2.0 * value for value in at_one_au), rel=2.0e-15)


def test_hermite_interpolation_is_c1_across_an_internal_sample_boundary():
    """Adjacent Hermite windows reproduce one cubic and retain C1 continuity."""

    def cubic_sample(seconds: float) -> StateVector:
        return StateVector(
            epoch=_EPOCH + timedelta(seconds=seconds),
            time_scale=TimeScale.UTC,
            frame=FrameId.EME2000,
            frame_realization=None,
            center="EARTH",
            position_m=(seconds ** 3, 0.0, 0.0),
            velocity_m_s=(3.0 * (seconds ** 2), 0.0, 0.0),
        )

    provider = TabularStateProvider(
        source_format="OEM",
        samples=(cubic_sample(0.0), cubic_sample(1.0), cubic_sample(2.0)),
        declared_interpolation="HERMITE",
        declared_interpolation_degree=3,
    )
    epsilon = 1.0e-6
    before = provider.native_state_at(_EPOCH + timedelta(seconds=1.0 - epsilon))
    after = provider.native_state_at(_EPOCH + timedelta(seconds=1.0 + epsilon))

    for elapsed, state in ((1.0 - epsilon, before), (1.0 + epsilon, after)):
        assert state.position_m[0] == pytest.approx(elapsed ** 3, abs=1.0e-12)
        assert state.velocity_m_s is not None
        assert state.velocity_m_s[0] == pytest.approx(3.0 * (elapsed ** 2), abs=1.0e-11)
        assert state.acceleration_m_s2 is not None
        assert state.acceleration_m_s2[0] == pytest.approx(6.0 * elapsed, abs=1.0e-10)


def test_lod_velocity_correction_scales_monotonically_without_changing_rotation():
    """LOD changes dR/dt, not the ITRF-to-EME2000 orientation at fixed DUT1."""

    source = StateVector(
        epoch=_EPOCH,
        time_scale=TimeScale.UTC,
        frame=FrameId.ITRF,
        frame_realization="ITRF2020",
        center="EARTH",
        position_m=(6_702_345.678, -1_923_456.789, 2_783_210.987),
        velocity_m_s=(0.0, 0.0, 0.0),
    )
    orientation = EarthOrientation(
        dut1_seconds=0.1734,
        xp_radians=0.173 * ARCSECOND_TO_RADIAN,
        yp_radians=-0.221 * ARCSECOND_TO_RADIAN,
        lod_seconds=0.0,
        source="deterministic LOD fixture",
        version="r1",
        quality="final",
    )
    service = FrameTransformService()
    baseline = service.transform(source, target_frame=FrameId.EME2000, earth_orientation=orientation)
    one_millisecond = service.transform(
        source, target_frame=FrameId.EME2000, earth_orientation=replace(orientation, lod_seconds=0.001)
    )
    two_milliseconds = service.transform(
        source, target_frame=FrameId.EME2000, earth_orientation=replace(orientation, lod_seconds=0.002)
    )
    assert baseline.velocity_m_s is not None
    assert one_millisecond.velocity_m_s is not None
    assert two_milliseconds.velocity_m_s is not None
    delta_one = tuple(one_millisecond.velocity_m_s[index] - baseline.velocity_m_s[index] for index in range(3))
    delta_two = tuple(two_milliseconds.velocity_m_s[index] - baseline.velocity_m_s[index] for index in range(3))

    assert one_millisecond.position_m == pytest.approx(baseline.position_m, abs=1.0e-8)
    assert two_milliseconds.position_m == pytest.approx(baseline.position_m, abs=1.0e-8)
    # The matrix derivative is evaluated with finite differences, so exact
    # bitwise doubling is neither promised nor physically necessary.  The
    # response must nevertheless scale linearly at engineering-sized LOD.
    assert _norm(delta_one) > 1.0e-8
    assert _norm(delta_two) > _norm(delta_one)
    assert _norm(delta_two) / _norm(delta_one) == pytest.approx(2.0, rel=2.0e-4)

"""Focused contracts for local ERFA celestial force primitives."""

from __future__ import annotations

import math
from datetime import UTC, datetime

import erfa
import pytest
from orbit_api.frames import FrameId, StateVector
from orbit_api.orbits.forces.celestial import (
    ASTRONOMICAL_UNIT_METRES,
    EARTH_EQUATORIAL_RADIUS_METRES,
    MOON_BODY,
    MOON_GRAVITATIONAL_PARAMETER_M3_S2,
    SOLAR_RADIATION_PRESSURE_1_AU_N_M2,
    SUN_BODY,
    SUN_GRAVITATIONAL_PARAMETER_M3_S2,
    CelestialEphemeris,
    CelestialEphemerisCoverageError,
    CelestialEphemerisError,
    cannonball_solar_radiation_pressure_acceleration,
    cylindrical_umbra_eclipse_factor,
    differential_third_body_acceleration,
)
from orbit_api.timekeeping import utc_to_tt

EPOCH = datetime(2026, 8, 12, 12, 30, 15, tzinfo=UTC)


def _negate(vector):
    return tuple(-value for value in vector)


def test_celestial_provider_returns_finite_si_gcrs_states_with_complete_provenance():
    provider = CelestialEphemeris()

    sun = provider.sun_state_at(EPOCH)
    moon = provider.moon_state_at(EPOCH)

    for expected_body, state in ((SUN_BODY, sun), (MOON_BODY, moon)):
        assert isinstance(state, StateVector)
        assert state.frame is FrameId.GCRF
        assert state.center == "EARTH"
        assert state.epoch == EPOCH
        assert state.velocity_m_s is not None
        assert all(math.isfinite(value) for value in (*state.position_m, *state.velocity_m_s))
        assert state.provenance["celestial_body"] == expected_body
        assert state.provenance["provider"] == "orbit-celestial-erfa"
        assert state.provenance["network_access"] is False
        assert state.provenance["output_units"] == {"position": "m", "velocity": "m/s"}
        assert "documented_coverage" in state.provenance["ephemeris_model"] or state.provenance["ephemeris_documented_coverage"]

    assert math.isclose(math.dist((0.0, 0.0, 0.0), sun.position_m), ASTRONOMICAL_UNIT_METRES, rel_tol=0.03)
    assert 3.0e8 < math.dist((0.0, 0.0, 0.0), moon.position_m) < 4.2e8
    assert provider.identity_token[:3] == ("orbit-celestial-erfa", "1", erfa.__version__)


def test_erfa_au_and_au_per_day_vectors_are_converted_and_sun_is_geocentric_negation():
    provider = CelestialEphemeris()
    tt = utc_to_tt(EPOCH, leap_seconds=provider.leap_seconds)
    tt1, tt2 = erfa.dtf2d("TT", tt.year, tt.month, tt.day, tt.hour, tt.minute, tt.second + tt.microsecond / 1_000_000.0)
    earth_heliocentric, _earth_barycentric = erfa.epv00(tt1, tt2)
    moon_pv = erfa.moon98(tt1, tt2)

    sun = provider.sun_state_at(EPOCH)
    moon = provider.moon_state_at(EPOCH)

    assert sun.position_m == pytest.approx(tuple(-float(value) * ASTRONOMICAL_UNIT_METRES for value in earth_heliocentric[0]))
    assert sun.velocity_m_s == pytest.approx(tuple(-float(value) * ASTRONOMICAL_UNIT_METRES / 86_400.0 for value in earth_heliocentric[1]))
    assert moon.position_m == pytest.approx(tuple(float(value) * ASTRONOMICAL_UNIT_METRES for value in moon_pv[0]))
    assert moon.velocity_m_s == pytest.approx(tuple(float(value) * ASTRONOMICAL_UNIT_METRES / 86_400.0 for value in moon_pv[1]))


def test_celestial_provider_maps_gcrs_to_eme2000_with_erfa_frame_bias_only():
    provider = CelestialEphemeris()
    gcrs = provider.sun_state_at(EPOCH)
    eme2000 = provider.eme2000_state_at(SUN_BODY, EPOCH)
    tt = utc_to_tt(EPOCH, leap_seconds=provider.leap_seconds)
    tt1, tt2 = erfa.dtf2d(
        "TT",
        tt.year,
        tt.month,
        tt.day,
        tt.hour,
        tt.minute,
        tt.second + tt.microsecond / 1_000_000.0,
    )
    frame_bias, _precession, _bias_precession = erfa.bp00(tt1, tt2)
    expected_position = tuple(
        sum(float(frame_bias[row][column]) * gcrs.position_m[column] for column in range(3))
        for row in range(3)
    )

    assert eme2000.frame is FrameId.EME2000
    assert eme2000.position_m == pytest.approx(expected_position, rel=0.0, abs=1.0e-5)
    assert eme2000.provenance["frame_transform"]["earth_orientation_required"] is False


@pytest.mark.parametrize(("body", "epoch"), [
    (SUN_BODY, datetime(1899, 12, 31, 23, 59, tzinfo=UTC)),
    (SUN_BODY, datetime(2101, 1, 1, tzinfo=UTC)),
    (MOON_BODY, datetime(1949, 12, 31, 23, 59, tzinfo=UTC)),
    (MOON_BODY, datetime(2101, 1, 1, tzinfo=UTC)),
])
def test_celestial_provider_rejects_epochs_outside_each_model_documented_coverage(body, epoch):
    with pytest.raises(CelestialEphemerisCoverageError, match="cobertura documentada"):
        CelestialEphemeris().state_at(body, epoch)


def test_celestial_provider_rejects_unknown_bodies_and_normalises_naive_utc():
    provider = CelestialEphemeris()

    with pytest.raises(CelestialEphemerisError, match="SUN o MOON"):
        provider.state_at("MARS", EPOCH)

    # Orbit's common timekeeping convention treats a naive timestamp as UTC.
    # The provider deliberately preserves that convention rather than applying
    # an implicit local-time interpretation.
    state = provider.state_at(SUN_BODY, datetime(2026, 8, 12, 12, 30, 15))
    assert state.epoch == EPOCH


def test_differential_third_body_acceleration_is_zero_at_geocentre_and_has_inversion_symmetry():
    satellite = (7_000_000.0, -1_000_000.0, 2_000_000.0)
    body = (1.2e11, -7.0e10, 2.0e10)

    at_geocentre = differential_third_body_acceleration((0.0, 0.0, 0.0), body, SUN_GRAVITATIONAL_PARAMETER_M3_S2)
    acceleration = differential_third_body_acceleration(satellite, body, SUN_GRAVITATIONAL_PARAMETER_M3_S2)
    inverted = differential_third_body_acceleration(_negate(satellite), _negate(body), SUN_GRAVITATIONAL_PARAMETER_M3_S2)

    assert at_geocentre == pytest.approx((0.0, 0.0, 0.0), abs=1e-30)
    assert inverted == pytest.approx(_negate(acceleration), rel=1e-14, abs=1e-20)
    assert all(math.isfinite(value) for value in acceleration)


def test_lunar_differential_acceleration_and_srp_are_finite_and_have_physical_directions():
    satellite = (7_000_000.0, 0.0, 0.0)
    moon = (384_400_000.0, 0.0, 0.0)
    lunar = differential_third_body_acceleration(satellite, moon, MOON_GRAVITATIONAL_PARAMETER_M3_S2)

    # The satellite lies between Earth and the Moon.  The direct/indirect
    # difference points toward the Moon on this axis.
    assert lunar[0] > 0.0
    assert lunar[1:] == pytest.approx((0.0, 0.0), abs=1e-25)

    sun = (ASTRONOMICAL_UNIT_METRES, 0.0, 0.0)
    srp = cannonball_solar_radiation_pressure_acceleration(
        satellite,
        sun,
        reflectivity_coefficient=1.5,
        area_m2=10.0,
        mass_kg=100.0,
    )
    sun_satellite_distance = ASTRONOMICAL_UNIT_METRES - satellite[0]
    expected_magnitude = (
        SOLAR_RADIATION_PRESSURE_1_AU_N_M2
        * (ASTRONOMICAL_UNIT_METRES / sun_satellite_distance) ** 2
        * 1.5
        * 10.0
        / 100.0
    )
    assert srp[0] < 0.0  # Sun -> satellite points in the negative x direction.
    assert math.dist((0.0, 0.0, 0.0), srp) == pytest.approx(expected_magnitude, rel=2e-7)
    assert all(math.isfinite(value) for value in srp)


def test_cylindrical_umbra_is_stable_for_sunward_shadow_and_limb_cases():
    sun = (ASTRONOMICAL_UNIT_METRES, 0.0, 0.0)
    behind_earth = (-7_000_000.0, 0.0, 0.0)
    sunward = (7_000_000.0, 0.0, 0.0)
    outside_cylinder = (-7_000_000.0, EARTH_EQUATORIAL_RADIUS_METRES + 1.0, 0.0)
    tangent = (-7_000_000.0, EARTH_EQUATORIAL_RADIUS_METRES, 0.0)

    assert cylindrical_umbra_eclipse_factor(behind_earth, sun) == 0.0
    assert cylindrical_umbra_eclipse_factor(sunward, sun) == 1.0
    assert cylindrical_umbra_eclipse_factor(outside_cylinder, sun) == 1.0
    assert cylindrical_umbra_eclipse_factor(tangent, sun) == 1.0
    assert cannonball_solar_radiation_pressure_acceleration(
        behind_earth,
        sun,
        reflectivity_coefficient=1.0,
        area_m2=1.0,
        mass_kg=1.0,
        eclipse_factor=cylindrical_umbra_eclipse_factor(behind_earth, sun),
    ) == pytest.approx((0.0, 0.0, 0.0), abs=1e-30)


@pytest.mark.parametrize("call", [
    lambda: differential_third_body_acceleration((0.0, 0.0, 0.0), (0.0, 0.0, 0.0), SUN_GRAVITATIONAL_PARAMETER_M3_S2),
    lambda: differential_third_body_acceleration((math.nan, 0.0, 0.0), (1.0, 0.0, 0.0), SUN_GRAVITATIONAL_PARAMETER_M3_S2),
    lambda: cannonball_solar_radiation_pressure_acceleration(
        (1.0, 0.0, 0.0), (1.0, 0.0, 0.0), reflectivity_coefficient=1.0, area_m2=1.0, mass_kg=1.0,
    ),
    lambda: cannonball_solar_radiation_pressure_acceleration(
        (1.0, 0.0, 0.0), (2.0, 0.0, 0.0), reflectivity_coefficient=1.0, area_m2=1.0, mass_kg=0.0,
    ),
    lambda: cylindrical_umbra_eclipse_factor((1.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
])
def test_celestial_force_primitives_reject_degenerate_or_nonfinite_inputs(call):
    with pytest.raises(CelestialEphemerisError):
        call()

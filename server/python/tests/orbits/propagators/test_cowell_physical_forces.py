"""Integration contracts for Cowell's time-aware physical force terms.

The individual equations live in ``orbits.forces``.  These tests exercise the
non-negotiable integration boundary: terrestrial harmonics are evaluated in
ITRF at each RK stage, while celestial/relativistic terms remain explicit
inertial additions.  They deliberately use local fixtures only.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime

import pytest
from orbit_api.frames import FrameTransformService
from orbit_api.orbits.forces import ForceEvaluationContext
from orbit_api.orbits.forces.celestial import CelestialEphemeris
from orbit_api.orbits.forces.geopotential import (
    GeopotentialConfiguration,
    GravityFieldModel,
    geopotential_perturbation_acceleration_itrf,
)
from orbit_api.orbits.propagators.classical import EARTH_MU_KM3_S2
from orbit_api.orbits.propagators.cowell import (
    MAX_PURE_PYTHON_RK4_GEOPOTENTIAL_TERMS,
    CowellPropagator,
    _geopotential_harmonic_term_count,
)
from orbit_api.timekeeping import (
    EarthOrientation,
    LeapSecondTable,
    StaticEarthOrientationProvider,
)

EPOCH = datetime(2026, 8, 12, 12, 30, 15, tzinfo=UTC)
STATE = {
    "position_eme2000_km": {"x": 7200.0, "y": -1600.0, "z": 2100.0},
    "velocity_eme2000_km_s": {"x": 1.1, "y": 6.7, "z": 2.2},
}


def _strict_transformer() -> FrameTransformService:
    """A fully local frame route valid at the test epoch."""

    return FrameTransformService(
        StaticEarthOrientationProvider(
            EarthOrientation(
                dut1_seconds=0.173,
                xp_radians=1.1e-6,
                yp_radians=-0.7e-6,
                source="Cowell physical-force fixture",
                version="r1",
                quality="final",
            )
        ),
        strict_eop=True,
        leap_second_table=LeapSecondTable(
            entries=((datetime(2025, 1, 1, tzinfo=UTC), 38),),
            source="local fixture leap seconds",
            version="fixture-2025",
            sha256="d" * 64,
            expires_at=datetime(2027, 1, 1, tzinfo=UTC),
        ),
    )


def _inertial_transformer() -> FrameTransformService:
    """A valid UTC-to-TT route deliberately without terrestrial EOP data."""

    return FrameTransformService(
        leap_second_table=LeapSecondTable(
            entries=((datetime(2025, 1, 1, tzinfo=UTC), 38),),
            source="local fixture leap seconds",
            version="fixture-2025",
            sha256="e" * 64,
            expires_at=datetime(2027, 1, 1, tzinfo=UTC),
        )
    )


def _central_acceleration(state: tuple[float, ...]) -> tuple[float, float, float]:
    radius = math.sqrt(sum(value * value for value in state[:3]))
    return tuple(-EARTH_MU_KM3_S2 * value / radius**3 for value in state[:3])


def test_geopotential_is_an_itrf_force_rotated_back_to_eme2000():
    model = GravityFieldModel.wgs84_zonal_degree4()
    transformer = _strict_transformer()
    propagator = CowellPropagator(
        EPOCH,
        STATE,
        force_terms=("geopotential",),
        geopotential_model=model,
        geopotential_degree=4,
        geopotential_order=0,
        frame_transformer=transformer,
    )
    state = (*STATE["position_eme2000_km"].values(), *STATE["velocity_eme2000_km_s"].values())
    context = ForceEvaluationContext(EPOCH, transformer)
    position_itrf_km, _ = context.eme2000_state_to_itrf(state[:3], state[3:])
    expected = context.itrf_free_vector_to_eme2000(
        geopotential_perturbation_acceleration_itrf(
            position_itrf_km,
            model,
            GeopotentialConfiguration(4, 0),
        )
    )
    actual = propagator._acceleration(state)
    perturbation = tuple(actual[index] - _central_acceleration(state)[index] for index in range(3))

    assert perturbation == pytest.approx(expected, rel=2.0e-13, abs=2.0e-18)
    assert all(math.isfinite(value) for value in actual)


def test_geopotential_fails_closed_without_strict_time_and_frame_data():
    with pytest.raises(ValueError, match="EOP local estricto"):
        CowellPropagator(
            EPOCH,
            STATE,
            force_terms=("geopotential",),
            geopotential_model=GravityFieldModel.wgs84_zonal_degree4(),
        )._acceleration(
            (*STATE["position_eme2000_km"].values(), *STATE["velocity_eme2000_km_s"].values())
        )


def test_earth_fixed_drag_also_fails_closed_without_the_strict_temporal_route():
    with pytest.raises(ValueError, match="EOP local estricto"):
        CowellPropagator(
            EPOCH,
            STATE,
            force_terms=("drag",),
            area_m2=4.0,
            mass_kg=200.0,
        )._acceleration(
            (*STATE["position_eme2000_km"].values(), *STATE["velocity_eme2000_km_s"].values())
        )


def test_geopotential_rejects_legacy_zonal_double_counting_and_unconfigured_model():
    with pytest.raises(ValueError, match="no puede combinarse"):
        CowellPropagator(
            EPOCH,
            STATE,
            force_terms=("geopotential", "j2"),
            geopotential_model=GravityFieldModel.wgs84_zonal_degree4(),
        )
    with pytest.raises(ValueError, match="campo ICGEM"):
        CowellPropagator(EPOCH, STATE, force_terms=("geopotential",))


def test_geopotential_semantic_range_is_separate_from_the_rk4_work_budget():
    """The 2190 hard request envelope is distinct from RK4 work cost."""

    model = GravityFieldModel(
        model_id="budget-fixture",
        source="test fixture",
        version="1",
        sha256=None,
        mu_km3_s2=398600.4418,
        reference_radius_km=6378.137,
        normalization="fully_normalized",
        max_degree=2190,
        coefficients={(0, 0): (1.0, 0.0)},
    )

    assert _geopotential_harmonic_term_count(70, 70) == MAX_PURE_PYTHON_RK4_GEOPOTENTIAL_TERMS
    assert _geopotential_harmonic_term_count(2190, 0) == 2190

    allowed = CowellPropagator(
        EPOCH,
        STATE,
        force_terms=("geopotential",),
        geopotential_model=model,
        geopotential_degree=70,
        geopotential_order=70,
    )
    assert allowed.geopotential_configuration == GeopotentialConfiguration(70, 70)

    with pytest.raises(ValueError, match="presupuesto de ejecuci"):
        CowellPropagator(
            EPOCH,
            STATE,
            force_terms=("geopotential",),
            geopotential_model=model,
            geopotential_degree=71,
            geopotential_order=71,
        )


def test_time_dependent_forces_receive_the_four_actual_rk_stage_epochs(monkeypatch):
    propagator = CowellPropagator(EPOCH, STATE, force_terms=("central",))
    received: list[float] = []

    def acceleration(_state, offset_seconds=0.0):
        received.append(offset_seconds)
        return 0.0, 0.0, 0.0

    monkeypatch.setattr(propagator, "_acceleration", acceleration)
    propagator._rk4_step((1.0, 2.0, 3.0, 4.0, 5.0, 6.0), 60.0, 120.0)

    assert received == [120.0, 150.0, 150.0, 180.0]


def test_sun_moon_srp_and_relativity_are_finite_explicit_cowell_terms():
    propagator = CowellPropagator(
        EPOCH,
        STATE,
        force_terms=(
            "third-body-sun",
            "third-body-moon",
            "solar-radiation-pressure",
            "relativity",
        ),
        area_m2=8.0,
        mass_kg=250.0,
        solar_radiation_coefficient=1.35,
        frame_transformer=_strict_transformer(),
    )
    state = (*STATE["position_eme2000_km"].values(), *STATE["velocity_eme2000_km_s"].values())
    central = _central_acceleration(state)
    actual = propagator._acceleration(state)
    addition = tuple(actual[index] - central[index] for index in range(3))

    assert all(math.isfinite(value) for value in actual)
    assert math.sqrt(sum(value * value for value in addition)) > 0.0
    assert math.sqrt(sum(value * value for value in propagator._schwarzschild_acceleration(state))) > 0.0


def test_celestial_forces_require_inertial_time_data_but_not_terrestrial_eop():
    propagator = CowellPropagator(
        EPOCH,
        STATE,
        force_terms=("third-body-sun", "solar-radiation-pressure"),
        area_m2=8.0,
        mass_kg=250.0,
        frame_transformer=_inertial_transformer(),
    )
    state = (*STATE["position_eme2000_km"].values(), *STATE["velocity_eme2000_km_s"].values())

    actual = propagator._acceleration(state)

    assert all(math.isfinite(value) for value in actual)


def test_injected_celestial_provider_must_share_the_transformer_leap_snapshot():
    """The UTC-to-TT guard and ERFA provider cannot use different tables."""

    mismatched_leap_seconds = LeapSecondTable(
        entries=((datetime(2025, 1, 1, tzinfo=UTC), 37),),
        source="different local fixture leap seconds",
        version="fixture-2025-different",
        sha256="f" * 64,
        expires_at=datetime(2027, 1, 1, tzinfo=UTC),
    )

    with pytest.raises(ValueError, match="misma tabla local"):
        CowellPropagator(
            EPOCH,
            STATE,
            force_terms=("third-body-sun",),
            frame_transformer=_inertial_transformer(),
            celestial_ephemeris=CelestialEphemeris(
                leap_seconds=mismatched_leap_seconds,
                require_unexpired_leap_seconds=True,
            ),
        )

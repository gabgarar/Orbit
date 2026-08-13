"""Regression coverage for the frame-safe propagator comparison contract."""

from __future__ import annotations

import math
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest
from orbit_api.application.propagator_comparison import (
    PropagatorComparisonError,
    compare_trajectories,
)
from orbit_api.frames import FrameId, StateVector
from orbit_api.orbits.propagators.cowell import CowellPropagator
from orbit_api.orbits.propagators.two_body import TwoBodyPropagator
from orbit_api.timekeeping import TimeScale

EPOCH = datetime(2026, 8, 12, 12, tzinfo=UTC)


def state(
    offset_seconds: int,
    *,
    position_m: tuple[float, float, float] = (7_000_000.0, 0.0, 0.0),
    velocity_m_s: tuple[float, float, float] | None = (0.0, 7_500.0, 0.0),
    frame: FrameId | str = FrameId.EME2000,
    frame_realization: str | None = None,
    time_scale: TimeScale = TimeScale.UTC,
    center: str = "EARTH",
) -> StateVector:
    return StateVector(
        epoch=EPOCH + timedelta(seconds=offset_seconds),
        time_scale=time_scale,
        frame=frame,
        frame_realization=frame_realization,
        center=center,
        position_m=position_m,
        velocity_m_s=velocity_m_s,
    )


def test_comparison_reports_deterministic_distribution_percentiles_and_first_strict_breach():
    reference = (state(0, position_m=(0.0, 0.0, 0.0), velocity_m_s=(0.0, 0.0, 0.0)),
                 state(60, position_m=(0.0, 0.0, 0.0), velocity_m_s=(0.0, 0.0, 0.0)),
                 state(120, position_m=(0.0, 0.0, 0.0), velocity_m_s=(0.0, 0.0, 0.0)))
    candidate = (state(0, position_m=(0.0, 0.0, 0.0), velocity_m_s=(0.0, 0.0, 0.0)),
                 state(60, position_m=(3.0, 0.0, 0.0), velocity_m_s=(0.0, 3.0, 4.0)),
                 state(120, position_m=(0.0, 4.0, 0.0), velocity_m_s=(0.0, 0.0, 12.0)))

    result = compare_trajectories(
        reference,
        candidate,
        reference_name="Referencia precisa",
        candidate_name="Cowell",
        reference_model_id="sp3",
        candidate_model_id="cowell-rk4",
        position_threshold_m=3.0,
        velocity_threshold_m_s=5.0,
    )

    assert result.reference_model_id == "sp3"
    assert result.candidate_model_id == "cowell-rk4"
    assert result.contract.frame == result.contract.frame_label == "EME2000"
    assert result.contract.time_scale is TimeScale.UTC
    assert result.contract.position_units == "m"
    assert result.contract.velocity_units == "m/s"
    assert [sample.position_error_m for sample in result.samples] == [0.0, 3.0, 4.0]
    assert [sample.velocity_error_m_s for sample in result.samples] == [0.0, 5.0, 12.0]

    position = result.position
    assert position.sample_count == 3
    assert position.mean == pytest.approx(7.0 / 3.0)
    assert position.rms == pytest.approx(math.sqrt(25.0 / 3.0))
    assert position.maximum == 4.0
    assert position.p50 == 3.0
    assert position.p95 == pytest.approx(3.9)
    assert position.p99 == pytest.approx(3.98)
    assert position.first_threshold_crossing is not None
    assert position.first_threshold_crossing.sample_index == 2
    assert position.first_threshold_crossing.epoch == EPOCH + timedelta(seconds=120)
    assert position.first_threshold_crossing.error == 4.0
    assert position.first_threshold_crossing.threshold == 3.0

    assert result.velocity is not None
    assert result.velocity.first_threshold_crossing is not None
    # 5 m/s is exactly the accepted threshold; only 12 m/s leaves it.
    assert result.velocity.first_threshold_crossing.sample_index == 2


def test_equal_to_threshold_is_not_a_breach_and_position_only_is_explicit():
    reference = (state(0, position_m=(0.0, 0.0, 0.0), velocity_m_s=None),)
    candidate = (state(0, position_m=(2.0, 0.0, 0.0), velocity_m_s=None),)

    result = compare_trajectories(
        reference,
        candidate,
        reference_name="Dos cuerpos",
        candidate_name="Referencia",
        position_threshold_m=2.0,
    )

    assert result.position.maximum == result.position.rms == result.position.mean == 2.0
    assert result.position.first_threshold_crossing is None
    assert result.velocity is None


@pytest.mark.parametrize(
    ("candidate", "message"),
    [
        ((state(0, frame=FrameId.GCRF),), "no comparten contrato"),
        ((state(0, time_scale=TimeScale.GPS),), "no comparten contrato"),
        ((state(0, center="MOON"),), "no comparten contrato"),
        ((state(0, frame=FrameId.ITRF, frame_realization="ITRF2020"),), "no comparten contrato"),
        ((state(1),), "épocas no están alineadas"),
    ],
)
def test_comparison_rejects_any_implicit_frame_time_center_or_epoch_alignment(candidate, message):
    with pytest.raises(PropagatorComparisonError, match=message):
        compare_trajectories(
            (state(0),),
            candidate,
            reference_name="Referencia",
            candidate_name="Candidata",
        )


def test_comparison_rejects_different_realizations_of_the_same_frame():
    with pytest.raises(PropagatorComparisonError, match="no comparten contrato"):
        compare_trajectories(
            (state(0, frame=FrameId.ITRF, frame_realization="ITRF2020"),),
            (state(0, frame=FrameId.ITRF, frame_realization="ITRF2014"),),
            reference_name="ITRF2020",
            candidate_name="ITRF2014",
        )


def test_comparison_rejects_unordered_samples_velocity_mismatch_and_invalid_thresholds():
    with pytest.raises(PropagatorComparisonError, match="estrictamente crecientes"):
        compare_trajectories(
            (state(60), state(0)),
            (state(60), state(0)),
            reference_name="Referencia",
            candidate_name="Candidata",
        )

    with pytest.raises(PropagatorComparisonError, match="velocidad ambas o ninguna"):
        compare_trajectories(
            (state(0),),
            (state(0, velocity_m_s=None),),
            reference_name="Referencia",
            candidate_name="Candidata",
        )

    without_velocity = (state(0, velocity_m_s=None),)
    with pytest.raises(PropagatorComparisonError, match="sin velocidad"):
        compare_trajectories(
            without_velocity,
            without_velocity,
            reference_name="Referencia",
            candidate_name="Candidata",
            velocity_threshold_m_s=0.0,
        )

    for invalid_threshold in (-1.0, math.inf, math.nan):
        with pytest.raises(PropagatorComparisonError, match="finito"):
            compare_trajectories(
                (state(0),),
                (state(0),),
                reference_name="Referencia",
                candidate_name="Candidata",
                position_threshold_m=invalid_threshold,
            )

    with pytest.raises(PropagatorComparisonError, match="numérico"):
        compare_trajectories(
            (state(0),),
            (state(0),),
            reference_name="Referencia",
            candidate_name="Candidata",
            position_threshold_m=True,
        )


def test_comparison_rejects_mixed_contract_inside_one_trajectory_and_empty_series():
    with pytest.raises(PropagatorComparisonError, match="no comparte el contrato"):
        compare_trajectories(
            (state(0), replace(state(60), frame=FrameId.GCRF)),
            (state(0), state(60)),
            reference_name="Referencia",
            candidate_name="Candidata",
        )

    with pytest.raises(PropagatorComparisonError, match="al menos una muestra"):
        compare_trajectories((), (), reference_name="Referencia", candidate_name="Candidata")


def test_comparison_fails_closed_if_finite_state_components_overflow_the_error_norm():
    with pytest.raises(PropagatorComparisonError, match="no es finita"):
        compare_trajectories(
            (state(0, position_m=(1e308, 0.0, 0.0)),),
            (state(0, position_m=(-1e308, 0.0, 0.0)),),
            reference_name="Referencia",
            candidate_name="Candidata",
        )


def test_native_two_body_and_cowell_samples_can_be_compared_without_a_renderer_or_transform():
    radius_km = 7_000.0
    keplerian = {
        "semi_major_axis_km": radius_km,
        "eccentricity": 0.0,
        "inclination_deg": 25.0,
        "raan_deg": 10.0,
        "argument_of_perigee_deg": 0.0,
        "mean_anomaly_deg": 0.0,
    }
    two_body = TwoBodyPropagator(EPOCH, keplerian)
    initial = two_body.native_state_at(EPOCH)
    assert initial.velocity_m_s is not None
    cowell = CowellPropagator(
        EPOCH,
        {
            "position_eme2000_km": {
                "x": initial.position_m[0] / 1_000.0,
                "y": initial.position_m[1] / 1_000.0,
                "z": initial.position_m[2] / 1_000.0,
            },
            "velocity_eme2000_km_s": {
                "x": initial.velocity_m_s[0] / 1_000.0,
                "y": initial.velocity_m_s[1] / 1_000.0,
                "z": initial.velocity_m_s[2] / 1_000.0,
            },
        },
        gravity_model="two-body",
    )
    instants = tuple(EPOCH + timedelta(minutes=minutes) for minutes in (0, 5, 10))

    result = compare_trajectories(
        tuple(two_body.native_state_at(instant) for instant in instants),
        tuple(cowell.native_state_at(instant) for instant in instants),
        reference_name="Dos cuerpos analítico",
        candidate_name="Cowell RK4",
        reference_model_id="two-body",
        candidate_model_id="cowell-rk4",
        position_threshold_m=100.0,
        velocity_threshold_m_s=0.1,
    )

    assert result.contract.frame == "EME2000"
    assert result.contract.time_scale is TimeScale.UTC
    assert result.position.maximum < 100.0
    assert result.position.first_threshold_crossing is None
    assert result.velocity is not None
    assert result.velocity.maximum < 0.1

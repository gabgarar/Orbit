"""Safe, frame-explicit primitives for future propagator comparisons.

This module deliberately has no HTTP route or renderer dependency.  A caller
must sample both propagators in the *same declared native or transformed
frame* before submitting them here.  It will not silently transform, relabel,
interpolate, or convert time scales: doing any of those inside an error metric
would make a numerical difference impossible to audit.

``StateVector`` is the only accepted sample type.  Its boundary guarantees SI
Cartesian components (metres and metres/second), an aware epoch, a time scale,
and a non-ambiguous frame.  This makes the output suitable as the backend
contract for a later UI/API without accepting untyped renderer tuples.
"""

from __future__ import annotations

import datetime
import math
from collections.abc import Sequence
from dataclasses import dataclass

from orbit_api.frames import StateVector
from orbit_api.timekeeping import TimeScale

_PERCENTILES = (50, 95, 99)


class PropagatorComparisonError(ValueError):
    """Raised when two trajectories do not have an auditable common contract."""


@dataclass(frozen=True, slots=True)
class TrajectoryContract:
    """The exact common contract under which errors were calculated.

    Position and velocity units are intentionally fixed rather than caller
    supplied.  They come from :class:`~orbit_api.frames.StateVector` and make
    it impossible to accidentally compare kilometres with metres here.
    """

    frame: str
    frame_realization: str | None
    frame_label: str
    time_scale: TimeScale
    center: str
    position_units: str = "m"
    velocity_units: str = "m/s"


@dataclass(frozen=True, slots=True)
class ThresholdCrossing:
    """The first sample whose error is strictly greater than its threshold."""

    sample_index: int
    epoch: datetime.datetime
    error: float
    threshold: float


@dataclass(frozen=True, slots=True)
class ErrorMetrics:
    """Distribution of Euclidean state-component error magnitudes.

    Percentiles use deterministic linear interpolation on the ordered samples:
    for percentile ``p``, the rank is ``(n - 1) * p / 100``.  RMS is
    ``sqrt(mean(error**2))`` and the mean is the arithmetic mean of norms.
    """

    sample_count: int
    mean: float
    rms: float
    maximum: float
    p50: float
    p95: float
    p99: float
    threshold: float | None
    first_threshold_crossing: ThresholdCrossing | None


@dataclass(frozen=True, slots=True)
class ComparisonSample:
    """Error values at one common sample epoch, in the contract SI units."""

    index: int
    epoch: datetime.datetime
    position_error_m: float
    velocity_error_m_s: float | None


@dataclass(frozen=True, slots=True)
class PropagatorComparisonResult:
    """Pure comparison result for a future endpoint, table, or chart."""

    reference_name: str
    candidate_name: str
    reference_model_id: str | None
    candidate_model_id: str | None
    contract: TrajectoryContract
    samples: tuple[ComparisonSample, ...]
    position: ErrorMetrics
    velocity: ErrorMetrics | None


def _label(value: object, *, field: str) -> str:
    label = str(value or "").strip()
    if not label:
        raise PropagatorComparisonError(f"{field} es obligatorio")
    return label


def _optional_label(value: object | None, *, field: str) -> str | None:
    return None if value is None else _label(value, field=field)


def _frame_name(state: StateVector) -> str:
    frame = state.frame
    return frame.value if hasattr(frame, "value") else str(frame)


def _contract_for(state: StateVector) -> TrajectoryContract:
    return TrajectoryContract(
        frame=_frame_name(state),
        frame_realization=state.frame_realization,
        frame_label=state.frame_label,
        time_scale=state.time_scale,
        center=state.center,
    )


def _same_contract(left: TrajectoryContract, right: TrajectoryContract) -> bool:
    return (
        left.frame == right.frame
        and left.frame_realization == right.frame_realization
        and left.time_scale is right.time_scale
        and left.center == right.center
    )


def _contract_description(contract: TrajectoryContract) -> str:
    realization = f", realización {contract.frame_realization}" if contract.frame_realization else ""
    return f"marco {contract.frame}{realization}, escala {contract.time_scale.value}, centro {contract.center}"


def _validate_trajectory(states: Sequence[StateVector], *, name: str) -> tuple[StateVector, ...]:
    samples = tuple(states)
    if not samples:
        raise PropagatorComparisonError(f"La trayectoria {name} debe contener al menos una muestra")
    if not all(isinstance(state, StateVector) for state in samples):
        raise PropagatorComparisonError(
            f"La trayectoria {name} debe contener StateVector con unidades SI, época y marco explícitos"
        )

    expected = _contract_for(samples[0])
    expected_velocity = samples[0].velocity_m_s is not None
    previous_epoch: datetime.datetime | None = None
    for index, state in enumerate(samples):
        actual = _contract_for(state)
        if not _same_contract(expected, actual):
            raise PropagatorComparisonError(
                f"La muestra {index} de {name} no comparte el contrato de "
                f"la primera muestra ({_contract_description(expected)})"
            )
        if (state.velocity_m_s is not None) != expected_velocity:
            raise PropagatorComparisonError(
                f"La trayectoria {name} mezcla muestras con y sin velocidad; "
                "declara velocidad para todas o para ninguna"
            )
        if previous_epoch is not None and state.epoch <= previous_epoch:
            raise PropagatorComparisonError(
                f"Las épocas de {name} deben ser estrictamente crecientes y no duplicadas"
            )
        previous_epoch = state.epoch
    return samples


def _validate_threshold(value: float | None, *, unit: str) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise PropagatorComparisonError(f"El umbral de {unit} debe ser numérico")
    try:
        threshold = float(value)
    except (TypeError, ValueError) as exc:
        raise PropagatorComparisonError(f"El umbral de {unit} debe ser numérico") from exc
    if not math.isfinite(threshold) or threshold < 0.0:
        raise PropagatorComparisonError(f"El umbral de {unit} debe ser finito y mayor o igual que cero")
    return threshold


def _norm_difference(left: tuple[float, float, float], right: tuple[float, float, float]) -> float:
    error = math.hypot(*(a - b for a, b in zip(left, right, strict=True)))
    if not math.isfinite(error):
        raise PropagatorComparisonError(
            "La diferencia vectorial no es finita; las componentes exceden el rango numérico seguro"
        )
    return error


def _percentile(sorted_values: tuple[float, ...], percentage: int) -> float:
    """Return the documented linearly-interpolated percentile."""

    rank = (len(sorted_values) - 1) * (percentage / 100.0)
    lower = math.floor(rank)
    upper = math.ceil(rank)
    if lower == upper:
        return sorted_values[lower]
    fraction = rank - lower
    return sorted_values[lower] + ((sorted_values[upper] - sorted_values[lower]) * fraction)


def _metrics(
    errors: tuple[float, ...],
    epochs: tuple[datetime.datetime, ...],
    *,
    threshold: float | None,
) -> ErrorMetrics:
    if len(errors) != len(epochs) or not errors:
        raise PropagatorComparisonError("Las métricas requieren errores y épocas no vacíos alineados")
    if not all(math.isfinite(error) and error >= 0.0 for error in errors):
        raise PropagatorComparisonError("Las métricas requieren errores finitos no negativos")
    sorted_errors = tuple(sorted(errors))
    crossing = next(
        (
            ThresholdCrossing(index, epoch, error, threshold)
            for index, (epoch, error) in enumerate(zip(epochs, errors, strict=True))
            if threshold is not None and error > threshold
        ),
        None,
    )
    maximum = sorted_errors[-1]
    if maximum == 0.0:
        mean = rms = 0.0
    else:
        # Scaling avoids overflowing while calculating a valid RMS/mean from
        # very large but finite SI components.
        mean = maximum * (math.fsum(error / maximum for error in errors) / len(errors))
        rms = maximum * math.sqrt(
            math.fsum((error / maximum) ** 2 for error in errors) / len(errors)
        )
    return ErrorMetrics(
        sample_count=len(errors),
        mean=mean,
        rms=rms,
        maximum=maximum,
        p50=_percentile(sorted_errors, _PERCENTILES[0]),
        p95=_percentile(sorted_errors, _PERCENTILES[1]),
        p99=_percentile(sorted_errors, _PERCENTILES[2]),
        threshold=threshold,
        first_threshold_crossing=crossing,
    )


def compare_trajectories(
    reference_states: Sequence[StateVector],
    candidate_states: Sequence[StateVector],
    *,
    reference_name: str,
    candidate_name: str,
    reference_model_id: str | None = None,
    candidate_model_id: str | None = None,
    position_threshold_m: float | None = None,
    velocity_threshold_m_s: float | None = None,
) -> PropagatorComparisonResult:
    """Compare aligned SI state trajectories without hidden frame/time work.

    Both series must have equal length and exactly the same ordered epochs.
    Their frame *including realization*, time scale, centre, and velocity
    availability must match.  A caller that needs ITRF→ECI must perform that
    validated transformation before this boundary; the comparison itself
    intentionally cannot claim or construct an ECI route.

    A threshold is breached only when ``error > threshold``.  Equality is
    within the accepted limit, which avoids a false alert from exact boundary
    values.  When no velocity is supplied by either series, velocity metrics
    are ``None`` and a velocity threshold is rejected.
    """

    reference_label = _label(reference_name, field="reference_name")
    candidate_label = _label(candidate_name, field="candidate_name")
    reference_model = _optional_label(reference_model_id, field="reference_model_id")
    candidate_model = _optional_label(candidate_model_id, field="candidate_model_id")
    reference = _validate_trajectory(reference_states, name=reference_label)
    candidate = _validate_trajectory(candidate_states, name=candidate_label)
    if len(reference) != len(candidate):
        raise PropagatorComparisonError(
            "Las trayectorias deben tener el mismo número de muestras y las mismas épocas"
        )

    contract = _contract_for(reference[0])
    candidate_contract = _contract_for(candidate[0])
    if not _same_contract(contract, candidate_contract):
        raise PropagatorComparisonError(
            "Las trayectorias no comparten contrato: referencia "
            f"({_contract_description(contract)}), candidata "
            f"({_contract_description(candidate_contract)})"
        )

    position_threshold = _validate_threshold(position_threshold_m, unit="posición (m)")
    velocity_threshold = _validate_threshold(velocity_threshold_m_s, unit="velocidad (m/s)")
    has_velocity = reference[0].velocity_m_s is not None
    if has_velocity != (candidate[0].velocity_m_s is not None):
        raise PropagatorComparisonError(
            "Las trayectorias deben declarar velocidad ambas o ninguna; no se omiten errores silenciosamente"
        )
    if not has_velocity and velocity_threshold is not None:
        raise PropagatorComparisonError(
            "No se puede aplicar un umbral de velocidad a trayectorias sin velocidad"
        )

    samples: list[ComparisonSample] = []
    position_errors: list[float] = []
    velocity_errors: list[float] = []
    epochs: list[datetime.datetime] = []
    for index, (reference_state, candidate_state) in enumerate(zip(reference, candidate, strict=True)):
        if reference_state.epoch != candidate_state.epoch:
            raise PropagatorComparisonError(
                f"Las épocas no están alineadas en la muestra {index}; no se interpola automáticamente"
            )
        position_error = _norm_difference(reference_state.position_m, candidate_state.position_m)
        velocity_error: float | None = None
        if has_velocity:
            reference_velocity = reference_state.velocity_m_s
            candidate_velocity = candidate_state.velocity_m_s
            if reference_velocity is None or candidate_velocity is None:  # Defensive type/runtime guard.
                raise PropagatorComparisonError("La disponibilidad de velocidad cambió dentro de la comparación")
            velocity_error = _norm_difference(reference_velocity, candidate_velocity)
            velocity_errors.append(velocity_error)
        samples.append(
            ComparisonSample(
                index=index,
                epoch=reference_state.epoch,
                position_error_m=position_error,
                velocity_error_m_s=velocity_error,
            )
        )
        position_errors.append(position_error)
        epochs.append(reference_state.epoch)

    frozen_epochs = tuple(epochs)
    return PropagatorComparisonResult(
        reference_name=reference_label,
        candidate_name=candidate_label,
        reference_model_id=reference_model,
        candidate_model_id=candidate_model,
        contract=contract,
        samples=tuple(samples),
        position=_metrics(tuple(position_errors), frozen_epochs, threshold=position_threshold),
        velocity=(
            _metrics(tuple(velocity_errors), frozen_epochs, threshold=velocity_threshold)
            if has_velocity
            else None
        ),
    )

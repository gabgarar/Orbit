"""Propagated osculating-element inspection for catalogue and manual orbits.

The renderer's normal state contract is ITRF in metres. That is the right
contract for Cesium, but it is not an inertial state from which classical
orbital elements should be inferred. This service intentionally samples the
native dynamics state instead: TEME for TLE/SGP4 and EME2000 for manual native
engines. The returned elements are therefore explicitly *osculating* in the
frame reported by the response.
"""

from __future__ import annotations

import datetime
import math
from bisect import bisect_left
from collections.abc import Callable
from typing import Any

from orbit_api.application.manual_erp import (
    ManualErpError,
    ManualErpRepository,
    resolve_manual_erp_input,
)
from orbit_api.application.manual_orbits import (
    ManualOrbitError,
    automatic_earth_orientation_window,
    build_manual_orbit_propagator,
    canonical_manual_orbit,
    manual_erp_frame_transformer,
    manual_orbit_requires_erp,
    require_manual_erp_for_force_terms,
    validate_manual_erp_coverage,
)
from orbit_api.domain.requests import (
    OrbitParametersRequest,
    require_manual_orbit_runtime_propagator,
)
from orbit_api.formats import OemStateProvider
from orbit_api.frames import (
    FrameId,
    FrameTransformationError,
    FrameTransformService,
    StateVector,
)
from orbit_api.orbits.forces import GravityFieldModel, GravityModelRegistry
from orbit_api.orbits.propagators.classical import (
    EARTH_EQUATORIAL_RADIUS_KM,
    EARTH_MU_KM3_S2,
)
from orbit_api.timekeeping import ensure_utc as normalize_utc

_TWO_PI = 2.0 * math.pi
_RAD_TO_DEG = 180.0 / math.pi
_CIRCULAR_TOLERANCE = 1e-8
_SINGULARITY_TOLERANCE = 1e-10
_INSPECTOR_INERTIAL_FRAMES = {
    FrameId.TEME,
    FrameId.GCRF,
    FrameId.ICRF,
    FrameId.EME2000,
}
_INSPECTOR_OUTPUT_FRAMES = (
    FrameId.TEME,
    FrameId.ITRF,
    FrameId.EME2000,
    FrameId.GCRF,
    FrameId.ICRF,
)

# Native fixed-step RK4 models intentionally use a 60 s internal step.
# Sampling an inspector range far from a manual epoch would otherwise turn one
# request into hundreds of thousands of force evaluations. This applies to
# Cowell/RK4 and to the retained legacy J2/J3/J4 preset.
_COWELL_RK4_INTERNAL_STEP_SECONDS = 60.0
_COWELL_RK4_MAX_INSPECTOR_STEPS = 7_200


class OrbitParametersError(ValueError):
    """A source state cannot yield a meaningful bounded-orbit inspection."""


def _rk4_required_integration_steps(
    start_time: datetime.datetime,
    end_time: datetime.datetime,
    epoch: datetime.datetime,
    samples: int,
) -> int:
    """Return the RK4 steps needed to reach all requested samples.

    Native RK4 propagators cache states and this endpoint samples
    chronologically, so a range wholly on one side of the epoch normally needs
    only the furthest endpoint. The exact amount is also affected by sample
    density: sub-minute points can make the integrator execute one shortened
    RK4 step per point. Do not materialise an unbounded ordered cache here:
    the public inspector request can legitimately contain a full year at a
    one-minute cadence for analytical sources. A numerical RK4 request with
    more distinct samples than its internal step budget already exceeds that
    budget before any force evaluation.
    """

    if samples - 1 > _COWELL_RK4_MAX_INSPECTOR_STEPS:
        # Every distinct requested epoch beyond the seed requires at least
        # one fixed-step evaluation.  Returning the first over-budget value
        # lets the caller reject immediately instead of performing O(n²)
        # insertions into the cache merely to produce an error.
        return _COWELL_RK4_MAX_INSPECTOR_STEPS + 1

    duration_seconds = (end_time - start_time).total_seconds()
    cached_offsets = [0.0]
    required_steps = 0
    for index in range(samples):
        # Match the timestamp arithmetic in ``build_orbit_parameters`` so a
        # boundary request is assessed with the same microsecond rounding as
        # the propagation loop itself.
        instant = start_time + datetime.timedelta(
            seconds=duration_seconds * (index / (samples - 1))
        )
        target_offset = (instant - epoch).total_seconds()
        insertion = bisect_left(cached_offsets, target_offset)
        if insertion < len(cached_offsets) and cached_offsets[insertion] == target_offset:
            continue
        candidates: list[float] = []
        if insertion:
            candidates.append(cached_offsets[insertion - 1])
        if insertion < len(cached_offsets):
            candidates.append(cached_offsets[insertion])
        source_offset = min(candidates, key=lambda value: abs(value - target_offset))
        required_steps += math.ceil(
            abs(target_offset - source_offset) / _COWELL_RK4_INTERNAL_STEP_SECONDS
        )
        cached_offsets.insert(insertion, target_offset)
    return required_steps


def _enforce_numerical_inspector_budget(
    *,
    start_time: datetime.datetime,
    end_time: datetime.datetime,
    epoch: datetime.datetime,
    model: dict[str, Any],
    samples: int,
) -> None:
    """Reject a request that would overwork a native fixed-step RK4 path."""

    if not model.get("inspector_requires_numerical_budget"):
        return

    required_steps = _rk4_required_integration_steps(
        start_time,
        end_time,
        epoch,
        samples=samples,
    )
    if required_steps <= _COWELL_RK4_MAX_INSPECTOR_STEPS:
        return

    maximum_hours = (
        _COWELL_RK4_MAX_INSPECTOR_STEPS * _COWELL_RK4_INTERNAL_STEP_SECONDS / 3600.0
    )
    required_hours = required_steps * _COWELL_RK4_INTERNAL_STEP_SECONDS / 3600.0
    engine_label = "Cowell/RK4" if model.get("applied_engine") == "cowell-rk4" else str(
        model.get("label", "el modelo numérico seleccionado")
    )
    raise OrbitParametersError(
        f"El inspector limita {engine_label} a "
        f"{_COWELL_RK4_MAX_INSPECTOR_STEPS:,} pasos internos "
        f"(~{maximum_hours:g} h de integración a 60 s/paso) por solicitud; este rango requiere "
        f"al menos {required_steps:,} pasos (equivalentes a ~{required_hours:g} h de integración). "
        "Reduce el intervalo, acerca el epoch al intervalo o usa un propagador analítico."
    )


def _magnitude(vector: tuple[float, float, float]) -> float:
    return math.sqrt(sum(value * value for value in vector))


def _dot(left: tuple[float, float, float], right: tuple[float, float, float]) -> float:
    return sum(a * b for a, b in zip(left, right, strict=True))


def _cross(left: tuple[float, float, float], right: tuple[float, float, float]) -> tuple[float, float, float]:
    return (
        (left[1] * right[2]) - (left[2] * right[1]),
        (left[2] * right[0]) - (left[0] * right[2]),
        (left[0] * right[1]) - (left[1] * right[0]),
    )


def _wrap_degrees(value: float) -> float:
    wrapped = float(value) % 360.0
    return 0.0 if math.isclose(wrapped, 360.0, abs_tol=1e-12) else wrapped


def _clamped_acos(value: float) -> float:
    return math.acos(max(-1.0, min(1.0, value)))


def _state_frame_label(state: StateVector) -> str:
    """Return the source's exact frame label without dropping a realization."""

    return state.frame_label


def _public_state_provenance(value: Any) -> Any:
    """Keep native provenance JSON-safe without inventing a simplified label.

    Format readers mostly publish primitive values, but an integration can
    attach datetimes, enums, tuples, or nested mappings.  The inspector is a
    public API, so return their factual value in a JSON-compatible shape
    rather than leaking an internal MappingProxyType (or failing the route's
    response encoder).
    """

    if isinstance(value, datetime.datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _public_state_provenance(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [_public_state_provenance(item) for item in value]
    if hasattr(value, "value") and isinstance(value.value, str):
        return value.value
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _native_state_vector_payload(state: StateVector) -> dict[str, Any]:
    """Publish a native tabular state without forcing it through six-vector APIs.

    SP3/OEM products can legitimately omit velocity.  Their samples must
    remain inspectable as Cartesian position records instead of being rejected
    just because osculating elements require a six-component inertial state.
    """

    payload: dict[str, Any] = {
        "reference_frame": _state_frame_label(state),
        "frame": state.frame.value if isinstance(state.frame, FrameId) else str(state.frame),
        "frame_realization": state.frame_realization,
        "center": state.center,
        "epoch": state.epoch.isoformat(),
        "time_scale": state.time_scale.value,
        "position_units": "km",
        "position": {
            "x": state.position_m[0] / 1_000.0,
            "y": state.position_m[1] / 1_000.0,
            "z": state.position_m[2] / 1_000.0,
        },
        "provenance": _public_state_provenance(dict(state.provenance)),
    }
    if state.velocity_m_s is not None:
        payload["velocity_units"] = "km/s"
        payload["velocity"] = {
            "x": state.velocity_m_s[0] / 1_000.0,
            "y": state.velocity_m_s[1] / 1_000.0,
            "z": state.velocity_m_s[2] / 1_000.0,
        }
    if state.acceleration_m_s2 is not None:
        payload["acceleration_units"] = "km/s^2"
        payload["acceleration"] = {
            "x": state.acceleration_m_s2[0] / 1_000.0,
            "y": state.acceleration_m_s2[1] / 1_000.0,
            "z": state.acceleration_m_s2[2] / 1_000.0,
        }
    if state.covariance is not None:
        # Covariance remains in the StateVector's SI basis.  No unit
        # conversion is inferred here because its mixed position/velocity
        # terms require a matrix-unit contract of their own.
        payload["covariance"] = [list(row) for row in state.covariance]
        payload["covariance_units"] = "SI-state-vector"
    return payload


def _native_state_components_km(state: StateVector) -> tuple[float, float, float, float, float, float]:
    """Convert a complete native state to the legacy km/km/s element input."""

    if state.velocity_m_s is None:
        raise OrbitParametersError("El estado nativo no contiene velocidad para derivar elementos osculantes")
    return (
        state.position_m[0] / 1_000.0,
        state.position_m[1] / 1_000.0,
        state.position_m[2] / 1_000.0,
        state.velocity_m_s[0] / 1_000.0,
        state.velocity_m_s[1] / 1_000.0,
        state.velocity_m_s[2] / 1_000.0,
    )


def _state_vector_for_inspector(
    state: StateVector | tuple[float, float, float, float, float, float],
    *,
    fallback_frame: str,
    instant: datetime.datetime,
) -> StateVector:
    """Return one explicit native ``StateVector`` for every inspector engine.

    Older propagators still expose a six-component km/km/s tuple.  Output
    transformations must not operate on that unlabelled tuple, so build the
    same explicit Earth-centred, UTC state that those propagators document.
    Modern providers already return their own richer state (including source
    time scale, realization, covariance and acceleration) unchanged.
    """

    if isinstance(state, StateVector):
        return state
    try:
        components = tuple(float(value) for value in state)
    except (TypeError, ValueError) as exc:
        raise OrbitParametersError(
            "El propagador devolviÃ³ un vector de estado no numÃ©rico"
        ) from exc
    if len(components) != 6:
        raise OrbitParametersError("El propagador devolviÃ³ un vector de estado invÃ¡lido")
    return StateVector.from_kilometres(
        epoch=instant,
        time_scale="UTC",
        frame=fallback_frame,
        frame_realization=None,
        center="EARTH",
        position_km=components[:3],
        velocity_km_s=components[3:],
        provenance={"state_source": "legacy-native-propagator"},
    )


def _requested_output_frame(payload: OrbitParametersRequest) -> FrameId | None:
    """Resolve the request's already-validated output frame to ``FrameId``."""

    if payload.output_frame is None:
        return None
    try:
        return FrameId(payload.output_frame)
    except ValueError as exc:  # Defensive guard for model-copy/direct callers.
        raise OrbitParametersError(
            f"El marco de salida solicitado '{payload.output_frame}' no estÃ¡ soportado"
        ) from exc


def _same_requested_output_frame(state: StateVector, target: FrameId) -> bool:
    """Return whether a request only confirms the already-native frame.

    ``ITRF`` is a generic request, while an imported state can carry a more
    precise realization such as IGS20.  It is safe and more truthful to retain
    that realization instead of attempting a datum relabel just to satisfy the
    generic output label.
    """

    return state.frame is target


def _transform_state_for_output(
    state: StateVector,
    *,
    requested_frame: FrameId | None,
    frame_transformer: FrameTransformService | None,
    instant: datetime.datetime,
) -> tuple[StateVector, dict[str, Any]]:
    """Produce the requested table state or fail before publishing a relabel.

    A caller can always inspect the native frame.  Once another frame is
    requested, though, a real ``FrameTransformService`` route (and therefore
    its EOP/leap-second contract where applicable) is mandatory.  There is no
    fallback that merely changes a frame string.
    """

    native_frame = _state_frame_label(state)
    if requested_frame is None:
        return state, {
            "requested_frame": None,
            "native_frame": native_frame,
            "output_frame": native_frame,
            "applied": False,
            "mode": "native",
        }
    if _same_requested_output_frame(state, requested_frame):
        return state, {
            "requested_frame": requested_frame.value,
            "native_frame": native_frame,
            "output_frame": native_frame,
            "applied": False,
            "mode": "native-request-confirmed",
        }
    if frame_transformer is None:
        raise OrbitParametersError(
            "Se solicitÃ³ output_frame="
            f"{requested_frame.value}, pero FrameTransformService no estÃ¡ configurado. "
            "No se puede cambiar el marco de un estado sin una transformaciÃ³n y EOP verificables."
        )
    try:
        transformed = frame_transformer.transform(
            state,
            target_frame=requested_frame,
        )
    except FrameTransformationError as exc:
        raise OrbitParametersError(
            "No se pudo transformar el estado del inspector de "
            f"{native_frame} a {requested_frame.value} en {instant.isoformat()}: {exc}"
        ) from exc
    except (TypeError, ValueError, ArithmeticError, OverflowError) as exc:
        raise OrbitParametersError(
            "La transformaciÃ³n de marco del inspector fallÃ³ de "
            f"{native_frame} a {requested_frame.value} en {instant.isoformat()}: {exc}"
        ) from exc
    if not isinstance(transformed, StateVector) or transformed.frame is not requested_frame:
        raise OrbitParametersError(
            "FrameTransformService no devolviÃ³ el marco de salida solicitado "
            f"({requested_frame.value})"
        )
    transform_provenance = transformed.provenance.get("frame_transform")
    return transformed, {
        "requested_frame": requested_frame.value,
        "native_frame": native_frame,
        "output_frame": _state_frame_label(transformed),
        "applied": True,
        "mode": "transformed",
        "path": list(transformed.transform_path),
        "provenance": _public_state_provenance(transform_provenance)
        if transform_provenance is not None
        else None,
    }


def _osculating_state_reason(state: StateVector) -> str | None:
    """Return why a Cartesian state cannot safely yield classical elements."""

    if state.center != "EARTH":
        return "Los elementos osculantes del inspector solo estÃ¡n definidos para estados centrados en la Tierra."
    if state.frame not in _INSPECTOR_INERTIAL_FRAMES:
        return (
            "Los elementos osculantes requieren un marco inercial; "
            f"el estado disponible estÃ¡ en {_state_frame_label(state)}."
        )
    if state.velocity_m_s is None:
        return "El estado cartesiano no contiene velocidad para derivar elementos osculantes."
    return None


def _select_osculating_calculation_state(
    native_state: StateVector,
    output_state: StateVector,
) -> tuple[StateVector | None, str | None, str | None]:
    """Prefer native inertial dynamics, then a safely transformed output.

    This keeps an ITRF *display* from relabelling elements that were computed
    in TEME/EME2000.  Conversely, a terrestrial tabular state transformed to
    GCRF may legitimately provide elements in that requested inertial output
    frame.  The returned string records which state was used for calculation.
    """

    native_reason = _osculating_state_reason(native_state)
    if native_reason is None:
        return native_state, "native", None
    output_reason = _osculating_state_reason(output_state)
    if output_reason is None:
        return output_state, "output", None
    if output_state is native_state:
        return None, None, native_reason
    return None, None, (
        f"Marco nativo: {native_reason} Marco de salida: {output_reason}"
    )


def _output_frame_capability(
    *,
    native_frame: str,
    output_frame: str,
    requested_frame: FrameId | None,
    frame_transformer: FrameTransformService | None,
    transform_applied: bool,
    calculation_frame: str | None,
    transform_provenance: dict[str, Any] | None,
) -> dict[str, Any]:
    """Expose exact frame provenance and safe selector capabilities to clients."""

    supported = [item.value for item in _INSPECTOR_OUTPUT_FRAMES]
    selectable = frame_transformer is not None
    requestable = supported if selectable else [native_frame]
    reason = (
        None
        if selectable
        else (
            "FrameTransformService no estÃ¡ configurado; solo se puede mostrar "
            "el marco nativo de esta fuente."
        )
    )
    return {
        "native": {"reference_frame": native_frame},
        "current": {"reference_frame": output_frame},
        "output": {
            "requested_frame": requested_frame.value if requested_frame is not None else None,
            "reference_frame": output_frame,
            "transformed": transform_applied,
            "provenance": transform_provenance if transform_applied else None,
        },
        "calculation": {
            "reference_frame": calculation_frame,
            "elements_follow_calculation_frame": calculation_frame is not None,
        },
        "supported_output_frames": supported,
        "available_output_frames": requestable,
        "requestable_output_frames": requestable,
        "selectable": selectable,
        "reason": reason,
        "frame_transform_service_configured": selectable,
        "selection_requires_runtime_validation": True,
    }


def _tabular_interpolation_contract(propagator: Any) -> dict[str, Any]:
    """Expose the actual per-provider interpolation declaration and cadence."""

    samples = tuple(getattr(propagator, "samples", ()) or ())
    cadence: float | None = None
    if len(samples) >= 2:
        try:
            cadence = (samples[-1].epoch - samples[0].epoch).total_seconds() / (len(samples) - 1)
        except (AttributeError, TypeError, ValueError, ArithmeticError):
            cadence = None
    declared_method = getattr(propagator, "declared_interpolation", None)
    declared_degree = getattr(propagator, "declared_interpolation_degree", None)
    if declared_method is None:
        method = "NONE" if len(samples) < 2 else "LINEAR"
    else:
        method = str(declared_method).strip().upper() or None
    return {
        "method": method,
        "declared_method": declared_method,
        "declared_degree": declared_degree,
        "sample_count": len(samples),
        "mean_sample_cadence_seconds": cadence,
    }


def _tabular_frame_label(propagator: Any) -> str:
    """Resolve a provider's native frame, retaining a terrestrial realization."""

    frame = getattr(propagator, "native_frame", None)
    realization = getattr(propagator, "native_realization", None)
    if frame is not None:
        frame_name = frame.value if isinstance(frame, FrameId) else str(frame)
        return str(realization or frame_name)
    return str(getattr(propagator, "dynamics_reference_frame", "")).strip() or "UNKNOWN"


def _tabular_osculating_capability(propagator: Any) -> tuple[bool, str | None]:
    """Allow two-body element derivation only for an Earth-centred inertial state.

    A tabular format is not itself a dynamics model.  We can nevertheless
    derive instantaneous elements when the source explicitly provides the
    full Cartesian state in one of the inertial frames Orbit understands.  A
    terrestrial SP3/OEM sample is deliberately kept Cartesian-only.
    """

    samples = tuple(getattr(propagator, "samples", ()) or ())
    if not samples:
        return False, "El proveedor tabular no declaró muestras nativas."
    first = samples[0]
    frame = getattr(first, "frame", None)
    center = str(getattr(first, "center", "")).strip().upper()
    inertial_frames = {FrameId.TEME, FrameId.GCRF, FrameId.ICRF, FrameId.EME2000}
    if frame not in inertial_frames:
        return False, "Las muestras tabulares no están en un marco inercial apto para elementos osculantes."
    if center != "EARTH":
        return False, "Los elementos osculantes del inspector solo están definidos para estados centrados en la Tierra."
    if any(getattr(sample, "velocity_m_s", None) is None for sample in samples):
        return False, "La efeméride tabular no declara velocidad en todas sus muestras."
    return True, None


def _tabular_native_state_provider(propagator: Any) -> Callable[[datetime.datetime], StateVector]:
    native_provider = getattr(propagator, "native_state_at", None)
    if not callable(native_provider):
        raise OrbitParametersError("El proveedor tabular no expone estados nativos para inspección")

    def state_at(moment: datetime.datetime) -> StateVector:
        result = native_provider(moment)
        if not isinstance(result, StateVector):
            raise OrbitParametersError("El proveedor tabular no devolvió un StateVector nativo válido")
        return result

    return state_at


def _tabular_frame_transformer(propagator: Any) -> FrameTransformService | None:
    """Return a tabular source's own frame/EOP route when it exposes one.

    Tabular SP3 and OEM providers own the transform service that was selected
    when their source was parsed. For an imported precise product this is the
    isolated clone bound to its paired ERP snapshot. Applying the generic
    runtime transformer later would discard that source-specific EOP choice,
    so the inspector deliberately follows the provider route for every
    tabular source. TLE and manual propagators continue to use the caller's
    runtime transformer.
    """

    candidate = getattr(propagator, "frame_transformer", None)
    return candidate if isinstance(candidate, FrameTransformService) else None


def _oem_selected_segment(
    propagator: OemStateProvider,
    *,
    segment_index: int | None,
    start_time: datetime.datetime,
    end_time: datetime.datetime,
) -> tuple[int, Any]:
    """Return one OEM segment only when its whole inspection interval is usable.

    OEM segment metadata can change frame, centre, time scale and interpolation
    contract.  The inspector must therefore never infer a segment from a
    partial interval or interpolate across a boundary.  A multi-segment OEM
    requires an explicit request choice; a one-segment OEM uses its sole
    segment by construction.
    """

    if propagator.segment_count > 1 and segment_index is None:
        raise OrbitParametersError(
            "La OEM contiene varios segmentos; especifica source.segmentIndex "
            "para inspeccionar uno sin cruzar discontinuidades"
        )
    if propagator.segment_count == 1:
        if segment_index is not None:
            raise OrbitParametersError(
                "source.segmentIndex solo se admite para una fuente OEM multisegmento"
            )
        selected_index = 0
    else:
        assert segment_index is not None
        selected_index = segment_index
    try:
        segment = propagator.segment(selected_index)
    except (TypeError, ValueError, IndexError) as exc:
        raise OrbitParametersError(
            f"La OEM no contiene el segmento solicitado ({selected_index})"
        ) from exc

    # Query both bounds through OemStateProvider rather than its bare
    # TabularStateProvider.  This applies the segment's source time scale and
    # retains OEM covariance attachment semantics at exact record epochs.
    try:
        propagator.native_state_at(start_time, segment_index=selected_index)
        propagator.native_state_at(end_time, segment_index=selected_index)
    except (TypeError, ValueError, ArithmeticError, OverflowError) as exc:
        raise OrbitParametersError(
            "El intervalo solicitado debe quedar integramente dentro de un unico "
            f"segmento OEM (segmentIndex={selected_index}); no se interpolan "
            f"discontinuidades. Detalle: {exc}"
        ) from exc
    return selected_index, segment


def _oem_native_state_provider(
    propagator: OemStateProvider,
    segment_index: int,
) -> Callable[[datetime.datetime], StateVector]:
    """Keep the OEM wrapper in the sampling path so covariance is not lost."""

    def state_at(moment: datetime.datetime) -> StateVector:
        result = propagator.native_state_at(moment, segment_index=segment_index)
        if not isinstance(result, StateVector):
            raise OrbitParametersError(
                "El proveedor OEM no devolvio un StateVector nativo valido"
            )
        return result

    return state_at


def _oem_segment_contract(
    propagator: OemStateProvider,
    *,
    segment_index: int,
    segment: Any,
) -> dict[str, Any]:
    """Expose selected OEM metadata without flattening its native contract."""

    metadata = propagator.metadata
    declared = metadata.segments[segment_index]
    covariances = propagator.covariances(segment_index=segment_index)
    return {
        "file_version": metadata.version,
        "creation_date": metadata.creation_date,
        "originator": metadata.originator,
        "segment_index": segment_index,
        "segment_count": propagator.segment_count,
        "object_name": declared.object_name,
        "object_id": declared.object_id,
        "center": declared.center_name,
        "reference_frame": declared.reference_frame.label,
        "time_scale": declared.time_scale.value,
        "declared_coverage": {
            "start_time": declared.start_time,
            "stop_time": declared.stop_time,
            "usable_start_time": declared.usable_start_time,
            "usable_stop_time": declared.usable_stop_time,
        },
        "native_state_coverage": {
            "start_time": segment.coverage_start.isoformat(),
            "stop_time": segment.coverage_stop.isoformat(),
            "time_scale": segment.native_time_scale.value,
        },
        "interpolation": _tabular_interpolation_contract(segment),
        "covariance": {
            "available": bool(covariances),
            "record_count": len(covariances),
            "attachment": "exact-epoch-only",
            "epochs": [record.epoch.isoformat() for record in covariances],
        },
    }


def derive_osculating_elements(
    state: tuple[float, float, float, float, float, float],
    *,
    reference_frame: str,
    central_body_mu_km3_s2: float = EARTH_MU_KM3_S2,
) -> dict[str, float | str]:
    """Derive bounded-orbit classical elements from an inertial-like state.

    TEME is returned as TEME rather than renamed ECI.  It is suitable for the
    same instantaneous two-body element derivation, while callers retain the
    exact frame caveat in the payload.  For circular/equatorial singularities
    the conventional undefined angles are reported as zero and the true
    anomaly field carries argument-of-latitude / true-longitude respectively.
    """

    try:
        x, y, z, vx, vy, vz = (float(value) for value in state)
        mu = float(central_body_mu_km3_s2)
    except (TypeError, ValueError) as exc:
        raise OrbitParametersError("El estado propagado no contiene seis valores numéricos") from exc
    if not all(math.isfinite(value) for value in (x, y, z, vx, vy, vz, mu)):
        raise OrbitParametersError("El estado propagado contiene valores no finitos")
    if mu <= 0.0:
        raise OrbitParametersError("El parámetro gravitacional central debe ser positivo")

    position = (x, y, z)
    velocity = (vx, vy, vz)
    radius = _magnitude(position)
    speed = _magnitude(velocity)
    if radius <= 0.0 or speed <= 0.0:
        raise OrbitParametersError("El estado propagado tiene posición o velocidad nula")

    angular_momentum = _cross(position, velocity)
    angular_momentum_magnitude = _magnitude(angular_momentum)
    if angular_momentum_magnitude <= _SINGULARITY_TOLERANCE:
        raise OrbitParametersError("El estado propagado tiene momento angular nulo")

    specific_energy = ((speed * speed) / 2.0) - (mu / radius)
    # This inspector intentionally supports the same bounded elliptic regime
    # as the manual editor.  Hyperbolic/parabolic records should not be
    # disguised with a negative period or fake apogee.
    if not specific_energy < 0.0:
        raise OrbitParametersError("El estado propagado no describe una órbita elíptica ligada")
    semi_major_axis = -mu / (2.0 * specific_energy)

    radial_velocity = _dot(position, velocity)
    eccentricity_vector = tuple(
        (((speed * speed) - (mu / radius)) * coordinate / mu)
        - ((radial_velocity * velocity_component) / mu)
        for coordinate, velocity_component in zip(position, velocity, strict=True)
    )
    raw_eccentricity = _magnitude(eccentricity_vector)
    if not math.isfinite(raw_eccentricity) or raw_eccentricity >= 1.0:
        raise OrbitParametersError("El estado propagado no describe una órbita elíptica válida")
    eccentricity = 0.0 if raw_eccentricity < _CIRCULAR_TOLERANCE else raw_eccentricity

    node = (-angular_momentum[1], angular_momentum[0], 0.0)
    node_magnitude = _magnitude(node)
    inclination = _clamped_acos(angular_momentum[2] / angular_momentum_magnitude)
    equatorial = node_magnitude <= angular_momentum_magnitude * _SINGULARITY_TOLERANCE
    retrograde_equatorial = equatorial and angular_momentum[2] < 0.0
    raan = 0.0 if equatorial else math.atan2(node[1], node[0])

    argument_of_perigee = 0.0
    if eccentricity:
        if equatorial:
            longitude_of_perigee = math.atan2(eccentricity_vector[1], eccentricity_vector[0])
            argument_of_perigee = -longitude_of_perigee if retrograde_equatorial else longitude_of_perigee
        else:
            argument_of_perigee = _clamped_acos(
                _dot(node, eccentricity_vector) / (node_magnitude * eccentricity)
            )
            if eccentricity_vector[2] < 0.0:
                argument_of_perigee = _TWO_PI - argument_of_perigee
        true_anomaly = _clamped_acos(_dot(eccentricity_vector, position) / (eccentricity * radius))
        if radial_velocity < 0.0:
            true_anomaly = _TWO_PI - true_anomaly
    elif equatorial:
        true_longitude = math.atan2(position[1], position[0])
        true_anomaly = -true_longitude if retrograde_equatorial else true_longitude
    else:
        # Circular inclined orbit: report argument of latitude in the
        # anomaly slot and make the convention discoverable in the response.
        true_anomaly = _clamped_acos(_dot(node, position) / (node_magnitude * radius))
        if position[2] < 0.0:
            true_anomaly = _TWO_PI - true_anomaly

    true_anomaly = true_anomaly % _TWO_PI
    eccentric_anomaly = 2.0 * math.atan2(
        math.sqrt(1.0 - eccentricity) * math.sin(true_anomaly / 2.0),
        math.sqrt(1.0 + eccentricity) * math.cos(true_anomaly / 2.0),
    )
    mean_anomaly = (eccentric_anomaly - (eccentricity * math.sin(eccentric_anomaly))) % _TWO_PI
    period_seconds = _TWO_PI * math.sqrt((semi_major_axis ** 3) / mu)
    mean_motion_rad_s = _TWO_PI / period_seconds
    perigee_radius = semi_major_axis * (1.0 - eccentricity)
    apogee_radius = semi_major_axis * (1.0 + eccentricity)

    return {
        "element_type": "osculating",
        "reference_frame": reference_frame,
        "semi_major_axis_km": semi_major_axis,
        "eccentricity": eccentricity,
        "inclination_deg": inclination * _RAD_TO_DEG,
        "raan_deg": _wrap_degrees(raan * _RAD_TO_DEG),
        "argument_of_perigee_deg": _wrap_degrees(argument_of_perigee * _RAD_TO_DEG),
        # The alias keeps the public prose/API terminology friendly while
        # retaining the existing project field used by manual-orbit records.
        "argument_of_periapsis_deg": _wrap_degrees(argument_of_perigee * _RAD_TO_DEG),
        "true_anomaly_deg": _wrap_degrees(true_anomaly * _RAD_TO_DEG),
        "mean_anomaly_deg": _wrap_degrees(mean_anomaly * _RAD_TO_DEG),
        "perigee_altitude_km": perigee_radius - EARTH_EQUATORIAL_RADIUS_KM,
        "apogee_altitude_km": apogee_radius - EARTH_EQUATORIAL_RADIUS_KM,
        "orbital_period_seconds": period_seconds,
        "mean_motion_rad_s": mean_motion_rad_s,
        "mean_motion_rev_day": mean_motion_rad_s * 86400.0 / _TWO_PI,
        "central_body_mu_km3_s2": mu,
        "radius_km": radius,
        "speed_km_s": speed,
    }


def _native_state_provider(
    propagator: Any,
    frame: str,
) -> Callable[[datetime.datetime], StateVector | tuple[float, float, float, float, float, float]]:
    """Return a native state without discarding runtime-only components.

    Historical propagators expose a six-component km/km/s tuple.  Modern
    native providers return a ``StateVector`` which can additionally carry a
    physically evaluated acceleration, covariance, and provenance.  The
    inspector must preserve that richer result verbatim; it must never infer
    an acceleration for a source such as SGP4 that did not publish one.
    """

    native_provider = getattr(propagator, "native_state_at", None)
    if callable(native_provider):
        def typed_state_at(moment: datetime.datetime) -> StateVector:
            result = native_provider(moment)
            if not isinstance(result, StateVector):
                raise OrbitParametersError("El propagador no devolvió un StateVector nativo válido")
            actual_frame = result.frame.value if hasattr(result.frame, "value") else str(result.frame)
            if actual_frame != frame:
                raise OrbitParametersError(
                    f"El propagador devolvió {actual_frame} cuando el inspector esperaba {frame}"
                )
            return result

        return typed_state_at
    method_name = "propagate_teme_datetime" if frame == "TEME" else "propagate_eme2000_datetime"
    provider = getattr(propagator, method_name, None)
    if not callable(provider) and frame == "EME2000":
        provider = getattr(propagator, "propagate_eci_datetime", None)
    if not callable(provider):
        raise OrbitParametersError(
            f"El propagador seleccionado no expone un estado {frame} para inspección orbital"
        )

    def state_at(moment: datetime.datetime) -> tuple[float, float, float, float, float, float]:
        result = provider(moment)
        if not isinstance(result, tuple) or len(result) != 6:
            raise OrbitParametersError("El propagador devolvió un vector de estado inválido")
        try:
            return tuple(float(value) for value in result)  # type: ignore[return-value]
        except (TypeError, ValueError) as exc:
            raise OrbitParametersError("El propagador devolvió un vector de estado no numérico") from exc

    return state_at


def _catalog_source(
    payload: OrbitParametersRequest,
    resolve_propagator: Callable,
    *,
    start_time: datetime.datetime,
    end_time: datetime.datetime,
) -> tuple[
    str,
    Callable,
    str,
    float,
    dict[str, Any],
    dict[str, Any],
    FrameTransformService | None,
]:
    source = payload.source
    name, propagator = resolve_propagator(source.sat_id, source.line1, source.line2)
    # OemStateProvider intentionally has no file-wide frame/samples facade:
    # its segments may differ. Select one explicitly before the generic
    # tabular branch, and keep the wrapper for native covariance handling.
    if isinstance(propagator, OemStateProvider):
        segment_index, segment = _oem_selected_segment(
            propagator,
            segment_index=source.segment_index,
            start_time=start_time,
            end_time=end_time,
        )
        frame = _tabular_frame_label(segment)
        osculating_available, osculating_reason = _tabular_osculating_capability(
            segment
        )
        interpolation = _tabular_interpolation_contract(segment)
        oem = _oem_segment_contract(
            propagator,
            segment_index=segment_index,
            segment=segment,
        )
        model = {
            "id": "tabular-oem",
            "label": "Estado tabular nativo OEM",
            "source_format": "OEM",
            "dynamics_reference_frame": frame,
            "state_reference_frame": frame,
            "ephemeris_reference_frame": frame,
            "state_source": "native_tabular_state",
            "interpolation": interpolation,
            "oem": oem,
            "osculating_elements": {
                "available": osculating_available,
                "reason": osculating_reason,
            },
        }
        identity = {
            "kind": "catalog",
            "name": name,
            "sat_id": source.sat_id,
            "runtime_id": source.sat_id,
            "source_format": "OEM",
            "reference_frame": frame,
            "state_source": "native_tabular_state",
            "interpolation": interpolation,
            "segment_index": segment_index,
            "oem": oem,
        }
        return (
            name,
            _oem_native_state_provider(propagator, segment_index),
            frame,
            EARTH_MU_KM3_S2,
            model,
            identity,
            _tabular_frame_transformer(segment),
        )

    if source.segment_index is not None:
        raise OrbitParametersError(
            "source.segmentIndex solo se admite para una fuente OEM multisegmento"
        )
    source_format = str(getattr(propagator, "source_format", "")).strip().upper()
    # Runtime imports may resolve a per-object TabularStateProvider rather
    # than an SGP4 propagator.  The object carries a native frame/time-state
    # contract, so never relabel it as TEME or route it through Satrec.
    if source_format in {"SP3", "OEM"}:
        frame = _tabular_frame_label(propagator)
        osculating_available, osculating_reason = _tabular_osculating_capability(propagator)
        interpolation = _tabular_interpolation_contract(propagator)
        model = {
            "id": f"tabular-{source_format.lower()}",
            "label": f"Estado tabular nativo {source_format}",
            "source_format": source_format,
            "dynamics_reference_frame": frame,
            "state_reference_frame": frame,
            "ephemeris_reference_frame": frame,
            "state_source": "native_tabular_state",
            "interpolation": interpolation,
            "osculating_elements": {
                "available": osculating_available,
                "reason": osculating_reason,
            },
        }
        identity = {
            "kind": "catalog",
            "name": name,
            "sat_id": source.sat_id,
            "runtime_id": source.sat_id,
            "source_format": source_format,
            "reference_frame": frame,
            "state_source": "native_tabular_state",
            "interpolation": interpolation,
        }
        return (
            name,
            _tabular_native_state_provider(propagator),
            frame,
            EARTH_MU_KM3_S2,
            model,
            identity,
            _tabular_frame_transformer(propagator),
        )
    # Catalogue OMM imports in Orbit may carry valid TLE lines and therefore
    # execute through SGP4. Preserve that input provenance independently from
    # the actual engine: it is an OMM-fed SGP4 calculation, not an invented
    # OMM analytical propagator.
    declared_catalog_format = str(
        getattr(source, "source_format", None) or source_format or "TLE"
    ).strip().upper()
    if declared_catalog_format not in {"TLE", "OMM"}:
        declared_catalog_format = "TLE"
    # Catalogues in Orbit are TLE/SGP4. Explicitly choose the raw TEME API;
    # `propagate_datetime` is ITRF and must never be inferred to be ECI.
    frame = str(getattr(propagator, "dynamics_reference_frame", "TEME"))
    sgp4_satrec = getattr(propagator, "sat", None)
    try:
        mu = float(getattr(sgp4_satrec, "mu", EARTH_MU_KM3_S2))
    except (TypeError, ValueError) as exc:
        raise OrbitParametersError("El propagador SGP4 no expone un parámetro gravitacional válido") from exc
    model = {
        "id": getattr(propagator, "model_id", "sgp4"),
        "label": "SGP4",
        "input_source_format": declared_catalog_format,
        "dynamics_reference_frame": "TEME",
        "state_reference_frame": "TEME",
        "ephemeris_reference_frame": (
            getattr(propagator, "ephemeris_reference_realization", None)
            or getattr(propagator, "ephemeris_reference_frame", "ITRF")
        ),
        "state_source": "raw_sgp4_teme",
        # Satrec owns its gravity constants (normally WGS-72 in sgp4).  Do
        # not silently derive TEME elements with the manual WGS-84 value.
        "central_body_mu_km3_s2": mu,
    }
    identity = {
        "kind": "catalog",
        "name": name,
        "sat_id": source.sat_id,
        "source_format": declared_catalog_format,
        "reference_frame": frame,
    }
    return name, _native_state_provider(propagator, frame), frame, mu, model, identity, None


def _manual_source(
    payload: OrbitParametersRequest,
    frame_transformer: FrameTransformService | None = None,
    gravity_field: GravityFieldModel | None = None,
    manual_erp_repository: ManualErpRepository | None = None,
    gravity_model_registry: GravityModelRegistry | None = None,
    coverage_start: datetime.datetime | None = None,
    coverage_end: datetime.datetime | None = None,
) -> tuple[
    str,
    Callable,
    str,
    float,
    dict[str, Any],
    dict[str, Any],
    FrameTransformService | None,
]:
    manual = payload.source.manual_orbit
    if manual is None:  # Defensive narrowing; the request model already rejects this.
        raise OrbitParametersError("Falta la definición de órbita manual")
    try:
        propagator_name = require_manual_orbit_runtime_propagator(manual.propagator)
    except ValueError as exc:
        raise ManualOrbitError(str(exc)) from exc
    try:
        manual_erp = resolve_manual_erp_input(manual.manual_erp, manual_erp_repository)
    except ManualErpError as exc:
        raise ManualOrbitError(str(exc)) from exc
    propagation_options = manual.propagation_options.canonical(
        propagator=propagator_name
    )
    require_manual_erp_for_force_terms(
        tuple(propagation_options["force_terms"]),
        manual_erp.provider if manual_erp is not None else None,
    )
    if (
        coverage_start is not None
        and coverage_end is not None
        and manual_orbit_requires_erp(tuple(propagation_options["force_terms"]))
    ):
        validate_manual_erp_coverage(
            frame_transformer=manual_erp_frame_transformer(
                frame_transformer,
                manual_erp.provider if manual_erp is not None else None,
            ),
            start_time=coverage_start,
            end_time=coverage_end,
        )
    definition_source, keplerian, state_vector = canonical_manual_orbit(manual)
    runtime_name, propagator, model = build_manual_orbit_propagator(
        propagator_name,
        name=manual.name,
        epoch=manual.epoch,
        keplerian=keplerian,
        state_vector=state_vector,
        propagation_options=propagation_options,
        frame_transformer=frame_transformer,
        gravity_field=gravity_field,
        gravity_model_registry=gravity_model_registry,
        manual_erp_provider=manual_erp.provider if manual_erp is not None else None,
        manual_erp_snapshot_id=manual_erp.snapshot_id if manual_erp is not None else None,
    )
    frame = "EME2000"
    model = {
        **model,
        "state_reference_frame": frame,
        "state_source": "native_manual_eme2000",
    }
    # Every runnable manual engine uses the WGS-84-compatible constant from
    # ``classical``. Manual SGP4/TEME is intentionally not a supported path.
    mu = EARTH_MU_KM3_S2
    model["central_body_mu_km3_s2"] = mu
    identity = {
        "kind": "manual",
        "name": manual.name,
        "runtime_id": runtime_name,
        "definition_source": definition_source,
        "reference_frame": frame,
        "object_metadata": manual.object_metadata.canonical(),
        "propagation_options": propagation_options,
        "manual_erp": manual_erp.payload() if manual_erp is not None else None,
    }
    return manual.name, _native_state_provider(propagator, frame), frame, mu, model, identity, None


def build_orbit_parameters(
    payload: OrbitParametersRequest,
    *,
    resolve_propagator: Callable,
    ensure_utc: Callable[[datetime.datetime], datetime.datetime] | None = None,
    frame_transformer: FrameTransformService | None = None,
    gravity_field: GravityFieldModel | None = None,
    manual_erp_repository: ManualErpRepository | None = None,
    gravity_model_registry: GravityModelRegistry | None = None,
) -> dict[str, Any]:
    """Sample a source at evenly spaced instants and derive only safe elements.

    Catalogue TLE/SGP4 and manual dynamics retain the established osculating
    response.  A runtime-resolved SP3/OEM TabularStateProvider instead exposes
    its native Cartesian samples, provenance, and declared interpolation.  It
    derives osculating elements only when that native state is explicitly
    Earth-centred, inertial, and complete.
    """

    normalise_utc = ensure_utc or normalize_utc
    start_time = normalise_utc(payload.start_time)
    end_time = normalise_utc(payload.end_time)
    if end_time <= start_time:
        # Pydantic already validates this; retain an application-layer guard
        # for direct callers/tests that may construct mutated models.
        raise OrbitParametersError("end_time debe ser mayor que start_time")

    if payload.source.kind == "manual":
        name, state_at, frame, mu, model, identity, source_frame_transformer = _manual_source(
            payload,
            frame_transformer,
            gravity_field,
            manual_erp_repository,
            gravity_model_registry,
            min(normalise_utc(payload.source.manual_orbit.epoch), start_time),
            max(normalise_utc(payload.source.manual_orbit.epoch), end_time),
        )
    else:
        name, state_at, frame, mu, model, identity, source_frame_transformer = _catalog_source(
            payload,
            resolve_propagator,
            start_time=start_time,
            end_time=end_time,
        )

    tabular_native = model.get("state_source") == "native_tabular_state"
    tabular_source_format = str(
        model.get("source_format") or identity.get("source_format") or ""
    ).upper() or None
    requested_output_frame = _requested_output_frame(payload)
    output_frame_transformer = source_frame_transformer or frame_transformer

    duration_seconds = (end_time - start_time).total_seconds()
    if payload.source.kind == "manual":
        manual = payload.source.manual_orbit
        if manual is None:  # Defensive narrowing; request validation rejects this shape.
            raise OrbitParametersError("Falta la definición de órbita manual")
        _enforce_numerical_inspector_budget(
            start_time=start_time,
            end_time=end_time,
            epoch=normalise_utc(manual.epoch),
            model=model,
            samples=payload.samples,
        )

    points: list[dict[str, Any]] = []
    output_frame_labels: list[str] = []
    calculation_frame_labels: list[str] = []
    osculating_unavailable_reasons: list[str] = []
    transform_provenances: list[dict[str, Any]] = []
    transform_applied = False
    for index in range(payload.samples):
        fraction = index / (payload.samples - 1)
        instant = start_time + datetime.timedelta(seconds=duration_seconds * fraction)
        try:
            raw_state = state_at(instant)
            native_state = _state_vector_for_inspector(
                raw_state,
                fallback_frame=frame,
                instant=instant,
            )
            output_state, frame_transform = _transform_state_for_output(
                native_state,
                requested_frame=requested_output_frame,
                frame_transformer=output_frame_transformer,
                instant=instant,
            )
            native_frame = _state_frame_label(native_state)
            output_frame = _state_frame_label(output_state)
            output_frame_labels.append(output_frame)
            transform_applied = transform_applied or bool(frame_transform["applied"])
            if isinstance(frame_transform.get("provenance"), dict):
                transform_provenances.append(frame_transform["provenance"])
            calculation_state, calculation_origin, unavailable_reason = (
                _select_osculating_calculation_state(native_state, output_state)
            )

            point: dict[str, Any] = {
                "time": instant.isoformat(),
                # The table always follows the selected output frame.  The
                # source/dynamics frame is retained alongside it so an ITRF
                # display cannot be mistaken for an ITRF element calculation.
                "reference_frame": output_frame,
                "native_reference_frame": native_frame,
                "output_reference_frame": output_frame,
                "frame_transform": frame_transform,
                "state": _native_state_vector_payload(output_state),
            }
            if tabular_native:
                if not isinstance(raw_state, StateVector):
                    raise OrbitParametersError("El proveedor tabular no devolvió un StateVector nativo válido")
                raw_interpolation = dict(native_state.provenance).get("tabular_interpolation")
                point["sampling"] = (
                    _public_state_provenance(raw_interpolation)
                    if isinstance(raw_interpolation, dict)
                    else {
                        "method": "EXACT",
                        "source_format": tabular_source_format,
                    }
                )

            if calculation_state is None:
                if not tabular_native:
                    raise OrbitParametersError(
                        unavailable_reason
                        or "El estado propagado no permite derivar elementos osculantes."
                    )
                reason = unavailable_reason or (
                    "El estado tabular no permite derivar elementos osculantes."
                )
                osculating_unavailable_reasons.append(reason)
                point["element_type"] = "native-cartesian"
                point["osculating_elements"] = {
                    "available": False,
                    "reason": reason,
                    "calculation_reference_frame": None,
                }
            else:
                calculation_frame = _state_frame_label(calculation_state)
                try:
                    elements = derive_osculating_elements(
                        _native_state_components_km(calculation_state),
                        reference_frame=calculation_frame,
                        central_body_mu_km3_s2=mu,
                    )
                except OrbitParametersError as exc:
                    if not tabular_native:
                        raise
                    reason = str(exc)
                    osculating_unavailable_reasons.append(reason)
                    point["element_type"] = "native-cartesian"
                    point["osculating_elements"] = {
                        "available": False,
                        "reason": reason,
                        "calculation_reference_frame": calculation_frame,
                        "calculation_state": calculation_origin,
                    }
                else:
                    calculation_frame_labels.append(calculation_frame)
                    point["element_type"] = "osculating"
                    point["elements"] = elements
                    point["osculating_elements"] = {
                        "available": True,
                        "calculation_reference_frame": calculation_frame,
                        "calculation_state": calculation_origin,
                    }
        except OrbitParametersError:
            raise
        except (TypeError, ValueError, ArithmeticError, OverflowError) as exc:
            raise OrbitParametersError(f"No se pudieron propagar parámetros orbitales: {exc}") from exc
        points.append(point)

    automatic_eop_window: dict[str, object] | None = None
    if payload.source.kind == "manual":
        manual = payload.source.manual_orbit
        force_terms = tuple(model.get("force_terms") or [])
        if (
            manual is not None
            and identity.get("manual_erp") is None
            and manual_orbit_requires_erp(force_terms)
        ):
            automatic_eop_window = automatic_earth_orientation_window(
                frame_transformer,
                min(normalise_utc(manual.epoch), start_time),
                max(normalise_utc(manual.epoch), end_time),
            )
            if automatic_eop_window is not None:
                model["earth_orientation_window"] = automatic_eop_window

    osculating_available = bool(points) and all(
        point.get("osculating_elements", {}).get("available") is True
        for point in points
    )
    osculating_reason = (
        osculating_unavailable_reasons[0] if osculating_unavailable_reasons else None
    )
    output_reference_frame = output_frame_labels[0] if output_frame_labels else frame
    calculation_reference_frame = (
        calculation_frame_labels[0] if calculation_frame_labels else None
    )
    frame_capability = _output_frame_capability(
        native_frame=frame,
        output_frame=output_reference_frame,
        requested_frame=requested_output_frame,
        frame_transformer=output_frame_transformer,
        transform_applied=transform_applied,
        calculation_frame=calculation_reference_frame,
        transform_provenance=(transform_provenances[0] if transform_provenances else None),
    )

    if tabular_native:
        inspector_capability = {
            "available": True,
            "mode": "native-cartesian" if not osculating_available else "native-cartesian-and-osculating",
            "source_format": tabular_source_format,
            "native_cartesian": {
                "available": True,
                "reference_frame": frame,
                "interpolation": model.get("interpolation"),
            },
            "output_cartesian": {
                "available": True,
                "reference_frame": output_reference_frame,
            },
            "osculating_elements": {
                "available": osculating_available,
                "reason": osculating_reason,
                "reference_frame": calculation_reference_frame,
            },
            "frame": frame_capability,
            "frames": frame_capability,
        }
    else:
        inspector_capability = {
            "available": True,
            "mode": "osculating-elements",
            "source_format": identity.get("source_format"),
            "native_cartesian": {"available": True, "reference_frame": frame},
            "output_cartesian": {
                "available": True,
                "reference_frame": output_reference_frame,
            },
            "osculating_elements": {
                "available": osculating_available,
                "reason": osculating_reason,
                "reference_frame": calculation_reference_frame,
            },
            "frame": frame_capability,
            "frames": frame_capability,
        }

    model["output_reference_frame"] = output_reference_frame
    model["requested_output_frame"] = (
        requested_output_frame.value if requested_output_frame is not None else None
    )
    model["frame_transform_service_configured"] = frame_transformer is not None
    if tabular_native:
        # Keep the source-declared capability intact and expose separately
        # what the selected output table can actually derive.  An ITRF SP3
        # transformed to GCRF is the important case: native elements remain
        # unavailable, while the verified inertial output can support them.
        model["native_osculating_elements"] = dict(
            model.get("osculating_elements") or {}
        )
    model["output_osculating_elements"] = {
        "available": osculating_available,
        "reason": osculating_reason,
        "reference_frame": calculation_reference_frame,
    }

    return {
        "source": identity,
        "satellite": name,
        "reference_frame": output_reference_frame,
        "native_reference_frame": frame,
        "output_reference_frame": output_reference_frame,
        "requested_output_frame": (
            requested_output_frame.value if requested_output_frame is not None else None
        ),
        "frame": frame_capability,
        "frames": frame_capability,
        "element_type": "osculating" if osculating_available else "native-cartesian",
        "model": model,
        "capabilities": {"inspector": inspector_capability},
        "start_time": start_time.isoformat(),
        "end_time": end_time.isoformat(),
        "duration_seconds": duration_seconds,
        "samples_requested": payload.samples,
        "count": len(points),
        "samples": points,
        "earth_orientation_window": automatic_eop_window,
        "earthOrientationWindow": automatic_eop_window,
    }

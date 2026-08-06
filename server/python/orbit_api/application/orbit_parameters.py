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

from orbit_api.application.manual_orbits import (
    ManualOrbitError,
    build_manual_orbit_propagator,
    canonical_manual_orbit,
)
from orbit_api.domain.requests import OrbitParametersRequest
from orbit_api.domain.requests import require_manual_orbit_runtime_propagator
from orbit_api.frames import FrameTransformService, StateVector
from orbit_api.orbits.propagators.classical import (
    EARTH_EQUATORIAL_RADIUS_KM,
    EARTH_MU_KM3_S2,
)
from orbit_api.timekeeping import ensure_utc as normalize_utc


_TWO_PI = 2.0 * math.pi
_RAD_TO_DEG = 180.0 / math.pi
_CIRCULAR_TOLERANCE = 1e-8
_SINGULARITY_TOLERANCE = 1e-10

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
    RK4 step per point. Simulate the tiny ordered cache here (at most 2,000
    entries) so the budget reflects both cases without force evaluation.
    """

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
        f"{required_steps:,} pasos (equivalentes a ~{required_hours:g} h de integración). "
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


def _state_vector_payload(
    state: tuple[float, float, float, float, float, float],
    frame: str,
) -> dict[str, Any]:
    x, y, z, vx, vy, vz = state
    return {
        "reference_frame": frame,
        "position_units": "km",
        "velocity_units": "km/s",
        "position": {"x": x, "y": y, "z": z},
        "velocity": {"x": vx, "y": vy, "z": vz},
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


def _native_state_provider(propagator: Any, frame: str) -> Callable[[datetime.datetime], tuple[float, float, float, float, float, float]]:
    native_provider = getattr(propagator, "native_state_at", None)
    if callable(native_provider):
        def typed_state_at(moment: datetime.datetime) -> tuple[float, float, float, float, float, float]:
            result = native_provider(moment)
            if not isinstance(result, StateVector):
                raise OrbitParametersError("El propagador no devolvió un StateVector nativo válido")
            actual_frame = result.frame.value if hasattr(result.frame, "value") else str(result.frame)
            if actual_frame != frame:
                raise OrbitParametersError(
                    f"El propagador devolvió {actual_frame} cuando el inspector esperaba {frame}"
                )
            components = result.components()
            return tuple(component / 1000.0 for component in components)  # type: ignore[return-value]

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


def _catalog_source(payload: OrbitParametersRequest, resolve_propagator: Callable) -> tuple[str, Callable, str, float, dict[str, Any], dict[str, Any]]:
    source = payload.source
    name, propagator = resolve_propagator(source.sat_id, source.line1, source.line2)
    # Catalogues in Orbit are TLE/SGP4.  Explicitly choose the raw TEME API;
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
        "reference_frame": frame,
    }
    return name, _native_state_provider(propagator, frame), frame, mu, model, identity


def _manual_source(
    payload: OrbitParametersRequest,
    frame_transformer: FrameTransformService | None = None,
) -> tuple[str, Callable, str, float, dict[str, Any], dict[str, Any]]:
    manual = payload.source.manual_orbit
    if manual is None:  # Defensive narrowing; the request model already rejects this.
        raise OrbitParametersError("Falta la definición de órbita manual")
    try:
        propagator_name = require_manual_orbit_runtime_propagator(manual.propagator)
    except ValueError as exc:
        raise ManualOrbitError(str(exc)) from exc
    definition_source, keplerian, state_vector = canonical_manual_orbit(manual)
    runtime_name, propagator, model = build_manual_orbit_propagator(
        propagator_name,
        name=manual.name,
        epoch=manual.epoch,
        keplerian=keplerian,
        state_vector=state_vector,
        propagation_options=manual.propagation_options.canonical(
            propagator=propagator_name
        ),
        frame_transformer=frame_transformer,
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
        "propagation_options": manual.propagation_options.canonical(
            propagator=propagator_name
        ),
    }
    return manual.name, _native_state_provider(propagator, frame), frame, mu, model, identity


def build_orbit_parameters(
    payload: OrbitParametersRequest,
    *,
    resolve_propagator: Callable,
    ensure_utc: Callable[[datetime.datetime], datetime.datetime] | None = None,
    frame_transformer: FrameTransformService | None = None,
) -> dict[str, Any]:
    """Propagate a source at evenly spaced instants and derive its elements."""

    normalise_utc = ensure_utc or normalize_utc
    start_time = normalise_utc(payload.start_time)
    end_time = normalise_utc(payload.end_time)
    if end_time <= start_time:
        # Pydantic already validates this; retain an application-layer guard
        # for direct callers/tests that may construct mutated models.
        raise OrbitParametersError("end_time debe ser mayor que start_time")

    if payload.source.kind == "manual":
        name, state_at, frame, mu, model, identity = _manual_source(
            payload,
            frame_transformer,
        )
    else:
        name, state_at, frame, mu, model, identity = _catalog_source(payload, resolve_propagator)

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
    for index in range(payload.samples):
        fraction = index / (payload.samples - 1)
        instant = start_time + datetime.timedelta(seconds=duration_seconds * fraction)
        try:
            state = state_at(instant)
            elements = derive_osculating_elements(
                state,
                reference_frame=frame,
                central_body_mu_km3_s2=mu,
            )
        except OrbitParametersError:
            raise
        except (TypeError, ValueError, ArithmeticError, OverflowError) as exc:
            raise OrbitParametersError(f"No se pudieron propagar parámetros orbitales: {exc}") from exc
        points.append({
            "time": instant.isoformat(),
            "reference_frame": frame,
            "element_type": "osculating",
            "state": _state_vector_payload(state, frame),
            "elements": elements,
        })

    return {
        "source": identity,
        "satellite": name,
        "reference_frame": frame,
        "element_type": "osculating",
        "model": model,
        "start_time": start_time.isoformat(),
        "end_time": end_time.isoformat(),
        "duration_seconds": duration_seconds,
        "samples_requested": payload.samples,
        "count": len(points),
        "samples": points,
    }

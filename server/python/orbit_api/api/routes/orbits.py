"""Orbit propagation and ephemeris HTTP endpoints."""

import datetime
from collections.abc import Callable

from fastapi import APIRouter, HTTPException, Query

from orbit_api.core.settings import AUTO_MAX_ORBIT_SAMPLES, PROPAGATION_HOURS_MAX, PROPAGATION_HOURS_MIN
from orbit_api.domain.requests import EphemerisRequest, OrbitRequest, PropagationRequest
from orbit_api.timekeeping import ensure_utc, utc_now


def create_orbits_router(
    resolve_propagator,
    serialize_state,
    auto_samples: Callable,
    build_ephemeris: Callable,
    renderer_state_at: Callable | None = None,
) -> APIRouter:
    """Build orbit routes from application-level operations."""
    router = APIRouter(tags=["orbits"])

    def unavailable(operation: str, satellite: str, exc: ValueError) -> HTTPException:
        """Project tabular-coverage/frame failures into an API error.

        An SP3 product can be perfectly valid while its historical coverage
        does not include ``utc_now()``, or while the declared terrestrial
        realization has no explicitly registered ITRF operation.  Those are
        data-availability conditions, not unhandled server failures.
        """

        return HTTPException(
            status_code=422,
            detail=f"{operation} no está disponible para {satellite}: {exc}",
        )

    def orbit_payload(
        name,
        propagator,
        horizon_hours: float,
        samples: int | None,
        reference_time: datetime.datetime | None = None,
    ) -> dict:
        sample_count = samples or auto_samples(horizon_hours, 1, propagator)
        reference_time = ensure_utc(reference_time or utc_now())
        points = []
        try:
            for index in range(sample_count):
                offset = (index / max(sample_count - 1, 1)) * horizon_hours * 3600
                moment = reference_time + datetime.timedelta(seconds=offset)
                if renderer_state_at is not None:
                    state = renderer_state_at(propagator, moment)
                    points.append({"x": state.position_m[0], "y": state.position_m[1], "z": state.position_m[2]})
                else:
                    x, y, z, _, _, _ = propagator.propagate_datetime(moment)
                    points.append({"x": x, "y": y, "z": z})
        except ValueError as exc:
            raise unavailable("La órbita solicitada", name, exc) from exc
        return {
            "satellite": name,
            "orbit_reference_time": reference_time.isoformat(),
            "orbit_horizon_hours": horizon_hours,
            "orbit_samples": sample_count,
            "orbit": points,
        }

    @router.get("/propagate/{sat_id}")
    def propagate_satellite_at(sat_id: str, at: datetime.datetime | None = Query(default=None)) -> dict:
        name, propagator = resolve_propagator(sat_id, None, None)
        target = ensure_utc(at or utc_now())
        try:
            if renderer_state_at is not None:
                state = renderer_state_at(propagator, target)
                return serialize_state(name, target, include_velocity=True, state=state)
            x, y, z, vx, vy, vz = propagator.propagate_datetime(target)
            return serialize_state(name, target, x, y, z, vx, vy, vz, include_velocity=True)
        except ValueError as exc:
            raise unavailable("El estado solicitado", name, exc) from exc

    @router.post("/propagate")
    def propagate_from_request(payload: PropagationRequest) -> dict:
        name, propagator = resolve_propagator(payload.sat_id, payload.line1, payload.line2)
        target = ensure_utc(payload.at or utc_now())
        try:
            if renderer_state_at is not None:
                state = renderer_state_at(propagator, target)
                return serialize_state(name, target, include_velocity=True, state=state)
            x, y, z, vx, vy, vz = propagator.propagate_datetime(target)
            return serialize_state(name, target, x, y, z, vx, vy, vz, include_velocity=True)
        except ValueError as exc:
            raise unavailable("El estado solicitado", name, exc) from exc

    @router.get("/orbits/{sat_id}")
    def orbit_for_satellite(
        sat_id: str,
        horizon_hours: float = Query(default=12.0, ge=PROPAGATION_HOURS_MIN, le=PROPAGATION_HOURS_MAX),
        samples: int | None = Query(default=None, ge=2, le=AUTO_MAX_ORBIT_SAMPLES),
        at: datetime.datetime | None = Query(default=None),
    ) -> dict:
        name, propagator = resolve_propagator(sat_id, None, None)
        return orbit_payload(name, propagator, horizon_hours, samples, at)

    @router.post("/orbits")
    def orbit_from_request(payload: OrbitRequest) -> dict:
        name, propagator = resolve_propagator(payload.sat_id, payload.line1, payload.line2)
        return orbit_payload(name, propagator, payload.horizon_hours, payload.samples, payload.at)

    @router.post("/ephemeris")
    def ephemeris_endpoint(payload: EphemerisRequest) -> dict:
        name, propagator = resolve_propagator(payload.sat_id, payload.line1, payload.line2)
        return build_ephemeris(name, propagator, payload.start_time, payload.end_time, payload.step_seconds, payload.include_velocity)

    return router

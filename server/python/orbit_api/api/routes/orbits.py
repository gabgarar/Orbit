"""Orbit propagation and ephemeris HTTP endpoints."""

import datetime
from collections.abc import Callable

from fastapi import APIRouter, Query

from orbit_api.core.settings import AUTO_MAX_ORBIT_SAMPLES, PROPAGATION_HOURS_MAX, PROPAGATION_HOURS_MIN
from orbit_api.domain.requests import EphemerisRequest, OrbitRequest, PropagationRequest


def create_orbits_router(resolve_propagator, serialize_state, auto_samples: Callable, build_ephemeris: Callable) -> APIRouter:
    """Build orbit routes from application-level operations."""
    router = APIRouter(tags=["orbits"])

    def orbit_payload(name, propagator, horizon_hours: float, samples: int | None) -> dict:
        sample_count = samples or auto_samples(horizon_hours, 1, propagator)
        points = []
        for index in range(sample_count):
            offset = (index / max(sample_count - 1, 1)) * horizon_hours * 3600
            x, y, z, _, _, _ = propagator.propagate_offset(offset)
            points.append({"x": x, "y": y, "z": z})
        return {
            "satellite": name,
            "orbit_horizon_hours": horizon_hours,
            "orbit_samples": sample_count,
            "orbit": points,
        }

    @router.get("/propagate/{sat_id}")
    def propagate_satellite_at(sat_id: str, at: datetime.datetime | None = Query(default=None)) -> dict:
        name, propagator = resolve_propagator(sat_id, None, None)
        target = at or datetime.datetime.now(datetime.UTC)
        x, y, z, vx, vy, vz = propagator.propagate_datetime(target.replace(tzinfo=None))
        return serialize_state(name, target, x, y, z, vx, vy, vz, include_velocity=True)

    @router.post("/propagate")
    def propagate_from_request(payload: PropagationRequest) -> dict:
        name, propagator = resolve_propagator(payload.sat_id, payload.line1, payload.line2)
        target = payload.at or datetime.datetime.now(datetime.UTC)
        x, y, z, vx, vy, vz = propagator.propagate_datetime(target.replace(tzinfo=None))
        return serialize_state(name, target, x, y, z, vx, vy, vz, include_velocity=True)

    @router.get("/orbits/{sat_id}")
    def orbit_for_satellite(
        sat_id: str,
        horizon_hours: float = Query(default=12.0, ge=PROPAGATION_HOURS_MIN, le=PROPAGATION_HOURS_MAX),
        samples: int | None = Query(default=None, ge=2, le=AUTO_MAX_ORBIT_SAMPLES),
    ) -> dict:
        name, propagator = resolve_propagator(sat_id, None, None)
        return orbit_payload(name, propagator, horizon_hours, samples)

    @router.post("/orbits")
    def orbit_from_request(payload: OrbitRequest) -> dict:
        name, propagator = resolve_propagator(payload.sat_id, payload.line1, payload.line2)
        return orbit_payload(name, propagator, payload.horizon_hours, payload.samples)

    @router.post("/ephemeris")
    def ephemeris_endpoint(payload: EphemerisRequest) -> dict:
        name, propagator = resolve_propagator(payload.sat_id, payload.line1, payload.line2)
        return build_ephemeris(name, propagator, payload.start_time, payload.end_time, payload.step_seconds, payload.include_velocity)

    return router

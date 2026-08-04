"""Ground-station visibility and AOS/LOS HTTP endpoints."""

import datetime
from collections.abc import Callable

from fastapi import APIRouter, Query

from orbit_api.domain.requests import AosLosRequest, StationInput
from orbit_api.ground_stations.visibility import elevation_degrees, extract_passes
from orbit_api.timekeeping import utc_now


def create_ground_stations_router(resolve_propagator, build_ephemeris: Callable, ensure_utc: Callable) -> APIRouter:
    """Build access-window routes from orbit application services."""
    router = APIRouter(tags=["ground-stations"])

    def calculate_access_windows(payload: AosLosRequest) -> dict:
        name, propagator = resolve_propagator(payload.sat_id, payload.line1, payload.line2)
        ephemeris = build_ephemeris(name, propagator, payload.start_time, payload.end_time, payload.step_seconds, False)
        samples = []
        for point in ephemeris["points"]:
            position = point.get("position") or {}
            elevation = elevation_degrees(
                payload.station.lat_deg,
                payload.station.lon_deg,
                (float(position.get("x") or 0), float(position.get("y") or 0), float(position.get("z") or 0)),
                payload.station.height_m,
            )
            samples.append({"time": point.get("time"), "elevation_deg": elevation, "visible": elevation >= payload.station.min_elevation_deg})
        return {
            "satellite": name,
            "station": payload.station.model_dump(),
            "start_time": ensure_utc(payload.start_time).isoformat(),
            "end_time": ensure_utc(payload.end_time).isoformat(),
            "step_seconds": payload.step_seconds,
            "passes": extract_passes(samples, payload.station.min_elevation_deg),
            "samples": samples,
            "count": len(samples),
        }

    @router.get("/aos-los")
    def aos_los_get(
        sat_id: str,
        station_lat_deg: float = Query(..., ge=-90, le=90),
        station_lon_deg: float = Query(..., ge=-180, le=180),
        station_height_m: float = Query(default=0.0, ge=-1_000, le=100_000),
        min_elevation_deg: float = Query(default=10.0, ge=0, le=90),
        start_time: datetime.datetime | None = Query(default=None),
        end_time: datetime.datetime | None = Query(default=None),
        step_seconds: float = Query(default=10.0, gt=0, le=600),
    ) -> dict:
        now = utc_now()
        return calculate_access_windows(AosLosRequest(
            sat_id=sat_id,
            station=StationInput(
                lat_deg=station_lat_deg,
                lon_deg=station_lon_deg,
                height_m=station_height_m,
                min_elevation_deg=min_elevation_deg,
            ),
            start_time=start_time or now,
            end_time=end_time or now + datetime.timedelta(hours=24),
            step_seconds=step_seconds,
        ))

    @router.post("/aos-los")
    def aos_los_post(payload: AosLosRequest) -> dict:
        return calculate_access_windows(payload)

    return router

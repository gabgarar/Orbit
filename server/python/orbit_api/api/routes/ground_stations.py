"""Ground-station visibility and AOS/LOS HTTP endpoints."""

import datetime
from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from pydantic import ValidationError

from orbit_api.domain.requests import AosLosRequest, StationInput
from orbit_api.ground_stations.visibility import (
    azimuth_degrees,
    azimuth_is_defined,
    azimuth_within_limits,
    directional_pattern_loss_for_directions_db,
    directional_range_km,
    elevation_degrees,
    extract_passes,
    slant_range_km,
)
from orbit_api.timekeeping import utc_now


def create_ground_stations_router(resolve_propagator, build_ephemeris: Callable, ensure_utc: Callable) -> APIRouter:
    """Build access-window routes from orbit application services."""
    router = APIRouter(tags=["ground-stations"])

    def station_from_query(**values: object) -> StationInput:
        """Turn GET query fields into the same station contract as POST.

        FastAPI validates each scalar query field, but constraints involving
        more than one value (for example mount limits and a stationary
        boresight) live in :class:`StationInput`.  Convert their Pydantic
        errors to a normal HTTP 422 instead of leaking an internal 500 from
        the hand-built request model.
        """
        try:
            return StationInput(**values)
        except ValidationError as error:
            detail = [
                {
                    "loc": ["query", *issue.get("loc", ())],
                    "msg": issue.get("msg", "Invalid station input"),
                    "type": issue.get("type", "value_error"),
                }
                for issue in error.errors()
            ]
            raise HTTPException(status_code=422, detail=detail) from error

    def calculate_access_windows(payload: AosLosRequest) -> dict:
        name, propagator = resolve_propagator(payload.sat_id, payload.line1, payload.line2)
        ephemeris = build_ephemeris(name, propagator, payload.start_time, payload.end_time, payload.step_seconds, False)
        def visibility_sample(point: dict) -> dict:
            position = point.get("position") or {}
            elevation = elevation_degrees(
                payload.station.lat_deg,
                payload.station.lon_deg,
                (float(position.get("x") or 0), float(position.get("y") or 0), float(position.get("z") or 0)),
                payload.station.height_m,
            )
            range_km = slant_range_km(
                payload.station.lat_deg,
                payload.station.lon_deg,
                (float(position.get("x") or 0), float(position.get("y") or 0), float(position.get("z") or 0)),
                payload.station.height_m,
            )
            azimuth = azimuth_degrees(
                payload.station.lat_deg,
                payload.station.lon_deg,
                (float(position.get("x") or 0), float(position.get("y") or 0), float(position.get("z") or 0)),
                payload.station.height_m,
            )
            within_elevation_limits = (
                elevation >= payload.station.min_elevation_deg
                and elevation >= payload.station.mechanical_elevation_min_deg
                and elevation <= payload.station.mechanical_elevation_max_deg
            )
            within_azimuth_limits = (
                not azimuth_is_defined(elevation)
                or azimuth_within_limits(
                    azimuth,
                    payload.station.mechanical_azimuth_min_deg,
                    payload.station.mechanical_azimuth_max_deg,
                )
            )
            hpbw_azimuth = payload.station.hpbw_azimuth_deg or ((payload.station.beam_half_angle_deg or 90.0) * 2.0)
            hpbw_elevation = payload.station.hpbw_elevation_deg or ((payload.station.beam_half_angle_deg or 90.0) * 2.0)
            if payload.station.operation_mode == "stationary":
                applied_pattern_loss, boresight_separation = directional_pattern_loss_for_directions_db(
                    payload.station.pattern_type,
                    hpbw_azimuth,
                    hpbw_elevation,
                    payload.station.side_lobe_level_db,
                    azimuth,
                    elevation,
                    payload.station.boresight_azimuth_deg,
                    payload.station.boresight_elevation_deg,
                )
                pattern_loss = applied_pattern_loss
            else:
                # Tracking can follow the target. Scan has no temporal
                # pointing schedule in this endpoint, so it is only a
                # potential field-of-regard calculation (see below).
                applied_pattern_loss = 0.0
                # Do not expose a zero-dB scan loss as though a scheduled
                # beam were actually pointed at this target. Tracking does
                # have such a boresight by definition.
                pattern_loss = 0.0 if payload.station.operation_mode == "tracking" else None
                boresight_separation = None
            directional_max_range = directional_range_km(
                payload.station.max_range_km,
                applied_pattern_loss,
            )
            # HPBW is the -3 dB contour, not an abrupt physical cutoff. Keep
            # this value for transparent diagnostics, but use the directional
            # gain and range budget above as the actual stationary RF gate.
            within_fixed_beam = (
                None
                if payload.station.operation_mode != "stationary"
                else boresight_separation <= (
                    payload.station.beam_half_angle_deg
                    or (max(hpbw_azimuth, hpbw_elevation) / 2.0)
                )
            )
            within_rf_envelope = directional_max_range is None or range_km <= directional_max_range
            geometric_visible = within_elevation_limits and within_azimuth_limits
            potential_visible = geometric_visible and within_rf_envelope
            scan_schedule_required = payload.station.operation_mode == "scan"
            # A scan field is geometrically capable of seeing targets inside
            # its envelope, but a scheduler has not supplied an instantaneous
            # beam position or dwell window. Publishing those targets as live
            # links would silently assume peak gain. Keep the potential result
            # explicit and reserve ``visible`` / AOS-LOS passes for an
            # operationally scheduled link.
            visible = potential_visible and not scan_schedule_required
            return {
                "time": point.get("time"),
                "elevation_deg": elevation,
                "azimuth_deg": azimuth,
                "range_km": range_km,
                "geometric_visible": geometric_visible,
                "rf_visible": within_rf_envelope,
                "potential_visible": potential_visible,
                "operational_visible": visible,
                "scan_schedule_required": scan_schedule_required,
                "visibility_status": (
                    "scan-schedule-required"
                    if scan_schedule_required and potential_visible
                    else "not-visible"
                    if not potential_visible
                    else "operational"
                ),
                "boresight_separation_deg": boresight_separation,
                "within_main_lobe": within_fixed_beam,
                "pattern_loss_db": pattern_loss,
                "directional_pattern_applied": payload.station.operation_mode == "stationary",
                "directional_max_range_km": directional_max_range,
                "visible": visible,
            }

        def refine_visibility_transition(before: dict, after: dict) -> str | None:
            """Locate the mask/RF crossing between two coarse samples.

            The visible predicate is evaluated again from the same propagator
            and ITRF geometry used for the coarse ephemeris. This keeps AOS
            and LOS physically tied to the displayed station contract instead
            of rounding them to the nearest 30-second vertex.
            """
            try:
                lower = datetime.datetime.fromisoformat(str(before.get("time") or "").replace("Z", "+00:00"))
                upper = datetime.datetime.fromisoformat(str(after.get("time") or "").replace("Z", "+00:00"))
                lower = ensure_utc(lower)
                upper = ensure_utc(upper)
            except (TypeError, ValueError):
                return None
            if upper <= lower:
                return None

            lower_visible = bool(before.get("visible"))
            if lower_visible == bool(after.get("visible")):
                return None

            # 30 s / 2^6 is below 0.5 s. The loop is also safe if a client
            # chooses a coarser accepted step for a long exploratory range.
            for _ in range(12):
                if (upper - lower).total_seconds() <= 0.5:
                    break
                middle = lower + ((upper - lower) / 2)
                refined = build_ephemeris(name, propagator, middle, middle, 1.0, False)
                point = (refined.get("points") or [None])[0]
                if not point:
                    return None
                if bool(visibility_sample(point).get("visible")) == lower_visible:
                    lower = middle
                else:
                    upper = middle

            return (lower + ((upper - lower) / 2)).isoformat()

        samples = [visibility_sample(point) for point in ephemeris["points"]]
        return {
            "satellite": name,
            "station": payload.station.model_dump(),
            "start_time": ensure_utc(payload.start_time).isoformat(),
            "end_time": ensure_utc(payload.end_time).isoformat(),
            # Access geometry is evaluated from the renderer ephemeris, not
            # from the propagator's native inertial state. Publish that
            # contract so every consumer can prove which frame and transport
            # time scale fed its AOS/LOS values.
            "reference_frame": str(ephemeris.get("reference_frame") or "ITRF"),
            "time_scale": str(ephemeris.get("transport_time_scale") or ephemeris.get("time_scale") or "UTC"),
            "step_seconds": payload.step_seconds,
            "passes": extract_passes(
                samples,
                payload.station.min_elevation_deg,
                refine_transition=refine_visibility_transition,
            ),
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
        max_range_km: float | None = Query(default=None, gt=0, le=1_000_000),
        mechanical_elevation_min_deg: float = Query(default=0.0, ge=0, le=90),
        mechanical_elevation_max_deg: float = Query(default=90.0, ge=0, le=90),
        mechanical_azimuth_min_deg: float = Query(default=-180.0, ge=-180, le=180),
        mechanical_azimuth_max_deg: float = Query(default=180.0, ge=-180, le=180),
        operation_mode: str = Query(default="tracking", pattern="^(tracking|scan|stationary)$"),
        boresight_azimuth_deg: float = Query(default=0.0, ge=-180, le=180),
        boresight_elevation_deg: float = Query(default=90.0, ge=0, le=90),
        beam_half_angle_deg: float | None = Query(default=None, gt=0, le=90),
        pattern_type: str = Query(default="gaussian", pattern="^(gaussian|cosine)$"),
        hpbw_azimuth_deg: float | None = Query(default=None, gt=0, le=180),
        hpbw_elevation_deg: float | None = Query(default=None, gt=0, le=180),
        side_lobe_level_db: float = Query(default=25.0, ge=0, le=120),
        start_time: Annotated[datetime.datetime | None, Query()] = None,
        end_time: Annotated[datetime.datetime | None, Query()] = None,
        step_seconds: float = Query(default=10.0, gt=0, le=600),
    ) -> dict:
        now = utc_now()
        return calculate_access_windows(AosLosRequest(
            sat_id=sat_id,
            station=station_from_query(
                lat_deg=station_lat_deg,
                lon_deg=station_lon_deg,
                height_m=station_height_m,
                min_elevation_deg=min_elevation_deg,
                max_range_km=max_range_km,
                mechanical_elevation_min_deg=mechanical_elevation_min_deg,
                mechanical_elevation_max_deg=mechanical_elevation_max_deg,
                mechanical_azimuth_min_deg=mechanical_azimuth_min_deg,
                mechanical_azimuth_max_deg=mechanical_azimuth_max_deg,
                operation_mode=operation_mode,
                boresight_azimuth_deg=boresight_azimuth_deg,
                boresight_elevation_deg=boresight_elevation_deg,
                beam_half_angle_deg=beam_half_angle_deg,
                pattern_type=pattern_type,
                hpbw_azimuth_deg=hpbw_azimuth_deg,
                hpbw_elevation_deg=hpbw_elevation_deg,
                side_lobe_level_db=side_lobe_level_db,
            ),
            start_time=start_time or now,
            end_time=end_time or now + datetime.timedelta(hours=24),
            step_seconds=step_seconds,
        ))

    @router.post("/aos-los")
    def aos_los_post(payload: AosLosRequest) -> dict:
        return calculate_access_windows(payload)

    return router

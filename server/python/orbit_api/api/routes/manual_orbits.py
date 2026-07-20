"""Transient manual-orbit creation endpoint."""

from __future__ import annotations

import datetime
from collections.abc import Callable

from fastapi import APIRouter, HTTPException

from orbit_api.application.manual_orbits import (
    EARTH_EQUATORIAL_RADIUS_KM,
    ManualOrbitError,
    build_synthetic_tle,
    canonical_manual_orbit,
)
from orbit_api.domain.requests import ManualOrbitRequest


DEFAULT_MANUAL_ORBIT_HORIZON_HOURS = 24.0


def _display_ephemeris(name: str, ephemeris: dict) -> dict:
    """Copy a cached runtime payload before assigning its user-facing name."""

    return {
        **ephemeris,
        "satellite": name,
        # build_ephemeris caches by its synthetic TLE identity.  Do not mutate
        # that cache when an editor chooses a friendly display name.
        "points": [{**point, "satellite": name} for point in ephemeris.get("points", [])],
    }


def _resolve_propagation_range(payload: ManualOrbitRequest, ensure_utc: Callable) -> tuple[datetime.datetime, datetime.datetime, str]:
    """Resolve the editor's requested range without losing an explicit end.

    ``end_time`` is authoritative when it is supplied.  This makes the
    design-mode preview match the two dates selected in the UI exactly, even
    if an older caller also sends ``horizon_hours``.
    """

    start_time = ensure_utc(payload.start_time or payload.epoch)
    if payload.end_time is not None:
        end_time = ensure_utc(payload.end_time)
        range_source = "explicit_end_time"
    else:
        horizon_hours = (
            payload.horizon_hours
            if payload.horizon_hours is not None
            else DEFAULT_MANUAL_ORBIT_HORIZON_HOURS
        )
        end_time = start_time + datetime.timedelta(hours=horizon_hours)
        range_source = "horizon_hours"
    if end_time <= start_time:
        raise HTTPException(status_code=422, detail="end_time debe ser mayor que start_time")
    return start_time, end_time, range_source


def _orbit_summary(keplerian: dict) -> dict:
    """Return stable, UI-ready geometric facts for design preview and confirm."""

    periapsis_radius_km = float(keplerian["periapsis_radius_km"])
    apoapsis_radius_km = float(keplerian["apoapsis_radius_km"])
    return {
        "perigee_altitude_km": periapsis_radius_km - EARTH_EQUATORIAL_RADIUS_KM,
        "apogee_altitude_km": apoapsis_radius_km - EARTH_EQUATORIAL_RADIUS_KM,
        "orbital_period_seconds": float(keplerian["orbital_period_seconds"]),
        "mean_motion_rev_day": float(keplerian["mean_motion_rev_day"]),
    }


def _propagation_metadata(
    start_time: datetime.datetime,
    end_time: datetime.datetime,
    range_source: str,
    ephemeris: dict,
) -> dict:
    """Expose the resolved range instead of requiring clients to infer it."""

    duration_seconds = (end_time - start_time).total_seconds()
    return {
        "start_time": start_time.isoformat(),
        "end_time": end_time.isoformat(),
        "duration_seconds": duration_seconds,
        "duration_hours": duration_seconds / 3600.0,
        "step_seconds": ephemeris.get("step_seconds"),
        "points_count": ephemeris.get("count", len(ephemeris.get("points", []))),
        "range_source": range_source,
    }


def create_manual_orbits_router(resolve_propagator: Callable, build_ephemeris: Callable, ensure_utc: Callable) -> APIRouter:
    """Build the HTTP adapter for non-persisted SGP4 manual orbits."""

    router = APIRouter(tags=["manual-orbits"])

    @router.post("/manual-orbits")
    def create_manual_orbit(payload: ManualOrbitRequest) -> dict:
        try:
            definition_source, keplerian, state_vector = canonical_manual_orbit(payload)
            tle = build_synthetic_tle(payload.name, payload.epoch, keplerian)
        except ManualOrbitError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        # The registry remains the single place where an installed propagator
        # is selected.  Today it exposes SGP4; future engines can be added to
        # that registry without changing this transport route.
        runtime_name, propagator = resolve_propagator(
            None,
            tle["line1"],
            tle["line2"],
            payload.propagator,
        )
        start_time, end_time, range_source = _resolve_propagation_range(payload, ensure_utc)

        ephemeris = build_ephemeris(
            runtime_name,
            propagator,
            start_time,
            end_time,
            payload.step_seconds,
            payload.include_velocity,
        )
        response_ephemeris = _display_ephemeris(payload.name, ephemeris)
        epoch_utc = ensure_utc(payload.epoch).isoformat()
        return {
            "name": payload.name,
            "propagator": payload.propagator,
            "epoch": epoch_utc,
            # Camel-case is kept here because the transient frontend track
            # object already exposes this exact metadata field.
            "epochUtc": epoch_utc,
            "definition_source": definition_source,
            "tle": tle,
            "keplerian": keplerian,
            "state_vector": state_vector,
            "orbit_summary": _orbit_summary(keplerian),
            "propagation": _propagation_metadata(start_time, end_time, range_source, response_ephemeris),
            "ephemeris": response_ephemeris,
        }

    return router

"""Transient manual-orbit creation endpoint."""

from __future__ import annotations

import datetime
from collections.abc import Callable

from fastapi import APIRouter, HTTPException

from orbit_api.application.manual_orbits import (
    EARTH_EQUATORIAL_RADIUS_KM,
    ManualOrbitError,
    build_manual_orbit_propagator,
    canonical_manual_orbit,
)
from orbit_api.domain.requests import ManualOrbitRequest


DEFAULT_MANUAL_ORBIT_HORIZON_HOURS = 24.0


def _display_ephemeris(name: str, ephemeris: dict) -> dict:
    """Copy a cached runtime payload before assigning its user-facing name."""

    return {
        **ephemeris,
        "satellite": name,
        # Every runtime point is Earth-fixed. Native manual engines also
        # carry ECI samples per point, but this remains the renderer's primary
        # position frame and matches catalogue/SGP4 ephemerides.
        "reference_frame": ephemeris.get("reference_frame", "ITRF"),
        # build_ephemeris caches by a model-specific runtime identity.  Do not
        # mutate that cache when an editor chooses a friendly display name.
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
    propagator_metadata: dict,
    propagation_options: dict,
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
        # The selected public family can be analytical or numerical Cowell.
        # Cowell exposes its force model and numerical integrator separately
        # in ``propagator_metadata`` so UIs never present J2/J3/J4 as peer
        # propagators for new manual designs.
        "propagator": propagator_metadata.get("id"),
        "applied_engine": propagator_metadata.get("applied_engine", "analytical"),
        "atmospheric_drag": bool(propagation_options.get("atmospheric_drag", False)),
    }


def _camel_object_metadata(metadata: dict) -> dict:
    return {
        "objectType": metadata.get("object_type"),
        "missionType": metadata.get("mission_type"),
        "operator": metadata.get("operator"),
        "country": metadata.get("country"),
        "launchDate": metadata.get("launch_date"),
    }


def _camel_propagation_options(options: dict) -> dict:
    result = {
        "atmosphericDrag": bool(options.get("atmospheric_drag", False)),
        # The explicit list is authoritative. The older scalar aliases below
        # are derived only when the selected term combination has an exact
        # historical gravity-preset equivalent.
        "forceTerms": list(options.get("force_terms") or []),
    }
    # Fixed engines have no configurable Cowell integrator or drag
    # parameters. Omit those keys rather than serialising ambiguous nulls.
    for snake_case, camel_case in (
        ("numerical_integrator", "numericalIntegrator"),
        ("drag_coefficient", "dragCoefficient"),
        ("area_m2", "areaM2"),
        ("mass_kg", "massKg"),
    ):
        if snake_case in options:
            result[camel_case] = options[snake_case]
    legacy_gravity_model = options.get("cowell_gravity_model")
    if legacy_gravity_model is not None:
        # Generic spelling for new clients; retain the Cowell-prefixed alias
        # for projects built before force-model/integrator separation.
        result["cowellGravityModel"] = legacy_gravity_model
        result["forceModel"] = legacy_gravity_model
    return result


def create_manual_orbits_router(resolve_propagator: Callable, build_ephemeris: Callable, ensure_utc: Callable) -> APIRouter:
    """Build the HTTP adapter for transient manual orbit engines."""

    router = APIRouter(tags=["manual-orbits"])

    @router.post("/manual-orbits")
    def create_manual_orbit(payload: ManualOrbitRequest) -> dict:
        # Scope the canonical form to the selected engine. A saved two-body
        # or SGP4 object may still carry old Cowell controls, but the response
        # must expose only the forces that engine actually applies.
        propagation_options = payload.propagation_options.canonical(
            propagator=payload.propagator
        )
        object_metadata = payload.object_metadata.canonical()
        try:
            definition_source, keplerian, state_vector = canonical_manual_orbit(payload)
            runtime_name, propagator, tle, propagator_metadata = build_manual_orbit_propagator(
                payload.propagator,
                name=payload.name,
                epoch=payload.epoch,
                keplerian=keplerian,
                state_vector=state_vector,
                resolve_sgp4=resolve_propagator,
                propagation_options=propagation_options,
            )
        except (ManualOrbitError, ValueError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        start_time, end_time, range_source = _resolve_propagation_range(payload, ensure_utc)

        try:
            ephemeris = build_ephemeris(
                runtime_name,
                propagator,
                start_time,
                end_time,
                payload.step_seconds,
                payload.include_velocity,
            )
        except HTTPException:
            raise
        except (ManualOrbitError, ValueError) as exc:
            # A very low manual orbit can legitimately intersect the Earth
            # over a long drag-enabled interval.  Surface that as a user
            # correction rather than a generic server failure.
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        response_ephemeris = _display_ephemeris(payload.name, ephemeris)
        epoch_utc = ensure_utc(payload.epoch).isoformat()
        return {
            "name": payload.name,
            # Return the canonical engine ID even when an accepted legacy
            # alias (for example ``kepler``) reached the route.
            "propagator": propagator_metadata["id"],
            "propagator_metadata": propagator_metadata,
            "reference_frame": response_ephemeris["reference_frame"],
            "epoch": epoch_utc,
            # Camel-case is kept here because the transient frontend track
            # object already exposes this exact metadata field.
            "epochUtc": epoch_utc,
            "definition_source": definition_source,
            # Snake-case is the stable HTTP/project representation.  The
            # camel-case duplicate is supplied only as a direct adapter for
            # the React manual-design form and can be removed when it owns a
            # typed API client.
            "object_metadata": object_metadata,
            "objectMetadata": _camel_object_metadata(object_metadata),
            "propagation_options": propagation_options,
            "propagationOptions": _camel_propagation_options(propagation_options),
            "tle": tle,
            "keplerian": keplerian,
            "state_vector": state_vector,
            "orbit_summary": _orbit_summary(keplerian),
            "propagation": _propagation_metadata(
                start_time,
                end_time,
                range_source,
                response_ephemeris,
                propagator_metadata,
                propagation_options,
            ),
            "ephemeris": response_ephemeris,
        }

    return router

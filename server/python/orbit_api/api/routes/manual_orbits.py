"""Transient manual-orbit creation endpoint."""

from __future__ import annotations

import datetime
from collections.abc import Callable

from fastapi import APIRouter, HTTPException

from orbit_api.api.routes.startup_gate import (
    StartupReadinessProvider,
    require_project_startup_ready,
)
from orbit_api.application.manual_erp import (
    ManualErpError,
    ManualErpRepository,
    ManualErpSnapshot,
    resolve_manual_erp_input,
)
from orbit_api.application.manual_orbits import (
    EARTH_EQUATORIAL_RADIUS_KM,
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
    MAX_MANUAL_COWELL_GEOPOTENTIAL_DEGREE,
    ManualErpPreviewRequest,
    ManualOrbitRequest,
    require_manual_orbit_runtime_propagator,
)
from orbit_api.frames import FrameTransformService
from orbit_api.orbits.forces import (
    GravityFieldModel,
    GravityModelRegistry,
    local_icgem_model_payload,
)
from orbit_api.orbits.propagators.cowell import (
    MAX_PURE_PYTHON_RK4_GEOPOTENTIAL_TERMS,
)

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
        ("geopotential_degree", "geopotentialDegree"),
        ("geopotential_order", "geopotentialOrder"),
        ("geopotential_model", "geopotentialModel"),
        ("solar_radiation_coefficient", "solarRadiationCoefficient"),
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


def _window_payload(start: datetime.datetime, end: datetime.datetime) -> dict[str, str]:
    return {
        "start_time": start.isoformat(),
        "end_time": end.isoformat(),
        "startTime": start.isoformat(),
        "endTime": end.isoformat(),
    }


def _scene_alignment(
    erp: ManualErpSnapshot,
    scene_window: object | None,
) -> dict[str, object]:
    """Describe UTC overlap; ERP never changes another layer's time data."""

    if scene_window is None or getattr(scene_window, "start_time", None) is None:
        return {"relation": "not-provided", "common_window": None, "commonWindow": None}
    scene_start = scene_window.start_time
    scene_end = scene_window.end_time
    erp_start, erp_end = erp.coverage_start, erp.coverage_end
    common_start, common_end = max(erp_start, scene_start), min(erp_end, scene_end)
    if common_end <= common_start:
        return {
            "relation": "disjoint",
            "common_window": None,
            "commonWindow": None,
            "warning": (
                "La cobertura del ERP y la ventana activa de la escena no tienen un intervalo UTC común; "
                "las operaciones conjuntas deberán permanecer bloqueadas."
            ),
        }
    common = _window_payload(common_start, common_end)
    if erp_start <= scene_start and erp_end >= scene_end:
        relation = "contains-scene"
        warning = None
    elif scene_start <= erp_start and scene_end >= erp_end:
        relation = "inside-scene"
        warning = (
            "La escena continúa fuera de la cobertura ERP; las fuerzas terrestres de esta órbita "
            "solo son válidas dentro del intervalo común."
        )
    else:
        relation = "overlap"
        warning = (
            "La ventana ERP y la escena se solapan parcialmente; las operaciones conjuntas "
            "deben usar únicamente el intervalo común UTC."
        )
    return {
        "relation": relation,
        "common_window": common,
        "commonWindow": common,
        "warning": warning,
    }


def _resolve_manual_erp_snapshot(
    payload: ManualOrbitRequest,
    repository: ManualErpRepository | None,
) -> ManualErpSnapshot | None:
    """Resolve an upload/reference without exposing ERP bytes downstream."""

    try:
        return resolve_manual_erp_input(payload.manual_erp, repository)
    except ManualErpError as exc:
        raise ManualOrbitError(str(exc)) from exc


def create_manual_orbits_router(
    build_ephemeris: Callable,
    ensure_utc: Callable,
    frame_transformer: FrameTransformService | None = None,
    gravity_field: GravityFieldModel | None = None,
    manual_erp_repository: ManualErpRepository | None = None,
    gravity_models: GravityModelRegistry | None = None,
    startup_readiness: StartupReadinessProvider | None = None,
) -> APIRouter:
    """Build the HTTP adapter for transient manual orbit engines."""

    router = APIRouter(tags=["manual-orbits"])

    @router.post("/manual-orbits/time/erp-preview")
    def preview_manual_erp(payload: ManualErpPreviewRequest) -> dict:
        """Validate and retain one local ERP before the TIME tab changes dates.

        The content-addressed snapshot is deliberately persisted at this
        boundary: the editor receives only its compact reference, so creating
        or restoring a project never needs to retain ERP base64 in browser or
        project state.  An unused snapshot is harmless immutable local data
        and can later be garbage-collected by a dedicated storage policy.
        """

        if manual_erp_repository is None:
            raise HTTPException(
                status_code=503,
                detail="El almacenamiento local de snapshots ERP manuales no está disponible.",
            )
        try:
            assert payload.manual_erp.name is not None
            assert payload.manual_erp.content_base64 is not None
            snapshot = manual_erp_repository.save_upload(
                payload.manual_erp.name,
                payload.manual_erp.content_base64,
            )
        except (ManualErpError, ValueError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        suggested = _window_payload(snapshot.coverage_start, snapshot.coverage_end)
        return {
            "ok": True,
            "manual_erp": snapshot.payload(),
            "manualErp": snapshot.payload(),
            "suggested_design_window": suggested,
            "suggestedDesignWindow": suggested,
            "scene_alignment": _scene_alignment(snapshot, payload.scene_window),
            "sceneAlignment": _scene_alignment(snapshot, payload.scene_window),
            "message": (
                "ERP manual validado y guardado localmente. La ventana de diseño propuesta "
                "coincide exactamente con su cobertura UTC."
            ),
        }

    @router.get("/manual-orbits/capabilities")
    def manual_orbit_capabilities() -> dict:
        """Expose installed force data without implying epoch coverage.

        Per-epoch EOP, leap-second and celestial coverage remains validated at
        propagation time.  This endpoint only lets a client explain why the
        configurable full field is or is not currently selectable.
        """

        leap_seconds = (
            frame_transformer.leap_second_table if frame_transformer is not None else None
        )
        registry_payload = (
            gravity_models.diagnostics_payload() if gravity_models is not None else None
        )
        active_registry_model = (
            str(registry_payload.get("activeModel")) if registry_payload is not None else None
        )
        registry_models = (
            registry_payload.get("models", {}) if registry_payload is not None else {}
        )
        models = dict(registry_models) if isinstance(registry_models, dict) else {}
        static_model = local_icgem_model_payload(gravity_field)
        if static_model is not None:
            models[str(static_model["id"])] = static_model
        effective_active_model = (
            str(static_model["id"])
            if static_model is not None
            else active_registry_model
        )
        active_registry_record = (
            registry_models.get(active_registry_model, {})
            if isinstance(registry_models, dict) and active_registry_model is not None
            else {}
        )
        return {
            "cowell": {
                "force_terms": [
                    "central", "j2", "j3", "j4", "drag", "geopotential",
                    "third-body-sun", "third-body-moon", "solar-radiation-pressure",
                    "relativity",
                ],
                "geopotential": {
                    "available": static_model is not None or bool(active_registry_record.get("loaded")),
                    "requires": [
                        "local ICGEM .gfc with SHA-256 or validated local NGA EGM archive",
                        "automatic IERS EOP or explicitly labelled nominal rotation",
                        "versioned unexpired leap-second snapshot",
                        "pyerfa/SOFA IAU 2006/2000A",
                    ],
                    "model": (
                        {
                            "id": gravity_field.model_id,
                            "source": gravity_field.source,
                            "version": gravity_field.version,
                            "sha256": gravity_field.sha256,
                            "max_degree": gravity_field.max_degree,
                            "max_selectable_degree": min(
                                gravity_field.max_degree,
                                MAX_MANUAL_COWELL_GEOPOTENTIAL_DEGREE,
                            ),
                            "execution_limit": {
                                "semantic_max_degree": MAX_MANUAL_COWELL_GEOPOTENTIAL_DEGREE,
                                "max_harmonic_terms": MAX_PURE_PYTHON_RK4_GEOPOTENTIAL_TERMS,
                                "full_degree_order_example": {"degree": 70, "order": 70},
                                "enforcement": "validated before propagation",
                                "reason": (
                                    "bounded pure-Python RK4 evaluation; configurations above "
                                    "the harmonic-term budget require a validated optimized evaluator"
                                ),
                            },
                            "normalization": gravity_field.normalization,
                            "tide_system": gravity_field.tide_system,
                        }
                        if gravity_field is not None else None
                    ),
                    "active_model": effective_active_model,
                    "models": models,
                    "static_model": static_model,
                    "selection_source": (
                        "configured-local-icgem" if static_model is not None else "nga-registry"
                    ),
                    "registry": registry_payload,
                },
                "temporal_route": {
                    "strict_eop": bool(frame_transformer and frame_transformer.strict_eop),
                    "iau2006_2000a": bool(frame_transformer and frame_transformer.has_iau2006_2000a),
                    "leap_second_snapshot": (
                        {
                            "source": leap_seconds.source,
                            "version": leap_seconds.version,
                            "sha256": leap_seconds.sha256,
                            "expires_at": leap_seconds.expires_at.isoformat() if leap_seconds.expires_at else None,
                        }
                        if leap_seconds is not None else None
                    ),
                    "epoch_coverage_validated_on_propagation": True,
                },
            }
        }

    @router.post("/manual-orbits")
    def create_manual_orbit(payload: ManualOrbitRequest) -> dict:
        require_project_startup_ready(startup_readiness)
        try:
            # ``ManualOrbitRequest`` recognizes legacy SGP4 records so a
            # saved project can be identified without silently becoming a
            # two-body orbit. A creation/preview request must not run it:
            # SGP4 consumes NORAD mean elements, not manual EME2000 states.
            propagator_name = require_manual_orbit_runtime_propagator(
                payload.propagator
            )
            propagation_options = payload.propagation_options.canonical(
                propagator=propagator_name
            )
            start_time, end_time, range_source = _resolve_propagation_range(payload, ensure_utc)
            manual_erp = _resolve_manual_erp_snapshot(payload, manual_erp_repository)
            requires_manual_erp = manual_orbit_requires_erp(
                tuple(propagation_options["force_terms"])
            )
            require_manual_erp_for_force_terms(
                tuple(propagation_options["force_terms"]),
                manual_erp.provider if manual_erp is not None else None,
            )
            effective_transformer = manual_erp_frame_transformer(
                frame_transformer,
                manual_erp.provider if manual_erp is not None else None,
            )
            if requires_manual_erp:
                validate_manual_erp_coverage(
                    frame_transformer=effective_transformer,
                    # Cowell integrates from the definition epoch to each
                    # requested sample.  Checking only the visible design
                    # interval would miss an ERP gap between the epoch and
                    # its first sample.
                    start_time=min(ensure_utc(payload.epoch), start_time),
                    end_time=max(ensure_utc(payload.epoch), end_time),
                )
            object_metadata = payload.object_metadata.canonical()
            definition_source, keplerian, state_vector = canonical_manual_orbit(payload)
            runtime_name, propagator, propagator_metadata = build_manual_orbit_propagator(
                propagator_name,
                name=payload.name,
                epoch=payload.epoch,
                keplerian=keplerian,
                state_vector=state_vector,
                propagation_options=propagation_options,
                frame_transformer=frame_transformer,
                gravity_field=gravity_field,
                gravity_model_registry=gravity_models,
                manual_erp_provider=manual_erp.provider if manual_erp is not None else None,
                manual_erp_snapshot_id=manual_erp.snapshot_id if manual_erp is not None else None,
            )
            resolved_geopotential = propagator_metadata.get("geopotential")
            if isinstance(resolved_geopotential, dict):
                selection = resolved_geopotential.get("selection")
                if isinstance(selection, dict):
                    propagation_options["geopotential_model"] = selection.get("model")
                    propagation_options["geopotential_degree"] = selection.get("degree")
                    propagation_options["geopotential_order"] = selection.get("order")
                    if selection.get("warnings"):
                        propagator_metadata.setdefault("warnings", []).extend(selection["warnings"])
        except (ManualOrbitError, ManualErpError, ValueError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

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
        automatic_eop_window = (
            automatic_earth_orientation_window(
                frame_transformer,
                min(ensure_utc(payload.epoch), start_time),
                max(ensure_utc(payload.epoch), end_time),
            )
            if requires_manual_erp and manual_erp is None
            else None
        )
        if automatic_eop_window is not None:
            propagator_metadata["earth_orientation_window"] = automatic_eop_window
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
            # Deliberately compact. This is safe to keep in an authored
            # project and lets a restore verify/reload the same snapshot;
            # ERP bytes never leave the local snapshot repository.
            "manual_erp": manual_erp.payload() if manual_erp is not None else None,
            "manualErp": manual_erp.payload() if manual_erp is not None else None,
            # Compatibility key: manual creation no longer synthesizes or
            # returns a TLE. A future TLE fitting/export operation will have
            # its own explicit API and residual-quality contract.
            "tle": None,
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
            "earth_orientation_window": automatic_eop_window,
            "earthOrientationWindow": automatic_eop_window,
            "ephemeris": response_ephemeris,
        }

    return router

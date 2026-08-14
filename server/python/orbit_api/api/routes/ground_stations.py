"""Ground-station visibility and AOS/LOS HTTP endpoints."""

import datetime
import json
import math
from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, ValidationError

from orbit_api.application.geospatial_exports import (
    GeospatialExportError,
    geospatial_content_type,
    geospatial_export_bytes,
)
from orbit_api.application.manual_orbits import (
    ManualOrbitError,
    build_manual_orbit_propagator,
    canonical_manual_orbit,
    manual_erp_frame_transformer,
    manual_orbit_requires_erp,
    require_manual_erp_for_force_terms,
    validate_manual_erp_coverage,
)
from orbit_api.application.manual_erp import (
    ManualErpError,
    ManualErpRepository,
    resolve_manual_erp_input,
)
from orbit_api.domain.requests import (
    AosLosRequest,
    StationInput,
    require_manual_orbit_runtime_propagator,
)
from orbit_api.frames import FrameTransformService
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
from orbit_api.orbits.forces import GravityFieldModel, GravityModelRegistry
from orbit_api.timekeeping import utc_now


class GroundStationExportRequest(BaseModel):
    """Browser-owned station records requested as a spatial product."""

    format: str
    stations: list[dict[str, object]]


_GROUND_STATION_EXPORT_FIELDS = frozenset({
    "station_schema_version",
    "time_zone",
    "min_elevation_deg",
    "frequency_unit",
    "frequency_hz",
    "frequency_mhz",
    "polarization",
    "polarization_tilt_deg",
    "tx_power_unit",
    "tx_power_dbm",
    "tx_power_w",
    "tx_gain_mode",
    "rx_gain_mode",
    "tx_gain_override_dbi",
    "rx_gain_override_dbi",
    "tx_gain_dbi",
    "rx_gain_dbi",
    "min_link_power_dbm",
    "antenna_diameter_m",
    "antenna_efficiency",
    "hpbw_azimuth_deg",
    "hpbw_elevation_deg",
    "pattern_type",
    "side_lobe_level_db",
    "system_temperature_k",
    "atmospheric_loss_db",
    "rain_loss_db",
    "cable_loss_db",
    "connector_loss_db",
    "pointing_rms_mdeg",
    "receiver_bandwidth_hz",
    "required_snr_db",
    "operation_mode",
    "boresight_azimuth_deg",
    "boresight_elevation_deg",
    "mechanical_elevation_min_deg",
    "mechanical_elevation_max_deg",
    "mechanical_azimuth_min_deg",
    "mechanical_azimuth_max_deg",
    "reference_rx_gain_dbi",
    "reference_rx_threshold_dbm",
    "point_size_px",
    "point_symbol",
    "point_color",
    "coverage_visible",
    "visible",
})


def _finite_station_coordinate(value: object, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise GeospatialExportError(f"La estacion requiere {label} numerica.") from exc
    if not math.isfinite(number):
        raise GeospatialExportError(f"La estacion requiere {label} finita.")
    return number


def ground_station_geospatial_features(stations: list[dict[str, object]]) -> list[dict]:
    """Convert authored station records to Point features without runtime data.

    The browser layer holds Cesium entities, RF caches and coverage meshes next
    to the authored record.  This explicit allow-list exports neither those
    handles nor an invented orbital state.  It keeps the payload auditable
    while still making the normal station/RF fields available in GeoPackage's
    ``properties`` column.
    """

    features: list[dict] = []
    for index, station in enumerate(stations):
        if not isinstance(station, dict):
            raise GeospatialExportError(f"La estacion {index + 1} no es un objeto valido.")
        latitude = _finite_station_coordinate(station.get("latitude_deg"), "latitud")
        longitude = _finite_station_coordinate(station.get("longitude_deg"), "longitud")
        altitude = _finite_station_coordinate(station.get("altitude_m", 0.0), "altitud")
        if not -90.0 <= latitude <= 90.0 or not -180.0 <= longitude <= 180.0:
            raise GeospatialExportError("Las coordenadas de estacion deben estar en WGS-84.")

        station_id = str(station.get("id") or f"ground-station-{index + 1}").strip() or f"ground-station-{index + 1}"
        name = str(station.get("name") or station_id).strip() or station_id
        properties: dict[str, object] = {"station_id": station_id, "feature_kind": "ground_station"}
        for field in _GROUND_STATION_EXPORT_FIELDS:
            value = station.get(field)
            if value is None or isinstance(value, (str, int, float, bool)):
                if field in station:
                    properties[field] = value
        monitor_ids = station.get("monitor_satellite_ids")
        if isinstance(monitor_ids, list):
            properties["monitor_satellite_ids"] = json.dumps([str(item) for item in monitor_ids], ensure_ascii=False)
        features.append({
            "name": name,
            "geometry_type": "Point",
            "coordinates": [longitude, latitude, altitude],
            "properties": properties,
        })
    if not features:
        raise GeospatialExportError("No hay estaciones para exportar.")
    return features


def create_ground_stations_router(
    resolve_propagator,
    build_ephemeris: Callable,
    ensure_utc: Callable,
    frame_transformer: FrameTransformService | None = None,
    gravity_field: GravityFieldModel | None = None,
    manual_erp_repository: ManualErpRepository | None = None,
    gravity_models: GravityModelRegistry | None = None,
) -> APIRouter:
    """Build access-window routes from orbit application services."""
    router = APIRouter(tags=["ground-stations"])

    @router.post("/ground-stations/export")
    def export_ground_stations(payload: GroundStationExportRequest) -> Response:
        """Return a real GeoPackage point layer for authored stations.

        The browser is intentionally responsible for its text exports because
        GeoJSON and Orbit JSON preserve their client-side interchange
        contracts. GeoPackage is SQLite binary, so it is produced here with
        the same dependency-free serializer as the orbital spatial exports.
        """

        format_name = str(payload.format or "").strip().lower()
        if format_name != "gpkg":
            raise HTTPException(status_code=422, detail="La ruta de estaciones solo genera GeoPackage.")
        try:
            product = geospatial_export_bytes(format_name, ground_station_geospatial_features(payload.stations))
        except GeospatialExportError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return Response(
            product,
            media_type=geospatial_content_type(format_name),
            headers={"Content-Disposition": "attachment; filename=orbit-ground-stations.gpkg"},
        )

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

    def resolve_access_source(payload: AosLosRequest) -> tuple[str, str, object, dict]:
        """Resolve a display name, cache-safe runtime ID and propagator.

        Catalogue access retains its historical TLE/SGP4 resolver. Manual
        access reconstructs the exact native engine selected in the design
        payload; it never turns an EME2000 state into a synthetic TLE.
        """

        source = payload.source
        if source is None:  # Defensive narrowing; request validation rejects it.
            raise HTTPException(status_code=422, detail="Falta la fuente orbital para AOS/LOS")
        if source.kind != "manual":
            name, propagator = resolve_propagator(source.sat_id, source.line1, source.line2)
            native_reference = getattr(propagator, "dynamics_reference_realization", None) or getattr(
                propagator,
                "dynamics_reference_frame",
                None,
            )
            return name, name, propagator, {
                "kind": "catalog",
                "sat_id": source.sat_id,
                "propagator": str(getattr(propagator, "model_id", "sgp4")),
                "dynamics_reference_frame": str(
                    getattr(propagator, "dynamics_reference_frame", "TEME")
                ),
                "native_reference_frame": str(native_reference) if native_reference is not None else None,
                # This is a requested renderer target, not evidence that a
                # rigorous ITRF transformation has already been performed.
                "renderer_target_frame": "ITRF",
            }

        manual = source.manual_orbit
        if manual is None:  # Defensive narrowing; source validation rejects it.
            raise HTTPException(status_code=422, detail="La fuente manual requiere manual_orbit")
        try:
            propagator_name = require_manual_orbit_runtime_propagator(manual.propagator)
            propagation_options = manual.propagation_options.canonical(
                propagator=propagator_name
            )
            manual_erp = resolve_manual_erp_input(
                manual.manual_erp,
                manual_erp_repository,
            )
            require_manual_erp_for_force_terms(
                tuple(propagation_options["force_terms"]),
                manual_erp.provider if manual_erp is not None else None,
            )
            if manual_orbit_requires_erp(tuple(propagation_options["force_terms"])):
                validate_manual_erp_coverage(
                    frame_transformer=manual_erp_frame_transformer(
                        frame_transformer,
                        manual_erp.provider if manual_erp is not None else None,
                    ),
                    # AOS/LOS may begin after an epoch that still has to be
                    # traversed by the RK4 state. Validate that hidden leg as
                    # well as the requested access window.
                    start_time=min(manual.epoch, payload.start_time),
                    end_time=max(manual.epoch, payload.end_time),
                )
            definition_source, keplerian, state_vector = canonical_manual_orbit(manual)
            runtime_name, propagator, propagator_metadata = build_manual_orbit_propagator(
                propagator_name,
                name=manual.name,
                epoch=manual.epoch,
                keplerian=keplerian,
                state_vector=state_vector,
                propagation_options=propagation_options,
                frame_transformer=frame_transformer,
                gravity_field=gravity_field,
                gravity_model_registry=gravity_models,
                manual_erp_provider=manual_erp.provider if manual_erp is not None else None,
                manual_erp_snapshot_id=manual_erp.snapshot_id if manual_erp is not None else None,
            )
        except (ManualOrbitError, ManualErpError, ValueError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        source_metadata = {
            "kind": "manual",
            "name": manual.name,
            "propagator": propagator_metadata["id"],
            "definition_source": definition_source,
            "dynamics_reference_frame": "EME2000",
            # Access geometry always samples the runtime renderer position,
            # which is transformed to the renderer Earth-fixed target before
            # the ENU calculation below. The response carries the actual
            # EOP/visual qualification of that transformation.
            "ephemeris_reference_frame": "ITRF",
            "renderer_target_frame": "ITRF",
        }
        if manual_erp is not None:
            # Compact provenance is useful to an access result, but keep the
            # historical central-force response shape unchanged when no ERP
            # was selected.
            source_metadata["manual_erp"] = manual_erp.payload()
        return manual.name, runtime_name, propagator, source_metadata

    def calculate_access_windows(payload: AosLosRequest) -> dict:
        name, runtime_name, propagator, source_metadata = resolve_access_source(payload)
        # AOS/LOS consumes only ITRF positions.  Request the runtime's
        # position-only ephemeris so it does not calculate/serialize velocity
        # derivatives or duplicate native samples for every planning point.
        try:
            ephemeris = build_ephemeris(
                runtime_name,
                propagator,
                payload.start_time,
                payload.end_time,
                payload.step_seconds,
                False,
                True,
            )
        except HTTPException:
            raise
        except (ManualOrbitError, ValueError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
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
                refined = build_ephemeris(
                    runtime_name,
                    propagator,
                    middle,
                    middle,
                    1.0,
                    False,
                    True,
                )
                point = (refined.get("points") or [None])[0]
                if not point:
                    return None
                if bool(visibility_sample(point).get("visible")) == lower_visible:
                    lower = middle
                else:
                    upper = middle

            return (lower + ((upper - lower) / 2)).isoformat()

        samples = [visibility_sample(point) for point in ephemeris["points"]]
        passes = extract_passes(
            samples,
            payload.station.min_elevation_deg,
            refine_transition=refine_visibility_transition,
        )

        def parse_utc_time(value: object) -> datetime.datetime | None:
            """Parse an API timestamp without making a malformed sample fatal."""
            try:
                parsed = datetime.datetime.fromisoformat(str(value or "").replace("Z", "+00:00"))
            except (TypeError, ValueError):
                return None
            return ensure_utc(parsed)

        def samples_for_pass_charts() -> list[dict]:
            """Keep chart vertices inside refined access windows plus padding.

            The full coarse sequence has already been evaluated above, so this
            is only a response-shaping operation: pass discovery and the
            sub-second AOS/LOS refinement retain exactly the same result.
            """
            if payload.chart_padding_seconds is None:
                return samples

            padding = datetime.timedelta(seconds=payload.chart_padding_seconds)
            windows: list[tuple[datetime.datetime, datetime.datetime]] = []
            for access_pass in passes:
                aos = parse_utc_time(access_pass.get("aos"))
                los = parse_utc_time(access_pass.get("los"))
                if aos is not None and los is not None and los >= aos:
                    windows.append((aos - padding, los + padding))

            if not windows:
                return []

            # Nearby passes can have overlapping padding. Merge their
            # intervals once so the sample scan stays linear in the common
            # case of a long planning window.
            windows.sort(key=lambda interval: interval[0])
            merged_windows: list[tuple[datetime.datetime, datetime.datetime]] = []
            for lower, upper in windows:
                if merged_windows and lower <= merged_windows[-1][1]:
                    previous_lower, previous_upper = merged_windows[-1]
                    merged_windows[-1] = (previous_lower, max(previous_upper, upper))
                else:
                    merged_windows.append((lower, upper))

            compact_samples: list[dict] = []
            window_index = 0
            for sample in samples:
                sample_time = parse_utc_time(sample.get("time"))
                if sample_time is None:
                    continue
                while window_index < len(merged_windows) and sample_time > merged_windows[window_index][1]:
                    window_index += 1
                if window_index >= len(merged_windows):
                    break
                lower, upper = merged_windows[window_index]
                if lower <= sample_time <= upper:
                    compact_samples.append(sample)
            return compact_samples

        if not payload.include_samples:
            returned_samples: list[dict] = []
            sample_scope = "omitted"
        elif payload.chart_padding_seconds is None:
            returned_samples = samples
            sample_scope = "full-window"
        else:
            returned_samples = samples_for_pass_charts()
            sample_scope = "pass-windows"

        return {
            "satellite": name,
            "source": source_metadata,
            "station": payload.station.model_dump(),
            "start_time": ensure_utc(payload.start_time).isoformat(),
            "end_time": ensure_utc(payload.end_time).isoformat(),
            # Access geometry is evaluated from the renderer ephemeris, not
            # from the propagator's native inertial state. Publish that
            # contract so every consumer can prove which frame and transport
            # time scale fed its AOS/LOS values.
            # ``reference_frame`` remains the frame of the coordinates used
            # for ENU geometry. ``renderer_reference`` tells callers whether
            # that Earth-fixed view used final/rapid EOP, an explicit datum
            # operation, or the visual UTC~UT1 approximation.
            "reference_frame": ephemeris.get("reference_frame"),
            "native_reference_frame": ephemeris.get("native_reference_frame"),
            "native_frame": ephemeris.get("native_frame"),
            "renderer_reference": ephemeris.get("renderer_reference"),
            "time_scale": str(ephemeris.get("transport_time_scale") or ephemeris.get("time_scale") or "UTC"),
            "step_seconds": payload.step_seconds,
            "passes": passes,
            # The internal sequence is still evaluated so AOS/LOS and its
            # refined crossings are identical.  Streaming users that only
            # need event windows can avoid a multi-megabyte response; chart
            # clients can request only contact-adjacent vertices.
            "samples": returned_samples,
            "count": len(samples),
            "returned_sample_count": len(returned_samples),
            "sample_scope": sample_scope,
            "chart_padding_seconds": payload.chart_padding_seconds,
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
        include_samples: bool = Query(default=True),
        chart_padding_seconds: Annotated[float | None, Query(ge=0, le=3_600)] = None,
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
            include_samples=include_samples,
            chart_padding_seconds=chart_padding_seconds,
        ))

    @router.post("/aos-los")
    def aos_los_post(payload: AosLosRequest) -> dict:
        return calculate_access_windows(payload)

    return router

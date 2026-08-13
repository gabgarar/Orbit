"""Orbit product export endpoints."""

import datetime
import json
from collections.abc import Callable

from fastapi import APIRouter, HTTPException, Query, Response

from orbit_api.application.exporters import (
    ephemeris_csv_text,
    ephemeris_oem_text,
    normalize_source_format,
    ocm_json_from_entry,
    omm_json_from_entry,
    omm_xml_from_entry,
    safe_filename,
)
from orbit_api.application.geospatial_exports import (
    GEOSPATIAL_EXPORT_FORMATS,
    GeospatialExportError,
    geospatial_content_type,
    geospatial_export_bytes,
    geospatial_extension,
    orbital_geospatial_features,
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
    ManualOrbitRequest,
    require_manual_orbit_runtime_propagator,
)
from orbit_api.frames import FrameTransformService
from orbit_api.orbits.forces import GravityFieldModel


def _serialize_ephemeris_product(
    *,
    result: dict,
    satellite_id: str,
    start_time: datetime.datetime,
    end_time: datetime.datetime,
    format_name: str,
    source_format: str,
    propagator: str,
    ensure_utc: Callable,
) -> Response:
    """Serialize an already propagated, terrestrial ephemeris response."""

    filename = safe_filename(result.get("satellite", satellite_id))
    points = result.get("points", [])
    fmt = (format_name or "csv").strip().lower()
    if fmt in GEOSPATIAL_EXPORT_FORMATS:
        try:
            product = geospatial_export_bytes(
                fmt,
                orbital_geospatial_features(
                    result.get("satellite", satellite_id),
                    points,
                    {
                        "source_format": source_format,
                        "propagator": propagator,
                        "reference_frame": result.get("reference_frame", "ITRF"),
                        "time_scale": result.get("time_scale", "UTC"),
                    },
                ),
            )
        except GeospatialExportError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        extension = geospatial_extension(fmt)
        return Response(
            product,
            media_type=geospatial_content_type(fmt),
            headers={"Content-Disposition": f"attachment; filename={filename}-ephemeris.{extension}"},
        )
    if fmt == "json":
        return Response(
            json.dumps(result, ensure_ascii=False, indent=2),
            media_type="application/json; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename={filename}-ephemeris.json"},
        )
    if fmt == "oem":
        text = ephemeris_oem_text(
            result["satellite"],
            result.get("start_time", ensure_utc(start_time).isoformat()),
            result.get("end_time", ensure_utc(end_time).isoformat()),
            points,
            source_format,
            propagator,
        )
        return Response(
            text,
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename={filename}-ephemeris.oem"},
        )
    if fmt == "csv":
        return Response(
            ephemeris_csv_text(points, source_format, propagator),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename={filename}-ephemeris.csv"},
        )
    raise HTTPException(status_code=422, detail=f"Formato de efeméride no admitido: {format_name}")


def _resolve_manual_export_range(
    payload: ManualOrbitRequest,
    ensure_utc: Callable,
) -> tuple[datetime.datetime, datetime.datetime]:
    start_time = ensure_utc(payload.start_time or payload.epoch)
    if payload.end_time is not None:
        end_time = ensure_utc(payload.end_time)
    else:
        horizon_hours = payload.horizon_hours if payload.horizon_hours is not None else 24.0
        end_time = start_time + datetime.timedelta(hours=horizon_hours)
    if end_time <= start_time:
        raise HTTPException(status_code=422, detail="end_time debe ser mayor que start_time")
    return start_time, end_time


def _catalog_source_format(entry: dict) -> str:
    """Read provenance from the loaded entry, never from a query override."""

    return normalize_source_format(entry.get("sourceFormat") or entry.get("source_format"), "TLE")


def _require_catalog_source(entry: dict, expected: str) -> None:
    actual = _catalog_source_format(entry)
    if actual != expected:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Este satélite tiene origen {actual}; la exportación {expected} "
                "solo está disponible para una entrada de ese formato."
            ),
        )


def _require_tle_lines(line1: str, line2: str) -> None:
    """Reject incomplete or structurally non-TLE source exports.

    This deliberately does not recalculate a checksum or repair an imported
    record: source export must preserve the original lines, and a malformed
    source must be corrected at import instead of being made to look valid at
    download time.
    """

    if not line1 or not line2:
        raise HTTPException(status_code=422, detail="La entrada TLE no contiene sus dos lineas originales.")
    if not line1.startswith("1 ") or not line2.startswith("2 "):
        raise HTTPException(status_code=422, detail="La entrada TLE no contiene lineas TLE validas de tipo 1 y 2.")


def _build_manual_export_ephemeris(
    payload: ManualOrbitRequest,
    build_ephemeris: Callable,
    ensure_utc: Callable,
    frame_transformer: FrameTransformService | None,
    gravity_field: GravityFieldModel | None,
    manual_erp_repository: ManualErpRepository | None,
) -> tuple[dict, datetime.datetime, datetime.datetime, str]:
    """Propagate a manual source exactly as the manual-orbit endpoint does."""

    try:
        propagator_name = require_manual_orbit_runtime_propagator(payload.propagator)
        propagation_options = payload.propagation_options.canonical(propagator=propagator_name)
        start_time, end_time = _resolve_manual_export_range(payload, ensure_utc)
        manual_erp = resolve_manual_erp_input(payload.manual_erp, manual_erp_repository)
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
                # The initial state epoch participates in every numerical
                # integration, even if the exported window starts later.
                start_time=min(ensure_utc(payload.epoch), start_time),
                end_time=max(ensure_utc(payload.epoch), end_time),
            )
        _definition_source, keplerian, state_vector = canonical_manual_orbit(payload)
        runtime_name, engine, metadata = build_manual_orbit_propagator(
            propagator_name,
            name=payload.name,
            epoch=payload.epoch,
            keplerian=keplerian,
            state_vector=state_vector,
            propagation_options=propagation_options,
            frame_transformer=frame_transformer,
            gravity_field=gravity_field,
            manual_erp_provider=manual_erp.provider if manual_erp is not None else None,
            manual_erp_snapshot_id=manual_erp.snapshot_id if manual_erp is not None else None,
        )
        result = build_ephemeris(
            runtime_name,
            engine,
            start_time,
            end_time,
            payload.step_seconds,
            True,
        )
    except HTTPException:
        raise
    except (ManualOrbitError, ManualErpError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        **result,
        "satellite": payload.name,
        "points": [{**point, "satellite": payload.name} for point in result.get("points", [])],
    }, start_time, end_time, metadata["id"]


def create_exports_router(
    find_catalog_entry: Callable,
    resolve_propagator: Callable,
    build_ephemeris: Callable,
    ensure_utc: Callable,
    frame_transformer: FrameTransformService | None = None,
    gravity_field: GravityFieldModel | None = None,
    manual_erp_repository: ManualErpRepository | None = None,
) -> APIRouter:
    router = APIRouter(tags=["exports"])

    def require_entry(satellite_id: str) -> dict:
        entry = find_catalog_entry(satellite_id)
        if not entry:
            raise HTTPException(status_code=404, detail="Satelite no encontrado")
        return entry

    @router.get("/export/tle/{sat_id}")
    def export_tle(sat_id: str):
        entry = require_entry(sat_id)
        _require_catalog_source(entry, "TLE")
        line1 = str(entry.get("line1") or "").strip()
        line2 = str(entry.get("line2") or "").strip()
        _require_tle_lines(line1, line2)
        filename = safe_filename(entry.get("name", sat_id))
        return Response(
            f"{entry['name']}\n{line1}\n{line2}\n",
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename={filename}.tle"},
        )

    @router.get("/export/omm/{sat_id}")
    def export_omm(sat_id: str, format: str = Query(default="json")):
        entry = require_entry(sat_id)
        _require_catalog_source(entry, "OMM")
        filename = safe_filename(entry.get("name", sat_id))
        if (format or "json").strip().lower() == "xml":
            return Response(omm_xml_from_entry(entry), media_type="application/xml; charset=utf-8", headers={"Content-Disposition": f"attachment; filename={filename}.omm.xml"})
        return Response(json.dumps(omm_json_from_entry(entry), ensure_ascii=False, indent=2), media_type="application/json; charset=utf-8", headers={"Content-Disposition": f"attachment; filename={filename}.omm.json"})

    @router.get("/export/ocm/{sat_id}")
    def export_ocm(sat_id: str):
        entry = require_entry(sat_id)
        filename = safe_filename(entry.get("name", sat_id))
        return Response(json.dumps(ocm_json_from_entry(entry), ensure_ascii=False, indent=2), media_type="application/json; charset=utf-8", headers={"Content-Disposition": f"attachment; filename={filename}.ocm.json"})

    @router.get("/export/ephemeris/{sat_id}")
    def export_ephemeris(sat_id: str, t0: datetime.datetime, t1: datetime.datetime, dt: float = Query(default=10.0, gt=0, le=3600), format: str = Query(default="csv"), propagator: str = Query(default="sgp4"), sourceFormat: str | None = Query(default=None)):
        if (propagator or "sgp4").strip().lower() != "sgp4":
            raise HTTPException(status_code=400, detail="Propagador no soportado por el momento. Usa SGP4.")
        entry = require_entry(sat_id)
        source = _catalog_source_format(entry)
        requested_source = str(sourceFormat or "").strip().upper()
        if requested_source and requested_source != source:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"sourceFormat={requested_source} no coincide con el origen "
                    f"de catálogo {source}."
                ),
            )
        if source == "OEM":
            raise HTTPException(
                status_code=409,
                detail=(
                    "Las efemerides OEM de origen no se reprocesan mediante SGP4. "
                    "Exporte el OEM de origen; la exportacion GIS de OEM requiere "
                    "un adaptador de muestras OEM que aun no esta disponible."
                ),
            )
        name, engine = resolve_propagator(sat_id, None, None)
        result = build_ephemeris(name, engine, t0, t1, dt, True)
        result.update({"source_format": source, "propagator": "sgp4"})
        return _serialize_ephemeris_product(
            result=result,
            satellite_id=sat_id,
            start_time=t0,
            end_time=t1,
            format_name=format,
            source_format=source,
            propagator="sgp4",
            ensure_utc=ensure_utc,
        )

    @router.post("/export/manual-ephemeris")
    def export_manual_ephemeris(payload: ManualOrbitRequest, format: str = Query(default="csv")):
        """Export a manual physical propagation without fabricating a TLE.

        The endpoint consumes the same authored EME2000 definition used by the
        manual editor, so a Cowell force model and its RK4 integration remain
        the source of the exported samples.
        """

        result, start_time, end_time, propagator = _build_manual_export_ephemeris(
            payload,
            build_ephemeris,
            ensure_utc,
            frame_transformer,
            gravity_field,
            manual_erp_repository,
        )
        result.update({"source_format": "MANUAL", "propagator": propagator})
        return _serialize_ephemeris_product(
            result=result,
            satellite_id=payload.name,
            start_time=start_time,
            end_time=end_time,
            format_name=format,
            source_format="MANUAL",
            propagator=propagator,
            ensure_utc=ensure_utc,
        )

    return router

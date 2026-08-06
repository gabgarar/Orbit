"""Orbit product export endpoints."""

import datetime
import json
from collections.abc import Callable

from fastapi import APIRouter, HTTPException, Query, Response

from orbit_api.application.exporters import ephemeris_csv_text, ephemeris_oem_text, normalize_source_format, ocm_json_from_entry, omm_json_from_entry, omm_xml_from_entry, safe_filename
def create_exports_router(find_catalog_entry: Callable, resolve_propagator: Callable, build_ephemeris: Callable, ensure_utc: Callable) -> APIRouter:
    router = APIRouter(tags=["exports"])

    def require_entry(satellite_id: str) -> dict:
        entry = find_catalog_entry(satellite_id)
        if not entry:
            raise HTTPException(status_code=404, detail="Satelite no encontrado")
        return entry

    @router.get("/export/tle/{sat_id}")
    def export_tle(sat_id: str):
        entry = require_entry(sat_id)
        filename = safe_filename(entry.get("name", sat_id))
        return Response(f"{entry['name']}\n{entry['line1']}\n{entry['line2']}\n", media_type="text/plain; charset=utf-8", headers={"Content-Disposition": f"attachment; filename={filename}.tle"})

    @router.get("/export/omm/{sat_id}")
    def export_omm(sat_id: str, format: str = Query(default="json")):
        entry = require_entry(sat_id)
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
        entry = find_catalog_entry(sat_id)
        source = normalize_source_format(sourceFormat, normalize_source_format(entry.get("sourceFormat") if entry else None))
        name, engine = resolve_propagator(sat_id, None, None)
        result = build_ephemeris(name, engine, t0, t1, dt, True)
        result.update({"source_format": source, "propagator": "sgp4"})
        filename = safe_filename(result.get("satellite", sat_id))
        points = result.get("points", [])
        fmt = (format or "csv").strip().lower()
        if fmt == "json":
            return Response(json.dumps(result, ensure_ascii=False, indent=2), media_type="application/json; charset=utf-8", headers={"Content-Disposition": f"attachment; filename={filename}-ephemeris.json"})
        if fmt == "oem":
            text = ephemeris_oem_text(result["satellite"], result.get("start_time", ensure_utc(t0).isoformat()), result.get("end_time", ensure_utc(t1).isoformat()), points, source, "sgp4")
            return Response(text, media_type="text/plain; charset=utf-8", headers={"Content-Disposition": f"attachment; filename={filename}-ephemeris.oem"})
        return Response(ephemeris_csv_text(points, source, "sgp4"), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f"attachment; filename={filename}-ephemeris.csv"})

    return router

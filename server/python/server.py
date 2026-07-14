# server.py — Backend FastAPI para propagación orbital Orbit
import asyncio
import datetime
import hashlib
import json
import os
import signal
import threading
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, HTTPException, Query, Response, WebSocket, WebSocketDisconnect
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from orbit_api.core.settings import (
    AUTO_MAX_ORBIT_SAMPLES,
    AUTO_MIN_ORBIT_SAMPLES,
    COMPRESSION_THRESHOLD,
    CONFIG_DIR,
    EPHEMERIS_CACHE_TTL_SECONDS,
    MAX_EPHEMERIS_CACHE_ITEMS,
    MAX_EPHEMERIS_POINTS,
    MAX_TOTAL_ORBIT_POINTS_PER_BATCH,
    ORBIT_CACHE_TTL_SECONDS,
    PROPAGATION_HOURS_MAX,
    PROPAGATION_HOURS_MIN,
    SYSTEM_CONFIG_PATH,
)
from orbit_api.domain.requests import AosLosRequest, EphemerisRequest, OrbitRequest, PropagationRequest, StationInput
from orbit_api.infrastructure.ttl_cache import TtlLruCache
from orbit_api.application.exporters import (
    ephemeris_csv_text as _ephemeris_csv_text,
    ephemeris_oem_text as _ephemeris_oem_text,
    normalize_source_format as _normalize_source_format,
    ocm_json_from_entry as _ocm_json_from_entry,
    omm_json_from_entry as _omm_json_from_entry,
    omm_xml_from_entry as _omm_xml_from_entry,
    safe_filename as _safe_filename,
)
from orbit_api.communications.encoding import send_payload
from orbit_api.communications.decoder import decode_subscription_command
from orbit_api.communications.subscriptions import SubscriptionState
from orbit_api.catalog.repository import find_entry, load_entries
from orbit_api.catalog.tle_loader import load_all_tles_from_config
from orbit_api.ground_stations.visibility import elevation_degrees, extract_passes
from orbit_api.orbits.sampling import compute_auto_samples
from orbit_api.orbits.propagators import OrbitPropagator, build_default_registry
from orbit_api.api.routes.system import create_system_router
from orbit_api.api.routes.catalog import create_catalog_router
from orbit_api.api.routes.orbits import create_orbits_router
from orbit_api.api.routes.ground_stations import create_ground_stations_router
from orbit_api.api.routes.exports import create_exports_router
from orbit_api.api.routes.realtime import create_realtime_router

propagators: list = []
propagators_by_name: dict = {}
system_config: dict = {}
state_lock = threading.Lock()

orbit_point_cache: dict = {}
orbit_cache_payload: list = []
orbit_cache_key = None
orbit_cache_valid_until = datetime.datetime.min.replace(tzinfo=datetime.UTC)
runtime_config_mtime = None
runtime_propagation_hours = 12
ephemeris_cache = TtlLruCache(MAX_EPHEMERIS_CACHE_ITEMS, EPHEMERIS_CACHE_TTL_SECONDS)
propagator_registry = build_default_registry()


def _ensure_utc(dt: datetime.datetime) -> datetime.datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=datetime.UTC)
    return dt.astimezone(datetime.UTC)


def _cache_get(cache_key: str):
    return ephemeris_cache.get(cache_key)


def _cache_set(cache_key: str, value):
    ephemeris_cache.set(cache_key, value)


def _serialize_state(name: str, dt: datetime.datetime, x, y, z, vx, vy, vz, include_velocity=True):
    payload = {
        "satellite": name,
        "time": _ensure_utc(dt).isoformat(),
        "position": {"x": x, "y": y, "z": z},
    }
    if include_velocity:
        payload["velocity"] = {"x": vx, "y": vy, "z": vz}
    return payload


def _resolve_propagator_for_request(sat_id: str | None, line1: str | None, line2: str | None):
    sat_name = (sat_id or "").strip()
    if sat_name:
        _, _, props_by_name = get_state_snapshot()
        prop = props_by_name.get(sat_name)
        if prop is None:
            raise HTTPException(status_code=404, detail=f"Satelite '{sat_name}' no encontrado")
        return sat_name, prop

    l1 = (line1 or "").strip()
    l2 = (line2 or "").strip()
    if not l1 or not l2:
        raise HTTPException(status_code=400, detail="Debes enviar sat_id o line1+line2")
    try:
        prop = propagator_registry.create("sgp4", l1, l2)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"TLE invalido: {exc}") from exc
    tle_hash = hashlib.sha1(f"{l1}\n{l2}".encode("utf-8")).hexdigest()[:12]
    return f"tle:{tle_hash}", prop


def _load_catalog_entries_with_tle():
    _, data_config = load_system_config()
    catalog_file = data_config.get("satellites_catalog_file", "catalog.json")
    return load_entries(CONFIG_DIR, catalog_file, load_all_tles_from_config)


def _find_catalog_entry(sat_id: str):
    return find_entry(_load_catalog_entries_with_tle(), sat_id)


def _build_ephemeris(name: str, prop: OrbitPropagator, start_time: datetime.datetime, end_time: datetime.datetime, step_seconds: float, include_velocity=True):
    start_utc = _ensure_utc(start_time)
    end_utc = _ensure_utc(end_time)
    step = float(step_seconds)

    points_estimate = int(((end_utc - start_utc).total_seconds() / step) + 1)
    if points_estimate > MAX_EPHEMERIS_POINTS:
        raise HTTPException(
            status_code=400,
            detail=f"Rango demasiado grande para el paso indicado ({points_estimate} puntos, max {MAX_EPHEMERIS_POINTS})",
        )

    cache_key = hashlib.sha1(
        f"{name}|{start_utc.isoformat()}|{end_utc.isoformat()}|{step}|{include_velocity}".encode("utf-8")
    ).hexdigest()
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    series = []
    cursor = start_utc
    while cursor <= end_utc:
        naive = cursor.replace(tzinfo=None)
        x, y, z, vx, vy, vz = prop.propagate_datetime(naive)
        series.append(_serialize_state(name, cursor, x, y, z, vx, vy, vz, include_velocity=include_velocity))
        cursor += datetime.timedelta(seconds=step)

    if series and series[-1]["time"] != end_utc.isoformat():
        x, y, z, vx, vy, vz = prop.propagate_datetime(end_utc.replace(tzinfo=None))
        series.append(_serialize_state(name, end_utc, x, y, z, vx, vy, vz, include_velocity=include_velocity))

    payload = {
        "satellite": name,
        "start_time": start_utc.isoformat(),
        "end_time": end_utc.isoformat(),
        "step_seconds": step,
        "points": series,
        "count": len(series),
        "cached": False,
    }
    _cache_set(cache_key, payload)
    return payload


def clamp_propagation_hours(value, default=12):
    try:
        hours = float(value)
    except Exception:
        hours = float(default)
    if not isinstance(hours, float) or hours <= 0:
        hours = float(default)
    return max(PROPAGATION_HOURS_MIN, min(PROPAGATION_HOURS_MAX, hours))


def normalize_system_config(system_cfg):
    orbit_cfg = system_cfg.get("orbit", {}) if isinstance(system_cfg, dict) else {}
    satellites_cfg = system_cfg.get("satellites", {}) if isinstance(system_cfg, dict) else {}
    realtime_cfg = system_cfg.get("realtime", {}) if isinstance(system_cfg, dict) else {}
    return {
        "orbit_future_show": orbit_cfg.get("future_show", system_cfg.get("orbit_future_show", True)),
        "orbit_past_show": orbit_cfg.get("past_show", system_cfg.get("orbit_past_show", True)),
        "propagation_hours": clamp_propagation_hours(
            orbit_cfg.get("propagation_hours", system_cfg.get("propagation_hours", 12)),
        ),
        "orbit_future_line_width": orbit_cfg.get("future_line_width", system_cfg.get("orbit_future_line_width", 3)),
        "orbit_future_color": orbit_cfg.get("future_color", system_cfg.get("orbit_future_color", "#00ff88")),
        "orbit_selected_color": orbit_cfg.get("selected_color", system_cfg.get("orbit_selected_color", "#ff2d2d")),
        "orbit_past_color": orbit_cfg.get("past_color", system_cfg.get("orbit_past_color", "#ff0000")),
        "orbit_past_seconds": orbit_cfg.get(
            "past_seconds",
            system_cfg.get("orbit_past_seconds", system_cfg.get("orbit_past_samples", 120)),
        ),
        "orbit_past_line_width": orbit_cfg.get("past_line_width", system_cfg.get("orbit_past_line_width", 5)),
        "satellite_label_size_px": satellites_cfg.get("label_size_px", system_cfg.get("satellite_label_size_px", 14)),
        "satellite_model_scale": satellites_cfg.get("model_scale", system_cfg.get("satellite_model_scale", 1.0)),
        "max_satellites_visible": satellites_cfg.get("max_visible", system_cfg.get("max_satellites_visible", 100)),
        "websocket_state_interval_seconds": realtime_cfg.get(
            "state_interval_seconds", system_cfg.get("websocket_state_interval_seconds", 1.0)
        ),
        "websocket_orbit_interval_seconds": realtime_cfg.get(
            "orbit_interval_seconds", system_cfg.get("websocket_orbit_interval_seconds", 10.0)
        ),
    }


def load_system_config():
    defaults_system = {
        "orbit_future_show": True, "propagation_hours": 12,
        "orbit_future_line_width": 3, "orbit_future_color": "#00ff88",
        "orbit_past_color": "#ff0000", "orbit_past_seconds": 120,
        "websocket_state_interval_seconds": 1.0, "websocket_orbit_interval_seconds": 10.0,
    }
    defaults_data = {"satellites_catalog_file": "catalog.json"}
    try:
        with open(SYSTEM_CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)
    except Exception as e:
        print(f"Warning: No se pudo leer system_config.json: {e}")
        return defaults_system, defaults_data

    system_cfg = normalize_system_config(config.get("system", {}))
    data_cfg = config.get("data", {})
    for key, default in defaults_system.items():
        system_cfg.setdefault(key, default)
    data_cfg.setdefault("satellites_catalog_file", "catalog.json")
    return system_cfg, data_cfg


def load_constellation():
    global propagators, propagators_by_name, system_config
    global orbit_cache_payload, orbit_cache_key, orbit_cache_valid_until

    print("Recargando constelacion...")
    new_system_config, data_config = load_system_config()
    catalog_file = data_config.get("satellites_catalog_file", "catalog.json")
    config_file = os.path.join(CONFIG_DIR, catalog_file)

    tles = load_all_tles_from_config(config_file)
    print(f"  {len(tles)} satelites cargados desde {catalog_file}")

    new_props, new_props_by_name, invalid_count = [], {}, 0
    for name, l1, l2 in tles:
        try:
            prop = propagator_registry.create("sgp4", l1, l2)
            new_props.append((name, prop))
            new_props_by_name[name] = prop
        except Exception as e:
            invalid_count += 1
            print(f"  TLE invalido ignorado: {name} ({e})")

    with state_lock:
        propagators = new_props
        propagators_by_name = new_props_by_name
        system_config = new_system_config
        orbit_cache_payload = []
        orbit_cache_key = None
        orbit_cache_valid_until = datetime.datetime.min.replace(tzinfo=datetime.UTC)
        orbit_point_cache.clear()

    print(f"  Constelacion lista: {len(new_props)} validos, {invalid_count} invalidos")


def get_state_snapshot():
    with state_lock:
        return list(propagators), dict(system_config), dict(propagators_by_name)


def compute_auto_orbit_samples(horizon_hours, satellites_count=1, prop=None):
    return compute_auto_samples(
        horizon_hours,
        satellites_count,
        prop,
        AUTO_MIN_ORBIT_SAMPLES,
        AUTO_MAX_ORBIT_SAMPLES,
        MAX_TOTAL_ORBIT_POINTS_PER_BATCH,
    )


def get_runtime_propagation_hours(cfg):
    global runtime_config_mtime, runtime_propagation_hours
    fallback = clamp_propagation_hours(cfg.get("propagation_hours", 12))
    try:
        mtime = os.path.getmtime(SYSTEM_CONFIG_PATH)
    except OSError:
        return fallback
    if runtime_config_mtime == mtime:
        return runtime_propagation_hours
    runtime_config_mtime = mtime
    try:
        with open(SYSTEM_CONFIG_PATH, "r", encoding="utf-8") as f:
            payload = json.load(f)
        orbit_cfg = payload.get("system", {}).get("orbit", {}) if isinstance(payload, dict) else {}
        runtime_propagation_hours = clamp_propagation_hours(orbit_cfg.get("propagation_hours", fallback))
    except Exception:
        runtime_propagation_hours = fallback
    return runtime_propagation_hours


def build_orbit_payload(props, cfg):
    if not cfg.get("orbit_future_show", True):
        return []
    horizon_hours = get_runtime_propagation_hours(cfg)
    now = datetime.datetime.now(datetime.UTC)
    payload = []
    for name, prop in props:
        samples = compute_auto_orbit_samples(horizon_hours, len(props), prop)
        sat_key = (name, horizon_hours, samples)
        with state_lock:
            cached = orbit_point_cache.get(sat_key)
        if cached and now < cached["valid_until"]:
            orbit = cached["orbit"]
        else:
            orbit = []
            for i in range(samples):
                offset = (i / max(samples - 1, 1)) * horizon_hours * 3600
                ox, oy, oz, _, _, _ = prop.propagate_offset(offset)
                orbit.append({"x": ox, "y": oy, "z": oz})
            with state_lock:
                orbit_point_cache[sat_key] = {
                    "orbit": orbit,
                    "valid_until": now + datetime.timedelta(seconds=ORBIT_CACHE_TTL_SECONDS),
                }
        payload.append({
            "satellite": name, "orbit": orbit,
            "orbit_horizon_hours": horizon_hours, "orbit_samples": samples,
        })
    return payload


def get_orbits_cached(props, cfg):
    global orbit_cache_payload, orbit_cache_key, orbit_cache_valid_until
    now = datetime.datetime.now(datetime.UTC)
    horizon_hours = get_runtime_propagation_hours(cfg)
    sample_plan = tuple(compute_auto_orbit_samples(horizon_hours, len(props), p) for _, p in props)
    cache_key = (
        tuple(n for n, _ in props), cfg.get("orbit_future_show", True),
        horizon_hours, sample_plan,
    )
    with state_lock:
        if orbit_cache_key == cache_key and now < orbit_cache_valid_until:
            return orbit_cache_payload
    payload = build_orbit_payload(props, cfg)
    with state_lock:
        orbit_cache_payload = payload
        orbit_cache_key = cache_key
        orbit_cache_valid_until = now + datetime.timedelta(seconds=ORBIT_CACHE_TTL_SECONDS)
    return payload


class ConfigWatcher(FileSystemEventHandler):
    def on_modified(self, event):
        if any(event.src_path.endswith(s) for s in
               ("system_config.json", "catalog.json", "catalog.txt", "_tles.txt")):
            try:
                load_constellation()
            except Exception as e:
                print(f"Error recargando constelacion: {e}")


def start_watcher():
    observer = Observer()
    observer.schedule(ConfigWatcher(), path=str(CONFIG_DIR), recursive=False)
    observer.start()
    print(f"Watcher activo en {CONFIG_DIR}")


def handle_sighup(_signum, _frame):
    try:
        load_constellation()
    except Exception as exc:
        print(f"Error recargando constelacion por SIGHUP: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_constellation()
    threading.Thread(target=start_watcher, daemon=True).start()
    try:
        signal.signal(signal.SIGHUP, handle_sighup)
        print("SIGHUP registrado para recarga de constelacion")
    except (AttributeError, OSError, ValueError):
        pass
    yield


app = FastAPI(
    title="Orbit Propagation API",
    version="0.1.0",
    description="Backend SGP4 de propagacion orbital para Orbit.",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

def _satellite_count() -> int:
    with state_lock:
        return len(propagators)


def _reload_constellation() -> int:
    load_constellation()
    return _satellite_count()


app.include_router(create_system_router(_satellite_count, _reload_constellation))

def _catalog_satellite_ids() -> list[str]:
    props, _, _ = get_state_snapshot()
    return [name for name, _ in props]


app.include_router(create_catalog_router(_catalog_satellite_ids))
app.include_router(create_orbits_router(_resolve_propagator_for_request, _serialize_state, compute_auto_orbit_samples, _build_ephemeris))
app.include_router(create_ground_stations_router(_resolve_propagator_for_request, _build_ephemeris, _ensure_utc))
app.include_router(create_exports_router(_find_catalog_entry, _resolve_propagator_for_request, _build_ephemeris, _ensure_utc))
app.include_router(create_realtime_router(get_state_snapshot, get_orbits_cached, COMPRESSION_THRESHOLD))


def propagate_satellite_at(
    sat_id: str,
    at: datetime.datetime | None = Query(default=None),
):
    name, prop = _resolve_propagator_for_request(sat_id=sat_id, line1=None, line2=None)
    target = _ensure_utc(at or datetime.datetime.now(datetime.UTC))
    x, y, z, vx, vy, vz = prop.propagate_datetime(target.replace(tzinfo=None))
    return _serialize_state(name, target, x, y, z, vx, vy, vz, include_velocity=True)


def propagate_from_request(payload: PropagationRequest):
    name, prop = _resolve_propagator_for_request(payload.sat_id, payload.line1, payload.line2)
    target = _ensure_utc(payload.at or datetime.datetime.now(datetime.UTC))
    x, y, z, vx, vy, vz = prop.propagate_datetime(target.replace(tzinfo=None))
    return _serialize_state(name, target, x, y, z, vx, vy, vz, include_velocity=True)


def orbit_for_satellite(
    sat_id: str,
    horizon_hours: float = Query(default=12.0, ge=PROPAGATION_HOURS_MIN, le=PROPAGATION_HOURS_MAX),
    samples: int | None = Query(default=None, ge=2, le=AUTO_MAX_ORBIT_SAMPLES),
):
    name, prop = _resolve_propagator_for_request(sat_id=sat_id, line1=None, line2=None)
    samples_count = samples or compute_auto_orbit_samples(horizon_hours, 1, prop)
    orbit = []
    for i in range(samples_count):
        offset = (i / max(samples_count - 1, 1)) * horizon_hours * 3600
        x, y, z, _, _, _ = prop.propagate_offset(offset)
        orbit.append({"x": x, "y": y, "z": z})
    return {
        "satellite": name,
        "orbit_horizon_hours": horizon_hours,
        "orbit_samples": samples_count,
        "orbit": orbit,
    }


def orbit_from_request(payload: OrbitRequest):
    name, prop = _resolve_propagator_for_request(payload.sat_id, payload.line1, payload.line2)
    samples_count = payload.samples or compute_auto_orbit_samples(payload.horizon_hours, 1, prop)
    orbit = []
    for i in range(samples_count):
        offset = (i / max(samples_count - 1, 1)) * payload.horizon_hours * 3600
        x, y, z, _, _, _ = prop.propagate_offset(offset)
        orbit.append({"x": x, "y": y, "z": z})
    return {
        "satellite": name,
        "orbit_horizon_hours": payload.horizon_hours,
        "orbit_samples": samples_count,
        "orbit": orbit,
    }


def ephemeris_endpoint(payload: EphemerisRequest):
    name, prop = _resolve_propagator_for_request(payload.sat_id, payload.line1, payload.line2)
    result = _build_ephemeris(
        name,
        prop,
        payload.start_time,
        payload.end_time,
        payload.step_seconds,
        include_velocity=payload.include_velocity,
    )
    return result


def export_tle_endpoint(sat_id: str):
    entry = _find_catalog_entry(sat_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Satelite no encontrado")

    file_base = _safe_filename(entry.get("name", sat_id))
    tle_text = f"{entry['name']}\n{entry['line1']}\n{entry['line2']}\n"
    return Response(
        content=tle_text,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={file_base}.tle"},
    )


def export_omm_endpoint(sat_id: str, format: str = Query(default="json")):
    entry = _find_catalog_entry(sat_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Satelite no encontrado")

    fmt = (format or "json").strip().lower()
    file_base = _safe_filename(entry.get("name", sat_id))
    if fmt == "xml":
        return Response(
            content=_omm_xml_from_entry(entry),
            media_type="application/xml; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename={file_base}.omm.xml"},
        )

    return Response(
        content=json.dumps(_omm_json_from_entry(entry), ensure_ascii=False, indent=2),
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={file_base}.omm.json"},
    )


def export_ocm_endpoint(sat_id: str):
    entry = _find_catalog_entry(sat_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Satelite no encontrado")

    file_base = _safe_filename(entry.get("name", sat_id))
    return Response(
        content=json.dumps(_ocm_json_from_entry(entry), ensure_ascii=False, indent=2),
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={file_base}.ocm.json"},
    )


def export_ephemeris_endpoint(
    sat_id: str,
    t0: datetime.datetime,
    t1: datetime.datetime,
    dt: float = Query(default=10.0, gt=0, le=3600),
    format: str = Query(default="csv"),
    propagator: str = Query(default="sgp4"),
    sourceFormat: str | None = Query(default=None),
):
    normalized_propagator = (propagator or "sgp4").strip().lower()
    if normalized_propagator != "sgp4":
        raise HTTPException(status_code=400, detail="Propagador no soportado por el momento. Usa SGP4.")

    entry = _find_catalog_entry(sat_id)
    inferred_source = _normalize_source_format(entry.get("sourceFormat") if entry else None, fallback="TLE")
    normalized_source = _normalize_source_format(sourceFormat, fallback=inferred_source)

    payload = EphemerisRequest(
        sat_id=sat_id,
        start_time=t0,
        end_time=t1,
        step_seconds=dt,
        include_velocity=True,
    )
    result = ephemeris_endpoint(payload)
    result["source_format"] = normalized_source
    result["propagator"] = normalized_propagator

    fmt = (format or "csv").strip().lower()
    file_base = _safe_filename(result.get("satellite", sat_id))
    points = result.get("points", [])

    if fmt == "json":
        return Response(
            content=json.dumps(result, ensure_ascii=False, indent=2),
            media_type="application/json; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename={file_base}-ephemeris.json"},
        )

    if fmt == "oem":
        oem_text = _ephemeris_oem_text(
            result.get("satellite", sat_id),
            result.get("start_time", _ensure_utc(t0).isoformat()),
            result.get("end_time", _ensure_utc(t1).isoformat()),
            points,
            source_format=normalized_source,
            propagator=normalized_propagator,
        )
        return Response(
            content=oem_text,
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename={file_base}-ephemeris.oem"},
        )

    csv_text = _ephemeris_csv_text(points, source_format=normalized_source, propagator=normalized_propagator)
    return Response(
        content=csv_text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={file_base}-ephemeris.csv"},
    )


def aos_los_get(
    sat_id: str,
    station_lat_deg: float = Query(..., ge=-90, le=90),
    station_lon_deg: float = Query(..., ge=-180, le=180),
    min_elevation_deg: float = Query(default=10.0, ge=0, le=90),
    start_time: datetime.datetime | None = Query(default=None),
    end_time: datetime.datetime | None = Query(default=None),
    step_seconds: float = Query(default=10.0, gt=0, le=600),
):
    now = datetime.datetime.now(datetime.UTC)
    start = start_time or now
    end = end_time or (now + datetime.timedelta(hours=24))
    payload = AosLosRequest(
        sat_id=sat_id,
        station=StationInput(lat_deg=station_lat_deg, lon_deg=station_lon_deg, min_elevation_deg=min_elevation_deg),
        start_time=start,
        end_time=end,
        step_seconds=step_seconds,
    )
    return aos_los_post(payload)


def aos_los_post(payload: AosLosRequest):
    name, prop = _resolve_propagator_for_request(payload.sat_id, payload.line1, payload.line2)
    eph = _build_ephemeris(
        name,
        prop,
        payload.start_time,
        payload.end_time,
        payload.step_seconds,
        include_velocity=False,
    )

    visibility_points = []
    for point in eph["points"]:
        pos = point.get("position") or {}
        elev = elevation_degrees(
            payload.station.lat_deg,
            payload.station.lon_deg,
            (
                float(pos.get("x") or 0.0),
                float(pos.get("y") or 0.0),
                float(pos.get("z") or 0.0),
            ),
        )
        visibility_points.append({
            "time": point.get("time"),
            "elevation_deg": elev,
            "visible": elev >= payload.station.min_elevation_deg,
        })

    passes = extract_passes(visibility_points, payload.station.min_elevation_deg)
    return {
        "satellite": name,
        "station": payload.station.model_dump(),
        "start_time": _ensure_utc(payload.start_time).isoformat(),
        "end_time": _ensure_utc(payload.end_time).isoformat(),
        "step_seconds": payload.step_seconds,
        "passes": passes,
        "samples": visibility_points,
        "count": len(visibility_points),
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8765, log_level="info")

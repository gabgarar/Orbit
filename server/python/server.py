# server.py — Backend FastAPI para propagación orbital Orbit
import asyncio
import csv
import datetime
import hashlib
import json
import math
import os
import signal
import threading
import zlib
from collections import OrderedDict
from contextlib import asynccontextmanager
from io import StringIO

import uvicorn
from fastapi import FastAPI, HTTPException, Query, Response, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field, model_validator
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from propagator import SGP4Propagator
from tle_loader import load_all_tles_from_config

BASE_DIR = os.path.dirname(__file__)
CONFIG_DIR = os.path.abspath(os.path.join(BASE_DIR, "../../config"))
SYSTEM_CONFIG_PATH = os.path.join(CONFIG_DIR, "system_config.json")

MAX_CACHED_ORBITS = 50
AUTO_MIN_ORBIT_SAMPLES = 24
AUTO_MAX_ORBIT_SAMPLES = 1440
PROPAGATION_HOURS_MIN = 0.1
PROPAGATION_HOURS_MAX = 240.0
ORBIT_CACHE_TTL_SECONDS = 10
MAX_TOTAL_ORBIT_POINTS_PER_BATCH = 300_000
COMPRESSION_THRESHOLD = 1024
MAX_EPHEMERIS_CACHE_ITEMS = 256
EPHEMERIS_CACHE_TTL_SECONDS = 120
MAX_EPHEMERIS_POINTS = 20_000

propagators: list = []
propagators_by_name: dict = {}
system_config: dict = {}
state_lock = threading.Lock()

orbit_lru_cache: OrderedDict = OrderedDict()
orbit_point_cache: dict = {}
orbit_cache_payload: list = []
orbit_cache_key = None
orbit_cache_valid_until = datetime.datetime.min.replace(tzinfo=datetime.UTC)
runtime_config_mtime = None
runtime_propagation_hours = 12
ephemeris_cache: OrderedDict = OrderedDict()


class PropagationRequest(BaseModel):
    sat_id: str | None = None
    line1: str | None = None
    line2: str | None = None
    at: datetime.datetime | None = None

    @model_validator(mode="after")
    def _validate_source(self):
        has_sat = bool(self.sat_id and self.sat_id.strip())
        has_tle = bool(self.line1 and self.line2 and self.line1.strip() and self.line2.strip())
        if not has_sat and not has_tle:
            raise ValueError("Debes enviar sat_id o line1+line2")
        return self


class OrbitRequest(BaseModel):
    sat_id: str | None = None
    line1: str | None = None
    line2: str | None = None
    horizon_hours: float = Field(default=12.0, ge=PROPAGATION_HOURS_MIN, le=PROPAGATION_HOURS_MAX)
    samples: int | None = Field(default=None, ge=2, le=AUTO_MAX_ORBIT_SAMPLES)

    @model_validator(mode="after")
    def _validate_source(self):
        has_sat = bool(self.sat_id and self.sat_id.strip())
        has_tle = bool(self.line1 and self.line2 and self.line1.strip() and self.line2.strip())
        if not has_sat and not has_tle:
            raise ValueError("Debes enviar sat_id o line1+line2")
        return self


class StationInput(BaseModel):
    lat_deg: float = Field(ge=-90, le=90)
    lon_deg: float = Field(ge=-180, le=180)
    min_elevation_deg: float = Field(default=10.0, ge=0, le=90)


class EphemerisRequest(BaseModel):
    sat_id: str | None = None
    line1: str | None = None
    line2: str | None = None
    start_time: datetime.datetime
    end_time: datetime.datetime
    step_seconds: float = Field(default=30.0, gt=0, le=3600)
    include_velocity: bool = True

    @model_validator(mode="after")
    def _validate_range_and_source(self):
        has_sat = bool(self.sat_id and self.sat_id.strip())
        has_tle = bool(self.line1 and self.line2 and self.line1.strip() and self.line2.strip())
        if not has_sat and not has_tle:
            raise ValueError("Debes enviar sat_id o line1+line2")
        if self.end_time <= self.start_time:
            raise ValueError("end_time debe ser mayor que start_time")
        return self


class AosLosRequest(BaseModel):
    sat_id: str | None = None
    line1: str | None = None
    line2: str | None = None
    station: StationInput
    start_time: datetime.datetime
    end_time: datetime.datetime
    step_seconds: float = Field(default=10.0, gt=0, le=600)

    @model_validator(mode="after")
    def _validate_source(self):
        has_sat = bool(self.sat_id and self.sat_id.strip())
        has_tle = bool(self.line1 and self.line2 and self.line1.strip() and self.line2.strip())
        if not has_sat and not has_tle:
            raise ValueError("Debes enviar sat_id o line1+line2")
        if self.end_time <= self.start_time:
            raise ValueError("end_time debe ser mayor que start_time")
        return self


def _ensure_utc(dt: datetime.datetime) -> datetime.datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=datetime.UTC)
    return dt.astimezone(datetime.UTC)


def _cache_get(cache_key: str):
    now = datetime.datetime.now(datetime.UTC)
    with state_lock:
        item = ephemeris_cache.get(cache_key)
        if not item:
            return None
        if now >= item["valid_until"]:
            ephemeris_cache.pop(cache_key, None)
            return None
        ephemeris_cache.move_to_end(cache_key)
        return item["value"]


def _cache_set(cache_key: str, value):
    now = datetime.datetime.now(datetime.UTC)
    with state_lock:
        ephemeris_cache[cache_key] = {
            "value": value,
            "valid_until": now + datetime.timedelta(seconds=EPHEMERIS_CACHE_TTL_SECONDS),
        }
        ephemeris_cache.move_to_end(cache_key)
        while len(ephemeris_cache) > MAX_EPHEMERIS_CACHE_ITEMS:
            ephemeris_cache.popitem(last=False)


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
        prop = SGP4Propagator(l1, l2)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"TLE invalido: {exc}") from exc
    tle_hash = hashlib.sha1(f"{l1}\n{l2}".encode("utf-8")).hexdigest()[:12]
    return f"tle:{tle_hash}", prop


def _safe_filename(value: str, fallback="satellite"):
    raw = (value or fallback).strip()
    normalized = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in raw)
    return normalized or fallback


def _load_catalog_entries_with_tle():
    _, data_config = load_system_config()
    catalog_file = data_config.get("satellites_catalog_file", "catalog.json")
    config_file = os.path.join(CONFIG_DIR, catalog_file)

    if os.path.exists(config_file) and config_file.lower().endswith(".json"):
        try:
            with open(config_file, "r", encoding="utf-8") as fh:
                payload = json.load(fh)

            rows = payload if isinstance(payload, list) else payload.get("entries", []) if isinstance(payload, dict) else []
            entries = []
            for row in rows:
                if not isinstance(row, dict):
                    continue
                name = str(row.get("name", "")).strip()
                line1 = str(row.get("line1", "")).strip()
                line2 = str(row.get("line2", "")).strip()
                if not name or not line1 or not line2:
                    continue
                source = str(row.get("sourceFormat") or row.get("format") or "TLE").strip().upper()
                if source not in {"TLE", "OMM", "OEM"}:
                    source = "TLE"
                entries.append({"name": name, "line1": line1, "line2": line2, "sourceFormat": source})

            if entries:
                return entries
        except Exception:
            pass

    entries = []
    for name, l1, l2 in load_all_tles_from_config(config_file):
        entries.append({"name": name, "line1": l1, "line2": l2, "sourceFormat": "TLE"})
    return entries


def _find_catalog_entry(sat_id: str):
    target = (sat_id or "").strip().lower()
    if not target:
        return None
    for entry in _load_catalog_entries_with_tle():
        if str(entry.get("name", "")).strip().lower() == target:
            return entry
    return None


def _normalize_source_format(value: str | None, fallback="TLE"):
    source = str(value or fallback).strip().upper()
    if source in {"TLE", "OMM", "OEM"}:
        return source
    return fallback


def _omm_json_from_entry(entry: dict):
    return {
        "OBJECT_NAME": entry.get("name"),
        "OBJECT_ID": entry.get("name"),
        "TLE_LINE1": entry.get("line1"),
        "TLE_LINE2": entry.get("line2"),
    }


def _omm_xml_from_entry(entry: dict):
    name = entry.get("name", "")
    line1 = entry.get("line1", "")
    line2 = entry.get("line2", "")
    return (
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
        "<ndm>\n"
        "  <omm version=\"2.0\">\n"
        "    <body>\n"
        "      <segment>\n"
        "        <metadata>\n"
        f"          <OBJECT_NAME>{name}</OBJECT_NAME>\n"
        f"          <OBJECT_ID>{name}</OBJECT_ID>\n"
        "        </metadata>\n"
        "        <data>\n"
        "          <tleParameters>\n"
        f"            <TLE_LINE1>{line1}</TLE_LINE1>\n"
        f"            <TLE_LINE2>{line2}</TLE_LINE2>\n"
        "          </tleParameters>\n"
        "        </data>\n"
        "      </segment>\n"
        "    </body>\n"
        "  </omm>\n"
        "</ndm>\n"
    )


def _ocm_json_from_entry(entry: dict):
    return {
        "format": "OCM",
        "object": {
            "name": entry.get("name"),
        },
        "mean_elements_source": {
            "line1": entry.get("line1"),
            "line2": entry.get("line2"),
        },
        "generatedAt": datetime.datetime.now(datetime.UTC).isoformat(),
    }


def _ephemeris_csv_text(points: list[dict], source_format="TLE", propagator="sgp4"):
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["time", "x", "y", "z", "vx", "vy", "vz", "source_format", "propagator"])
    for point in points:
        pos = point.get("position") or {}
        vel = point.get("velocity") or {}
        writer.writerow([
            point.get("time", ""),
            pos.get("x", ""),
            pos.get("y", ""),
            pos.get("z", ""),
            vel.get("x", ""),
            vel.get("y", ""),
            vel.get("z", ""),
            source_format,
            propagator,
        ])
    return output.getvalue()


def _ephemeris_oem_text(name: str, start_iso: str, end_iso: str, points: list[dict], source_format="TLE", propagator="sgp4"):
    lines = [
        "CCSDS_OEM_VERS = 2.0",
        f"CREATION_DATE = {datetime.datetime.now(datetime.UTC).isoformat()}",
        "ORIGINATOR = Orbit",
        f"COMMENT = SOURCE_FORMAT {source_format}",
        f"COMMENT = PROPAGATOR {propagator}",
        "META_START",
        f"OBJECT_NAME = {name}",
        f"OBJECT_ID = {name}",
        "CENTER_NAME = EARTH",
        "REF_FRAME = TEME",
        "TIME_SYSTEM = UTC",
        f"START_TIME = {start_iso}",
        f"STOP_TIME = {end_iso}",
        "META_STOP",
    ]

    for point in points:
        pos = point.get("position") or {}
        vel = point.get("velocity") or {}
        lines.append(
            f"{point.get('time','')} {pos.get('x',0)} {pos.get('y',0)} {pos.get('z',0)} {vel.get('x',0)} {vel.get('y',0)} {vel.get('z',0)}"
        )

    return "\n".join(lines) + "\n"


def _build_ephemeris(name: str, prop: SGP4Propagator, start_time: datetime.datetime, end_time: datetime.datetime, step_seconds: float, include_velocity=True):
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


def _ecef_from_latlon(lat_deg: float, lon_deg: float, radius_m=6378137.0):
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    cos_lat = math.cos(lat)
    return (
        radius_m * cos_lat * math.cos(lon),
        radius_m * cos_lat * math.sin(lon),
        radius_m * math.sin(lat),
    )


def _elevation_deg_for_station(station_lat_deg: float, station_lon_deg: float, sat_xyz: tuple[float, float, float]):
    sx, sy, sz = _ecef_from_latlon(station_lat_deg, station_lon_deg)
    px = sat_xyz[0] - sx
    py = sat_xyz[1] - sy
    pz = sat_xyz[2] - sz

    lat = math.radians(station_lat_deg)
    lon = math.radians(station_lon_deg)
    sin_lat = math.sin(lat)
    cos_lat = math.cos(lat)
    sin_lon = math.sin(lon)
    cos_lon = math.cos(lon)

    east = -sin_lon * px + cos_lon * py
    north = -sin_lat * cos_lon * px - sin_lat * sin_lon * py + cos_lat * pz
    up = cos_lat * cos_lon * px + cos_lat * sin_lon * py + sin_lat * pz

    horizontal = math.sqrt(max(0.0, east * east + north * north))
    return math.degrees(math.atan2(up, horizontal))


def _extract_passes(points: list, min_elev_deg: float):
    passes = []
    in_pass = False
    aos_time = None
    max_elev = -90.0
    max_elev_time = None

    for item in points:
        elev = float(item.get("elevation_deg") or -90.0)
        ts = item.get("time")
        above = elev >= min_elev_deg

        if above and not in_pass:
            in_pass = True
            aos_time = ts
            max_elev = elev
            max_elev_time = ts

        if in_pass and elev > max_elev:
            max_elev = elev
            max_elev_time = ts

        if in_pass and not above:
            passes.append({
                "aos": aos_time,
                "los": ts,
                "max_elevation_deg": max_elev,
                "max_elevation_time": max_elev_time,
            })
            in_pass = False
            aos_time = None
            max_elev = -90.0
            max_elev_time = None

    if in_pass:
        last_time = points[-1].get("time") if points else None
        passes.append({
            "aos": aos_time,
            "los": last_time,
            "max_elevation_deg": max_elev,
            "max_elevation_time": max_elev_time,
        })

    return passes


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
            prop = SGP4Propagator(l1, l2)
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


def get_orbit_density_factor(prop):
    sat = getattr(prop, "sat", None)
    if sat is None:
        return 1.0
    try:
        eccentricity = max(0.0, float(getattr(sat, "ecco", 0.0) or 0.0))
    except Exception:
        return 1.0
    factor = 1.0
    if eccentricity >= 0.1:
        factor += min(0.8, eccentricity * 1.2)
    if eccentricity >= 0.25:
        factor += min(1.2, (eccentricity - 0.25) * 2.0)
    if eccentricity >= 0.5:
        factor += min(1.0, (eccentricity - 0.5) * 2.0)
    return max(1.0, min(3.0, factor))


def compute_auto_orbit_samples(horizon_hours, satellites_count=1, prop=None):
    safe_hours = horizon_hours if isinstance(horizon_hours, (int, float)) and horizon_hours > 0 else 12
    step = 15 if safe_hours <= 1 else (30 if safe_hours <= 6 else (60 if safe_hours <= 24 else 120))
    raw = int((safe_hours * 3600) / step) + 1
    base = max(AUTO_MIN_ORBIT_SAMPLES, min(AUTO_MAX_ORBIT_SAMPLES, raw))
    budget = max(AUTO_MIN_ORBIT_SAMPLES, MAX_TOTAL_ORBIT_POINTS_PER_BATCH // max(1, satellites_count))
    dense = int(round(base * get_orbit_density_factor(prop)))
    return max(AUTO_MIN_ORBIT_SAMPLES, min(dense, budget))


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
    observer.schedule(ConfigWatcher(), path=CONFIG_DIR, recursive=False)
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


@app.get("/health")
def health():
    with state_lock:
        n = len(propagators)
    return {"status": "ok", "satellites": n}


@app.get("/catalog")
def catalog_endpoint():
    props, _, _ = get_state_snapshot()
    return {"satellites": [name for name, _ in props]}


@app.post("/reload")
def reload_endpoint():
    load_constellation()
    with state_lock:
        total = len(propagators)
    return {"status": "reloaded", "satellites": total}


@app.get("/propagate/{sat_id}")
def propagate_satellite_at(
    sat_id: str,
    at: datetime.datetime | None = Query(default=None),
):
    name, prop = _resolve_propagator_for_request(sat_id=sat_id, line1=None, line2=None)
    target = _ensure_utc(at or datetime.datetime.now(datetime.UTC))
    x, y, z, vx, vy, vz = prop.propagate_datetime(target.replace(tzinfo=None))
    return _serialize_state(name, target, x, y, z, vx, vy, vz, include_velocity=True)


@app.post("/propagate")
def propagate_from_request(payload: PropagationRequest):
    name, prop = _resolve_propagator_for_request(payload.sat_id, payload.line1, payload.line2)
    target = _ensure_utc(payload.at or datetime.datetime.now(datetime.UTC))
    x, y, z, vx, vy, vz = prop.propagate_datetime(target.replace(tzinfo=None))
    return _serialize_state(name, target, x, y, z, vx, vy, vz, include_velocity=True)


@app.get("/orbits/{sat_id}")
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


@app.post("/orbits")
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


@app.post("/ephemeris")
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


@app.get("/export/tle/{sat_id}")
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


@app.get("/export/omm/{sat_id}")
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


@app.get("/export/ocm/{sat_id}")
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


@app.get("/export/ephemeris/{sat_id}")
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


@app.get("/aos-los")
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


@app.post("/aos-los")
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
        elev = _elevation_deg_for_station(
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

    passes = _extract_passes(visibility_points, payload.station.min_elevation_deg)
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


async def _send(websocket: WebSocket, payload: dict):
    json_str = json.dumps(payload)
    if len(json_str) >= COMPRESSION_THRESHOLD:
        try:
            compressed = zlib.compress(json_str.encode(), level=6)
            if len(compressed) < len(json_str):
                await websocket.send_bytes(compressed)
                return
        except Exception:
            pass
    await websocket.send_text(json_str)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    client_id = id(websocket)
    subscriptions: set[str] = set()
    force_refresh = [False]

    print(f"Cliente conectado (ID: {client_id})")

    props, _, _ = get_state_snapshot()
    await websocket.send_text(json.dumps({
        "type": "catalog",
        "data": [name for name, _ in props],
        "compressed": False,
    }))

    async def receiver():
        while True:
            try:
                data = await websocket.receive()
                if data.get("type") == "websocket.disconnect":
                    break
                raw = data.get("text") or (data["bytes"].decode() if data.get("bytes") else None)
                if not raw:
                    continue
                msg = json.loads(raw)
                if not isinstance(msg, dict):
                    continue
                msg_type = msg.get("type")
                ids = [str(x) for x in msg.get("ids", []) if isinstance(x, str)]
                if msg_type == "subscribe":
                    subscriptions.update(ids)
                    force_refresh[0] = True
                elif msg_type == "unsubscribe":
                    for i in ids:
                        subscriptions.discard(i)
                    force_refresh[0] = True
                elif msg_type == "set_subscriptions":
                    subscriptions.clear()
                    subscriptions.update(ids)
                    force_refresh[0] = True
            except (WebSocketDisconnect, Exception):
                break

    receiver_task = asyncio.create_task(receiver())
    loop = asyncio.get_running_loop()
    next_state_at = 0.0
    next_orbit_at = 0.0

    try:
        while not receiver_task.done():
            if force_refresh[0]:
                next_state_at = 0.0
                next_orbit_at = 0.0
                force_refresh[0] = False

            now = loop.time()
            props, cfg, props_by_name = get_state_snapshot()
            state_interval = cfg.get("websocket_state_interval_seconds", 1.0)
            orbit_interval = cfg.get("websocket_orbit_interval_seconds", 10.0)
            sent = False

            if now >= next_state_at:
                data = []
                for name in subscriptions:
                    prop = props_by_name.get(name)
                    if prop is None:
                        continue
                    x, y, z, vx, vy, vz = prop.propagate()
                    data.append({
                        "satellite": name,
                        "position": {"x": x, "y": y, "z": z},
                        "velocity": {"x": vx, "y": vy, "z": vz},
                    })
                await _send(websocket, {"type": "state", "data": data, "compressed": False})
                next_state_at = now + state_interval
                sent = True

            if cfg.get("orbit_future_show", True) and now >= next_orbit_at:
                selected = [(n, props_by_name[n]) for n in subscriptions if n in props_by_name]
                orbit_data = get_orbits_cached(selected, cfg)
                await _send(websocket, {"type": "orbits", "data": orbit_data, "compressed": False})
                next_orbit_at = now + orbit_interval
                sent = True

            await asyncio.sleep(0 if sent else 0.05)

    except (WebSocketDisconnect, Exception):
        pass
    finally:
        receiver_task.cancel()
        print(f"Cliente desconectado (ID: {client_id})")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8765, log_level="info")

# server.py — Backend FastAPI para propagación orbital Orbit
import asyncio
import datetime
import hashlib
import json
import os
import signal
import threading
import zlib
from collections import OrderedDict
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
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

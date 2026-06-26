# server.py
import asyncio
import datetime
import hashlib
import json
import os
import signal
import threading
from collections import OrderedDict
from functools import lru_cache
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

from webSockets import WebSocketServer
from propagator import SGP4Propagator
from tle_loader import load_all_tles_from_config

BASE_DIR = os.path.dirname(__file__)
CONFIG_DIR = os.path.abspath(os.path.join(BASE_DIR, "../../config"))
SYSTEM_CONFIG_PATH = os.path.join(CONFIG_DIR, "system_config.json")

# =============================
# LRU Cache para órbitas (Límite de memoria)
# =============================
MAX_CACHED_ORBITS = 50
orbit_lru_cache = OrderedDict()
orbit_point_cache = {}
AUTO_MIN_ORBIT_SAMPLES = 24
AUTO_MAX_ORBIT_SAMPLES = 720
PROPAGATION_HOURS_MIN = 0.1
PROPAGATION_HOURS_MAX = 240.0
ORBIT_CACHE_TTL_SECONDS = 10
MAX_TOTAL_ORBIT_POINTS_PER_BATCH = 200000

# =============================
# Estado global de propagadores
# =============================
propagators = []
propagators_by_name = {}
system_config = {}
state_lock = threading.Lock()

orbit_cache_payload = []
orbit_cache_key = None
orbit_cache_hash = None
orbit_cache_valid_until = datetime.datetime.min.replace(tzinfo=datetime.UTC)
last_state_hash = None
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
            default=12,
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
        "websocket_state_interval_seconds": realtime_cfg.get("state_interval_seconds", system_cfg.get("websocket_state_interval_seconds", 1.0)),
        "websocket_orbit_interval_seconds": realtime_cfg.get("orbit_interval_seconds", system_cfg.get("websocket_orbit_interval_seconds", 10.0)),
    }


def load_system_config():
    try:
        with open(SYSTEM_CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)
    except Exception as e:
        print(f"⚠️ No se pudo leer system_config.json: {e}")
        return {
            "orbit_future_show": True,
            "propagation_hours": 12,
            "orbit_future_line_width": 3,
            "orbit_future_color": "#00ff88",
            "orbit_past_color": "#ff0000",
            "orbit_past_seconds": 120,
            "websocket_state_interval_seconds": 1.0,
            "websocket_orbit_interval_seconds": 10.0,
        }, {"satellites_catalog_file": "catalog.json"}

    system_cfg = normalize_system_config(config.get("system", {}))
    data_cfg = config.get("data", {})

    defaults = {
        "orbit_future_show": True,
        "propagation_hours": 12,
        "orbit_future_line_width": 3,
        "orbit_future_color": "#00ff88",
        "orbit_past_color": "#ff0000",
        "orbit_past_seconds": 120,
        "websocket_state_interval_seconds": 1.0,
        "websocket_orbit_interval_seconds": 10.0,
    }
    for key, default in defaults.items():
        system_cfg.setdefault(key, default)

    data_cfg.setdefault("satellites_catalog_file", "catalog.json")
    return system_cfg, data_cfg


def load_constellation():
    global propagators, propagators_by_name, system_config, orbit_cache_payload, orbit_cache_key, orbit_cache_valid_until
    print("🔄 Recargando constelación desde config...")

    new_system_config, data_config = load_system_config()
    catalog_file = data_config.get("satellites_catalog_file", "catalog.json")
    config_file = os.path.join(CONFIG_DIR, catalog_file)

    tles = load_all_tles_from_config(config_file)
    print(f"✔ {len(tles)} satélites cargados desde {catalog_file}")

    print(
        f"✔ Propagación: {new_system_config['propagation_hours']} horas, muestreo automático"
    )

    new_props = []
    new_props_by_name = {}
    invalid_count = 0
    for name, l1, l2 in tles:
        try:
            prop = SGP4Propagator(l1, l2)
            new_props.append((name, prop))
            new_props_by_name[name] = prop
        except Exception as e:
            invalid_count += 1
            print(f"⚠️ TLE inválido ignorado: {name} ({e})")

    with state_lock:
        propagators = new_props
        propagators_by_name = new_props_by_name
        system_config = new_system_config
        orbit_cache_payload = []
        orbit_cache_key = None
        orbit_cache_valid_until = datetime.datetime.min.replace(tzinfo=datetime.UTC)
        orbit_point_cache.clear()
    print(f"🛰️ Constelación actualizada ({len(new_props)} válidos, {invalid_count} inválidos ignorados)")


def get_state_snapshot():
    with state_lock:
        return list(propagators), dict(system_config), dict(propagators_by_name)


def compute_auto_orbit_samples(horizon_hours, satellites_count=1):
    safe_hours = horizon_hours if isinstance(horizon_hours, (int, float)) and horizon_hours > 0 else 12

    if safe_hours <= 1:
        target_step_seconds = 15
    elif safe_hours <= 6:
        target_step_seconds = 30
    elif safe_hours <= 24:
        target_step_seconds = 60
    else:
        target_step_seconds = 120

    raw_samples = int((safe_hours * 3600) / target_step_seconds) + 1
    base_samples = max(AUTO_MIN_ORBIT_SAMPLES, min(AUTO_MAX_ORBIT_SAMPLES, raw_samples))

    safe_satellites = satellites_count if isinstance(satellites_count, int) and satellites_count > 0 else 1
    budget_samples_per_sat = max(AUTO_MIN_ORBIT_SAMPLES, MAX_TOTAL_ORBIT_POINTS_PER_BATCH // safe_satellites)

    return max(AUTO_MIN_ORBIT_SAMPLES, min(base_samples, budget_samples_per_sat))


def get_runtime_propagation_hours(cfg):
    global runtime_config_mtime, runtime_propagation_hours

    fallback_hours = clamp_propagation_hours(cfg.get("propagation_hours", 12), default=12)

    try:
        mtime = os.path.getmtime(SYSTEM_CONFIG_PATH)
    except OSError:
        return fallback_hours

    if runtime_config_mtime == mtime:
        return runtime_propagation_hours

    runtime_config_mtime = mtime

    try:
        with open(SYSTEM_CONFIG_PATH, "r", encoding="utf-8") as f:
            payload = json.load(f)

        orbit_cfg = payload.get("system", {}).get("orbit", {}) if isinstance(payload, dict) else {}
        raw_hours = orbit_cfg.get("propagation_hours", fallback_hours)
        runtime_propagation_hours = clamp_propagation_hours(raw_hours, default=fallback_hours)
    except Exception:
        runtime_propagation_hours = fallback_hours

    return runtime_propagation_hours


def build_orbit_payload(props, cfg):
    orbit_future_show = cfg.get("orbit_future_show", True)
    if not orbit_future_show:
        return []

    horizon_hours = get_runtime_propagation_hours(cfg)

    samples = compute_auto_orbit_samples(horizon_hours, len(props))
    cache_ttl_seconds = ORBIT_CACHE_TTL_SECONDS
    now = datetime.datetime.now(datetime.UTC)

    payload = []
    for name, prop in props:
        sat_cache_key = (name, horizon_hours, samples)

        with state_lock:
            sat_cached = orbit_point_cache.get(sat_cache_key)

        if sat_cached and now < sat_cached["valid_until"]:
            orbit = sat_cached["orbit"]
        else:
            orbit = []
            for i in range(samples):
                offset_seconds = (i / (samples - 1)) * horizon_hours * 3600
                ox, oy, oz, _, _, _ = prop.propagate_offset(offset_seconds)
                orbit.append({"x": ox, "y": oy, "z": oz})

            with state_lock:
                orbit_point_cache[sat_cache_key] = {
                    "orbit": orbit,
                    "valid_until": now + datetime.timedelta(seconds=cache_ttl_seconds),
                }

        payload.append({
            "satellite": name,
            "orbit": orbit,
            "orbit_horizon_hours": horizon_hours,
            "orbit_samples": samples,
        })

    return payload


def get_orbits_cached(props, cfg):
    global orbit_cache_payload, orbit_cache_key, orbit_cache_hash, orbit_cache_valid_until

    now = datetime.datetime.now(datetime.UTC)
    cache_ttl_seconds = ORBIT_CACHE_TTL_SECONDS
    horizon_hours = get_runtime_propagation_hours(cfg)
    cache_key = (
        tuple(name for name, _ in props),
        cfg.get("orbit_future_show", True),
        horizon_hours,
        compute_auto_orbit_samples(horizon_hours, len(props)),
        cache_ttl_seconds,
    )

    with state_lock:
        cache_valid = orbit_cache_key == cache_key and now < orbit_cache_valid_until
        if cache_valid:
            return orbit_cache_payload

    payload = build_orbit_payload(props, cfg)
    
    # Calcular hash para detectar cambios reales
    payload_hash = hashlib.sha256(json.dumps(payload, default=str).encode()).hexdigest()

    with state_lock:
        orbit_cache_payload = payload
        orbit_cache_key = cache_key
        orbit_cache_hash = payload_hash
        orbit_cache_valid_until = now + datetime.timedelta(seconds=cache_ttl_seconds)
        return orbit_cache_payload


def get_payload_hash(payload):
    """Genera hash SHA256 del payload para detectar cambios."""
    try:
        return hashlib.sha256(json.dumps(payload, default=str, sort_keys=True).encode()).hexdigest()
    except:
        return None


def get_orbits_cached_lru(props, cfg):
    """Órbitas con LRU cache de memoria limitada."""
    cache_key = (
        tuple(name for name, _ in props),
        cfg.get("orbit_future_show", True),
        cfg.get("propagation_hours", 12),
        compute_auto_orbit_samples(cfg.get("propagation_hours", 12)),
    )
    
    if cache_key in orbit_lru_cache:
        orbit_lru_cache.move_to_end(cache_key)
        return orbit_lru_cache[cache_key]
    
    payload = build_orbit_payload(props, cfg)
    
    # Limitar tamaño del caché
    if len(orbit_lru_cache) >= MAX_CACHED_ORBITS:
        orbit_lru_cache.popitem(last=False)
    
    orbit_lru_cache[cache_key] = payload
    return payload


# -----------------------------
# Watcher para detectar cambios
# -----------------------------
class ConfigWatcher(FileSystemEventHandler):
    def on_modified(self, event):
        if (
            event.src_path.endswith("system_config.json")
            or event.src_path.endswith("catalog.txt")
            or event.src_path.endswith("catalog.json")
            or event.src_path.endswith("_tles.txt")
        ):
            try:
                load_constellation()
            except Exception as e:
                print(f"⚠️ Error recargando constelación: {e}")


def handle_reload_signal(signum, frame):
    del signum, frame
    try:
        print("🔁 Señal de recarga recibida (SIGHUP).")
        load_constellation()
    except Exception as e:
        print(f"⚠️ Error recargando constelación por señal: {e}")


def start_watcher():
    observer = Observer()
    observer.schedule(ConfigWatcher(), path="../../config", recursive=False)
    observer.start()
    print("👀 Watcher activo en ../../config")


# =============================
# Estadísticas de performance
# =============================
class PerformanceStats:
    def __init__(self):
        self.state_count = 0
        self.orbit_count = 0
        self.cache_hits = 0
        self.cache_misses = 0
        self.last_report = datetime.datetime.now(datetime.UTC)

    def report_state(self):
        self.state_count += 1

    def report_orbit(self, is_cache_hit):
        self.orbit_count += 1
        if is_cache_hit:
            self.cache_hits += 1
        else:
            self.cache_misses += 1

    def print_stats(self):
        now = datetime.datetime.now(datetime.UTC)
        elapsed = (now - self.last_report).total_seconds()
        if elapsed >= 30:  # Reportar cada 30 segundos
            total_orbits = self.cache_hits + self.cache_misses
            hit_rate = (self.cache_hits / total_orbits * 100) if total_orbits > 0 else 0
            
            print(f"\n📊 ESTADÍSTICAS (últimos {elapsed:.0f}s):")
            print(f"   Estados enviados: {self.state_count}")
            print(f"   Órbitas enviadas: {self.orbit_count}")
            print(f"   Caché hit rate: {hit_rate:.1f}% ({self.cache_hits}/{total_orbits})")
            print(f"   Órbitas en LRU cache: {len(orbit_lru_cache)}")
            print(f"   Propagadores activos: {len(propagators)}")
            
            self.state_count = 0
            self.orbit_count = 0
            self.cache_hits = 0
            self.cache_misses = 0
            self.last_report = now

perf_stats = PerformanceStats()


# =============================
# Servidor WebSocket
# =============================

def main():

    signal.signal(signal.SIGHUP, handle_reload_signal)

    # 1) Cargar constelación inicial
    load_constellation()

    # 2) Arrancar watcher en un hilo aparte
    watcher_thread = threading.Thread(target=start_watcher, daemon=True)
    watcher_thread.start()

    # 3) Crear servidor WebSocket
    _, initial_cfg, _ = get_state_snapshot()
    ws_server = WebSocketServer(
        state_interval=initial_cfg.get("websocket_state_interval_seconds", 1.0),
        orbit_interval=initial_cfg.get("websocket_orbit_interval_seconds", 10.0),
    )

    # 4) Callback: estado en tiempo real (sin órbitas)
    def state_tick(client_id, subscriptions):
        data = []
        props, cfg, props_by_name = get_state_snapshot()
        ws_server.state_interval = cfg.get("websocket_state_interval_seconds", 1.0)
        ws_server.orbit_interval = cfg.get("websocket_orbit_interval_seconds", 10.0)

        # Si orbit_future_show está desactivado, no calcular ni enviar órbitas.
        ws_server.set_orbit_callback(orbit_tick if cfg.get("orbit_future_show", True) else None)

        if subscriptions:
            selected = [(name, props_by_name[name]) for name in subscriptions if name in props_by_name]
        else:
            selected = []

        for name, prop in selected:
            x, y, z, vx, vy, vz = prop.propagate()
            satellite = {
                "satellite": name,
                "position": {"x": x, "y": y, "z": z},
                "velocity": {"x": vx, "y": vy, "z": vz}
            }
            data.append(satellite)
        return data

    # 5) Callback: órbitas con caché y menor frecuencia
    def orbit_tick(client_id, subscriptions):
        if not subscriptions:
            return []
        props, cfg, props_by_name = get_state_snapshot()
        selected = [(name, props_by_name[name]) for name in subscriptions if name in props_by_name]
        return get_orbits_cached(selected, cfg)

    def catalog_tick():
        props, _, _ = get_state_snapshot()
        return [name for name, _ in props]

    ws_server.set_state_callback(state_tick)
    ws_server.set_catalog_callback(catalog_tick)
    # state_tick habilita/deshabilita dinámicamente este callback según orbit_future_show
    ws_server.set_orbit_callback(None)

    asyncio.run(ws_server.start())


if __name__ == "__main__":
    main()

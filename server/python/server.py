# server.py
import asyncio
import datetime
import hashlib
import json
import os
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

# =============================
# Estado global de propagadores
# =============================
propagators = []
system_config = {}
state_lock = threading.Lock()

orbit_cache_payload = []
orbit_cache_key = None
orbit_cache_hash = None
orbit_cache_valid_until = datetime.datetime.min.replace(tzinfo=datetime.UTC)
last_state_hash = None


def load_system_config():
    try:
        with open(SYSTEM_CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)
    except Exception as e:
        print(f"⚠️ No se pudo leer system_config.json: {e}")
        return {
            "orbit_future_show": True,
            "propagation_hours": 12,
            "orbit_future_samples": 120,
            "orbit_future_line_width": 3,
            "orbit_future_color": "#00ff88",
            "orbit_past_color": "#ff0000",
            "orbit_past_samples": 120,
            "websocket_state_interval_seconds": 1.0,
            "websocket_orbit_interval_seconds": 10.0,
            "orbit_cache_ttl_seconds": 10
        }, {"satellites_file": "sentinel_tles_subset.txt"}

    system_cfg = config.get("system", {})
    data_cfg = config.get("data", {})

    defaults = {
        "orbit_future_show": True,
        "propagation_hours": 12,
        "orbit_future_samples": 120,
        "orbit_future_line_width": 3,
        "orbit_future_color": "#00ff88",
        "orbit_past_color": "#ff0000",
        "orbit_past_samples": 120,
        "websocket_state_interval_seconds": 1.0,
        "websocket_orbit_interval_seconds": 10.0,
        "orbit_cache_ttl_seconds": 10
    }
    for key, default in defaults.items():
        system_cfg.setdefault(key, default)

    data_cfg.setdefault("satellites_file", "sentinel_tles_subset.txt")
    return system_cfg, data_cfg


def load_constellation():
    global propagators, system_config, orbit_cache_payload, orbit_cache_key, orbit_cache_valid_until
    print("🔄 Recargando constelación desde config...")

    new_system_config, data_config = load_system_config()
    satellites_file = data_config.get("satellites_file", "sentinel_tles_subset.txt")
    config_file = os.path.join(CONFIG_DIR, satellites_file)

    tles = load_all_tles_from_config(config_file)
    print(f"✔ {len(tles)} satélites cargados desde {satellites_file}")

    print(
        f"✔ Propagación: {new_system_config['propagation_hours']} horas, {new_system_config['orbit_future_samples']} puntos"
    )

    new_props = []
    for name, l1, l2 in tles:
        new_props.append((name, SGP4Propagator(l1, l2)))

    with state_lock:
        propagators = new_props
        system_config = new_system_config
        orbit_cache_payload = []
        orbit_cache_key = None
        orbit_cache_valid_until = datetime.datetime.min.replace(tzinfo=datetime.UTC)
    print("🛰️ Constelación actualizada")


def get_state_snapshot():
    with state_lock:
        return list(propagators), dict(system_config)


def build_orbit_payload(props, cfg):
    orbit_future_show = cfg.get("orbit_future_show", True)
    if not orbit_future_show:
        return []

    horizon_hours = cfg.get("propagation_hours", 12)
    samples = cfg.get("orbit_future_samples", 120)
    if samples < 2:
        samples = 2

    payload = []
    for name, prop in props:
        orbit = []
        for i in range(samples):
            offset_seconds = (i / (samples - 1)) * horizon_hours * 3600
            ox, oy, oz, _, _, _ = prop.propagate_offset(offset_seconds)
            orbit.append({"x": ox, "y": oy, "z": oz})
        payload.append({"satellite": name, "orbit": orbit})

    return payload


def get_orbits_cached(props, cfg):
    global orbit_cache_payload, orbit_cache_key, orbit_cache_hash, orbit_cache_valid_until

    now = datetime.datetime.now(datetime.UTC)
    cache_ttl_seconds = cfg.get("orbit_cache_ttl_seconds", 10)
    cache_key = (
        tuple(name for name, _ in props),
        cfg.get("orbit_future_show", True),
        cfg.get("propagation_hours", 12),
        cfg.get("orbit_future_samples", 120),
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
        cfg.get("orbit_future_samples", 120),
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
        if event.src_path.endswith("sentinel_tles_subset.txt") or event.src_path.endswith("system_config.json"):
            load_constellation()


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

    # 1) Cargar constelación inicial
    load_constellation()

    # 2) Arrancar watcher en un hilo aparte
    watcher_thread = threading.Thread(target=start_watcher, daemon=True)
    watcher_thread.start()

    # 3) Crear servidor WebSocket
    _, initial_cfg = get_state_snapshot()
    ws_server = WebSocketServer(
        state_interval=initial_cfg.get("websocket_state_interval_seconds", 1.0),
        orbit_interval=initial_cfg.get("websocket_orbit_interval_seconds", 10.0),
    )

    # 4) Callback: estado en tiempo real (sin órbitas)
    def state_tick():
        data = []
        props, cfg = get_state_snapshot()
        ws_server.state_interval = cfg.get("websocket_state_interval_seconds", 1.0)
        ws_server.orbit_interval = cfg.get("websocket_orbit_interval_seconds", 10.0)

        # Si orbit_future_show está desactivado, no calcular ni enviar órbitas.
        ws_server.set_orbit_callback(orbit_tick if cfg.get("orbit_future_show", True) else None)

        for name, prop in props:
            x, y, z, vx, vy, vz = prop.propagate()
            satellite = {
                "satellite": name,
                "position": {"x": x, "y": y, "z": z},
                "velocity": {"x": vx, "y": vy, "z": vz}
            }
            data.append(satellite)
        return data

    # 5) Callback: órbitas con caché y menor frecuencia
    def orbit_tick():
        props, cfg = get_state_snapshot()
        return get_orbits_cached(props, cfg)

    ws_server.set_state_callback(state_tick)
    # state_tick habilita/deshabilita dinámicamente este callback según orbit_future_show
    ws_server.set_orbit_callback(None)

    asyncio.run(ws_server.start())


if __name__ == "__main__":
    main()

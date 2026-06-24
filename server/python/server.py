# server.py
import asyncio
import datetime
import json
import os
import threading
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

from webSockets import WebSocketServer
from propagator import SGP4Propagator
from tle_loader import load_all_tles_from_config

BASE_DIR = os.path.dirname(__file__)
CONFIG_DIR = os.path.abspath(os.path.join(BASE_DIR, "../../config"))
SYSTEM_CONFIG_PATH = os.path.join(CONFIG_DIR, "system_config.json")

# -----------------------------
# Estado global de propagadores
# -----------------------------
propagators = []
system_config = {}


def load_system_config():
    try:
        with open(SYSTEM_CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)
    except Exception as e:
        print(f"⚠️ No se pudo leer system_config.json: {e}")
        return {
            "show_orbits": True,
            "propagation_hours": 12,
            "orbit_future_samples": 120,
            "orbit_future_line_width": 3,
            "orbit_future_color": "#00ff88",
            "orbit_past_color": "#ff0000",
            "orbit_past_samples": 120
        }, {"satellites_file": "satellites.txt"}

    system_cfg = config.get("system", {})
    data_cfg = config.get("data", {})

    defaults = {
        "show_orbits": True,
        "propagation_hours": 12,
        "orbit_future_samples": 120,
        "orbit_future_line_width": 3,
        "orbit_future_color": "#00ff88",
        "orbit_past_color": "#ff0000",
        "orbit_past_samples": 120
    }
    for key, default in defaults.items():
        system_cfg.setdefault(key, default)

    data_cfg.setdefault("satellites_file", "satellites.txt")
    return system_cfg, data_cfg


def load_constellation():
    global propagators, system_config
    print("🔄 Recargando constelación desde config...")

    system_config, data_config = load_system_config()
    satellites_file = data_config.get("satellites_file", "satellites.txt")
    config_file = os.path.join(CONFIG_DIR, satellites_file)

    tles = load_all_tles_from_config(config_file)
    print(f"✔ {len(tles)} satélites cargados desde {satellites_file}")

    print(
        f"✔ Propagación: {system_config['propagation_hours']} horas, {system_config['orbit_future_samples']} puntos"
    )

    new_props = []
    for name, l1, l2 in tles:
        new_props.append((name, SGP4Propagator(l1, l2)))

    propagators = new_props
    print("🛰️ Constelación actualizada")


# -----------------------------
# Watcher para detectar cambios
# -----------------------------
class ConfigWatcher(FileSystemEventHandler):
    def on_modified(self, event):
        if event.src_path.endswith("satellites.txt") or event.src_path.endswith("system_config.json"):
            load_constellation()


def start_watcher():
    observer = Observer()
    observer.schedule(ConfigWatcher(), path="../../config", recursive=False)
    observer.start()
    print("👀 Watcher activo en ../../config")


# -----------------------------
# Servidor WebSocket
# -----------------------------

def main():

    # 1) Cargar constelación inicial
    load_constellation()

    # 2) Arrancar watcher en un hilo aparte
    watcher_thread = threading.Thread(target=start_watcher, daemon=True)
    watcher_thread.start()

    # 3) Crear servidor WebSocket
    ws_server = WebSocketServer()

    # 4) Callback: propagar todos los satélites
    def tick():
        data = []
        horizon_hours = system_config.get("propagation_hours", 12)
        samples = system_config.get("orbit_future_samples", 120)
        show_orbits = system_config.get("show_orbits", True)

        for name, prop in propagators:
            x, y, z, vx, vy, vz = prop.propagate()
            satellite = {
                "satellite": name,
                "position": {"x": x, "y": y, "z": z},
                "velocity": {"x": vx, "y": vy, "z": vz}
            }

            if show_orbits:
                orbit = []
                for i in range(samples):
                    offset_seconds = (i / max(samples - 1, 1)) * horizon_hours * 3600
                    ox, oy, oz, _, _, _ = prop.propagate_offset(offset_seconds)
                    orbit.append({"x": ox, "y": oy, "z": oz})
                satellite["orbit"] = orbit

            data.append(satellite)
        return data

    ws_server.set_tick_callback(tick)

    asyncio.run(ws_server.start())


if __name__ == "__main__":
    main()

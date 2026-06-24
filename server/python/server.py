# server.py
import asyncio
import threading
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

from webSockets import WebSocketServer
from propagator import SGP4Propagator
from tle_loader import load_all_tles_from_config

CONFIG_FILE = "../../config/satellites.txt"

# -----------------------------
# Estado global de propagadores
# -----------------------------
propagators = []


def load_constellation():
    """Carga todos los satélites desde el fichero y reconstruye propagadores."""
    global propagators
    print("🔄 Recargando constelación desde config...")

    tles = load_all_tles_from_config(CONFIG_FILE)
    print(f"✔ {len(tles)} satélites cargados")

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
        if event.src_path.endswith("satellites.txt"):
            load_constellation()


def start_watcher():
    observer = Observer()
    observer.schedule(ConfigWatcher(), path="../../config", recursive=False)
    observer.start()
    print("👀 Watcher activo en ../../config/satellites.txt")


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
        for name, prop in propagators:
            x, y, z, vx, vy, vz = prop.propagate()
            data.append({
                "satellite": name,
                "position": {"x": x, "y": y, "z": z},
                "velocity": {"x": vx, "y": vy, "z": vz}
            })
        return data

    ws_server.set_tick_callback(tick)

    asyncio.run(ws_server.start())


if __name__ == "__main__":
    main()

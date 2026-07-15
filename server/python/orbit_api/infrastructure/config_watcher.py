"""Filesystem adapter used to reload the constellation after configuration changes."""

from __future__ import annotations

from collections.abc import Callable

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer


class ConfigurationWatcher(FileSystemEventHandler):
    """Invoke a callback when an Orbit configuration or TLE source changes."""

    _RELOAD_SUFFIXES = ("system_config.json", "catalog.json", "catalog.txt", "_tles.txt")

    def __init__(self, reload_callback: Callable[[], object]) -> None:
        super().__init__()
        self._reload_callback = reload_callback

    def on_modified(self, event) -> None:
        if not event.is_directory and event.src_path.endswith(self._RELOAD_SUFFIXES):
            try:
                self._reload_callback()
            except Exception as exc:  # pragma: no cover - defensive observer boundary
                print(f"Error reloading constellation: {exc}")


def start_configuration_watcher(config_directory, reload_callback: Callable[[], object]) -> Observer:
    """Start and return a daemon observer for the configuration directory."""
    observer = Observer()
    observer.schedule(ConfigurationWatcher(reload_callback), path=str(config_directory), recursive=False)
    observer.daemon = True
    observer.start()
    print(f"Configuration watcher active in {config_directory}")
    return observer

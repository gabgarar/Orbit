"""Filesystem adapter used to reload the constellation after configuration changes."""

from __future__ import annotations

from collections.abc import Callable
import json
from pathlib import Path

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from orbit_api.core.settings import CONFIG_DIR
from orbit_api.core.system_config import DEFAULT_CATALOG_FILE, normalize_catalog_file_name


class ConfigurationWatcher(FileSystemEventHandler):
    """Invoke a callback when an Orbit configuration or TLE source changes."""

    _SYSTEM_CONFIG_FILE_NAME = "system_config.json"

    def __init__(self, reload_callback: Callable[[], object], config_directory=CONFIG_DIR) -> None:
        super().__init__()
        self._reload_callback = reload_callback
        self._config_directory = Path(config_directory).resolve()
        self._system_config_path = self._config_directory / self._SYSTEM_CONFIG_FILE_NAME

    def on_modified(self, event) -> None:
        self._reload_if_relevant(event, event.src_path)

    def on_created(self, event) -> None:
        self._reload_if_relevant(event, event.src_path)

    def on_deleted(self, event) -> None:
        self._reload_if_relevant(event, event.src_path)

    def on_moved(self, event) -> None:
        """Handle atomic replacement writes, which watchdog reports as moves."""
        self._reload_if_relevant(event, event.src_path, event.dest_path)

    def _reload_if_relevant(self, event, *paths: str) -> None:
        if event.is_directory or not any(self._is_relevant_path(path) for path in paths):
            return
        try:
            self._reload_callback()
        except Exception as exc:  # pragma: no cover - defensive observer boundary
            print(f"Error reloading constellation: {exc}")

    def _is_relevant_path(self, changed_path: str) -> bool:
        try:
            candidate = Path(changed_path).resolve(strict=False)
        except (OSError, TypeError, ValueError):
            return False
        if candidate.parent != self._config_directory:
            return False
        return candidate == self._system_config_path or candidate.name == self._configured_catalog_file_name()

    def _configured_catalog_file_name(self) -> str:
        """Read just enough config to track any supported catalogue extension."""
        try:
            payload = json.loads(self._system_config_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return DEFAULT_CATALOG_FILE
        data = payload.get("data", {}) if isinstance(payload, dict) else {}
        value = data.get("satellites_catalog_file") if isinstance(data, dict) else None
        return normalize_catalog_file_name(value)


def start_configuration_watcher(config_directory, reload_callback: Callable[[], object]) -> Observer:
    """Start and return a daemon observer for the configuration directory."""
    observer = Observer()
    observer.schedule(ConfigurationWatcher(reload_callback, config_directory), path=str(config_directory), recursive=False)
    observer.daemon = True
    observer.start()
    print(f"Configuration watcher active in {config_directory}")
    return observer

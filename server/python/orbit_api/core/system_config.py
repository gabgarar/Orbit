"""System configuration loading and compatibility normalisation."""

from __future__ import annotations

import json

from orbit_api.core.settings import PROPAGATION_HOURS_MAX, PROPAGATION_HOURS_MIN, SYSTEM_CONFIG_PATH

DEFAULT_CATALOG_FILE = "catalog.json"
ORBIT_LINE_WIDTH_DEFAULT = 2.5
ORBIT_LINE_WIDTH_MIN = 2.0
ORBIT_LINE_WIDTH_MAX = 5.0
RESERVED_CATALOG_FILE_NAMES = {"system_config.json"}
RESERVED_WINDOWS_FILE_STEMS = {
    "con", "prn", "aux", "nul",
    *(f"com{index}" for index in range(1, 10)),
    *(f"lpt{index}" for index in range(1, 10)),
}


def normalize_catalog_file_name(value: object, default: str = DEFAULT_CATALOG_FILE) -> str:
    """Return a portable filename so configuration cannot escape CONFIG_DIR."""
    if not isinstance(value, str):
        return default
    candidate = value.strip()
    file_stem = candidate.split(".", 1)[0].casefold()
    if (
        not candidate
        or candidate in {".", ".."}
        or candidate.endswith(".")
        or "\x00" in candidate
        or "/" in candidate
        or "\\" in candidate
        or any(ord(character) < 32 or character in '<>:"|?*' for character in candidate)
        or candidate.casefold() in RESERVED_CATALOG_FILE_NAMES
        or file_stem in RESERVED_WINDOWS_FILE_STEMS
    ):
        return default
    return candidate


def clamp_propagation_hours(value: object, default: float = 12) -> float:
    """Return a propagation horizon within the supported range."""
    try:
        hours = float(value)
    except (TypeError, ValueError):
        hours = float(default)
    if hours <= 0:
        hours = float(default)
    return max(PROPAGATION_HOURS_MIN, min(PROPAGATION_HOURS_MAX, hours))


def clamp_orbit_line_width(value: object, default: float = ORBIT_LINE_WIDTH_DEFAULT) -> float:
    """Keep the fixed visual orbit stroke legible without obscuring the globe."""
    try:
        width = float(value)
    except (TypeError, ValueError):
        width = float(default)
    if width <= 0:
        width = float(default)
    return max(ORBIT_LINE_WIDTH_MIN, min(ORBIT_LINE_WIDTH_MAX, width))


def normalize_system_config(system_cfg: object) -> dict:
    """Accept legacy flat settings while exposing one stable runtime shape."""
    source = system_cfg if isinstance(system_cfg, dict) else {}
    orbit_cfg = source.get("orbit", {}) if isinstance(source.get("orbit"), dict) else {}
    satellites_cfg = source.get("satellites", {}) if isinstance(source.get("satellites"), dict) else {}
    realtime_cfg = source.get("realtime", {}) if isinstance(source.get("realtime"), dict) else {}
    return {
        "orbit_future_show": orbit_cfg.get("future_show", source.get("orbit_future_show", True)),
        "propagation_hours": clamp_propagation_hours(orbit_cfg.get("propagation_hours", source.get("propagation_hours", 12))),
        "orbit_future_line_width": clamp_orbit_line_width(
            orbit_cfg.get("future_line_width", source.get("orbit_future_line_width", ORBIT_LINE_WIDTH_DEFAULT))
        ),
        "orbit_future_color": orbit_cfg.get("future_color", source.get("orbit_future_color", "#00ff88")),
        "orbit_selected_color": orbit_cfg.get("selected_color", source.get("orbit_selected_color", "#ff2d2d")),
        "satellite_label_size_px": satellites_cfg.get("label_size_px", source.get("satellite_label_size_px", 14)),
        "satellite_model_scale": satellites_cfg.get("model_scale", source.get("satellite_model_scale", 1.0)),
        "websocket_state_interval_seconds": realtime_cfg.get("state_interval_seconds", source.get("websocket_state_interval_seconds", 1.0)),
        "websocket_orbit_interval_seconds": realtime_cfg.get("orbit_interval_seconds", source.get("websocket_orbit_interval_seconds", 10.0)),
    }


def load_system_config() -> tuple[dict, dict]:
    """Load user configuration, returning safe defaults if it is unavailable."""
    defaults_system = {
        "orbit_future_show": True, "propagation_hours": 12,
        "orbit_future_line_width": ORBIT_LINE_WIDTH_DEFAULT, "orbit_future_color": "#00ff88",
        "websocket_state_interval_seconds": 1.0, "websocket_orbit_interval_seconds": 10.0,
    }
    try:
        with SYSTEM_CONFIG_PATH.open("r", encoding="utf-8") as config_file:
            config = json.load(config_file)
    except (OSError, ValueError) as exc:
        print(f"Warning: could not read system_config.json: {exc}")
        return defaults_system, {"satellites_catalog_file": DEFAULT_CATALOG_FILE}

    system_cfg = normalize_system_config(config.get("system", {})) if isinstance(config, dict) else {}
    data_cfg = config.get("data", {}) if isinstance(config, dict) else {}
    data_cfg = data_cfg if isinstance(data_cfg, dict) else {}
    for key, default in defaults_system.items():
        system_cfg.setdefault(key, default)
    data_cfg["satellites_catalog_file"] = normalize_catalog_file_name(data_cfg.get("satellites_catalog_file"))
    return system_cfg, data_cfg

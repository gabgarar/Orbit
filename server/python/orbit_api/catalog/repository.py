"""Filesystem-backed repository for normalized orbital catalog entries."""

import json
from pathlib import Path
from typing import Callable


def load_entries(config_directory: Path, catalog_file: str, load_tles: Callable[[str], list[tuple[str, str, str]]]) -> list[dict]:
    """Load normalized entries, preferring metadata-rich JSON catalog rows."""
    catalog_path = config_directory / catalog_file
    if catalog_path.suffix.lower() == ".json" and catalog_path.exists():
        try:
            payload = json.loads(catalog_path.read_text(encoding="utf-8"))
            rows = payload if isinstance(payload, list) else payload.get("entries", []) if isinstance(payload, dict) else []
            entries = [_normalise_entry(row) for row in rows if isinstance(row, dict)]
            entries = [entry for entry in entries if entry is not None]
            if entries:
                return entries
        except (OSError, ValueError, TypeError):
            pass
    return [
        {"name": name, "line1": line1, "line2": line2, "sourceFormat": "TLE"}
        for name, line1, line2 in load_tles(str(catalog_path))
    ]


def find_entry(entries: list[dict], satellite_id: str) -> dict | None:
    target = (satellite_id or "").strip().lower()
    return next((entry for entry in entries if str(entry.get("name", "")).strip().lower() == target), None)


def _normalise_entry(row: dict) -> dict | None:
    name = str(row.get("name", "")).strip()
    line1 = str(row.get("line1", "")).strip()
    line2 = str(row.get("line2", "")).strip()
    if not name or not line1 or not line2:
        return None
    source = str(row.get("sourceFormat") or row.get("format") or "TLE").strip().upper()
    return {"name": name, "line1": line1, "line2": line2, "sourceFormat": source if source in {"TLE", "OMM", "OEM"} else "TLE"}

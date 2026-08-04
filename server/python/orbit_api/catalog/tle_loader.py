"""Load local TLE catalog files in JSON or three-line text format."""

import json
from pathlib import Path


def load_all_tles_from_config(config_file: str) -> list[tuple[str, str, str]]:
    """Load normalized `(name, line1, line2)` tuples from a local catalog."""
    catalog_path = Path(config_file)
    tles = _load_json(catalog_path) if catalog_path.suffix.lower() == ".json" else _load_text(catalog_path)
    print(f"TLEs cargados desde fichero: {len(tles)} entradas")
    return tles


def _load_text(catalog_path: Path) -> list[tuple[str, str, str]]:
    lines = [line.strip() for line in catalog_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if len(lines) % 3:
        raise ValueError(
            "Archivo de TLEs incompleto: se esperaba un múltiplo de 3 líneas, "
            f"pero quedaron {len(lines) % 3} línea(s) sin procesar."
        )
    return [(lines[index], lines[index + 1], lines[index + 2]) for index in range(0, len(lines), 3)]


def _load_json(catalog_path: Path) -> list[tuple[str, str, str]]:
    payload = json.loads(catalog_path.read_text(encoding="utf-8"))
    if isinstance(payload, dict):
        entries = payload.get("entries", [])
    elif isinstance(payload, list):
        entries = payload
    else:
        raise ValueError("Formato JSON de catálogo no válido")

    return [
        (name, line1, line2)
        for item in entries
        if isinstance(item, dict)
        for name, line1, line2 in [
            (
                str(item.get("name", "")).strip(),
                str(item.get("line1", "")).strip(),
                str(item.get("line2", "")).strip(),
            )
        ]
        if name and line1 and line2
    ]

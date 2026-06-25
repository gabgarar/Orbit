# tle_loader.py
import json
import os


def _load_tles_from_txt(config_file):
    with open(config_file, "r", encoding="utf-8") as f:
        lines = [line.strip() for line in f if line.strip()]

    tles = []
    block = []

    for line in lines:
        block.append(line)
        if len(block) == 3:
            name, l1, l2 = block
            tles.append((name, l1, l2))
            block = []

    if block:
        raise ValueError(
            f"Archivo de TLEs incompleto: se esperaba un múltiplo de 3 líneas, pero quedaron {len(block)} línea(s) sin procesar."
        )

    return tles


def _load_tles_from_json(config_file):
    with open(config_file, "r", encoding="utf-8") as f:
        payload = json.load(f)

    if isinstance(payload, dict):
        entries = payload.get("entries", [])
    elif isinstance(payload, list):
        entries = payload
    else:
        raise ValueError("Formato JSON de catálogo no válido")

    tles = []
    for item in entries:
        name = str(item.get("name", "")).strip()
        l1 = str(item.get("line1", "")).strip()
        l2 = str(item.get("line2", "")).strip()
        if name and l1 and l2:
            tles.append((name, l1, l2))

    return tles


def load_all_tles_from_config(config_file):
    """Carga múltiples TLEs desde fichero local TXT o JSON.

    TXT: bloques nombre + línea1 + línea2.
    JSON: objeto con clave `entries` o array de objetos {name,line1,line2}.
    """
    ext = os.path.splitext(config_file)[1].lower()

    if ext == ".json":
        tles = _load_tles_from_json(config_file)
    else:
        tles = _load_tles_from_txt(config_file)

    print("TLEs cargados desde fichero:")
    for name, _, _ in tles:
        print(f"  - {name}")

    return tles

